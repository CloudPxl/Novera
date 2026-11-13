import type { AgentAdapter, AgentFailure, AgentInvocation, AgentResult, HttpAgentConfig } from "./types.ts";
import { PROBE_INPUT } from "./types.ts";
import { readPath, replyText } from "./template.ts";
import { deliveryOf, requestBody, URL_CONVERSATION, WHOLE_BODY_PATH } from "./delivery.ts";
import {
  assembleEvents, firstInStream, looksLikeEventStream, looksLikeJsonLines, looksLikeTextStreamProtocol,
  parseEventStream, parseJsonLines, parseTextStreamProtocol, streamPaths,
} from "./sse.ts";
import { isLimitSignal, platformSaid, readUpstreamError, retryAfterMs, signaturePart, upstreamQuote, webPage } from "./upstream-error.ts";
import { suggestPathHint } from "./discover.ts";
import { assertPublicUrl, guardedFetch, publicOnlyDispatcher, refusedAddress } from "../net/public-url.ts";
import { BodyTooLarge, readTextLimited } from "../net/read-body.ts";

/**
 * Calls a customer's deployed agent over HTTP.
 *
 * Every failure mode here — unreachable host, non-2xx, unparseable body, a response
 * path that matches nothing — returns ok:false with an explanation rather than
 * throwing. The runner turns that into an `error` case, which is excluded from the
 * score and shown in the report's coverage block.
 */
/**
 * How long an agent has to answer one message: its configured timeout, never more than
 * 30 s. A run executes in slices inside a 60 s function, so a longer wait is not a
 * patient setting — it is a case the platform kills halfway through.
 */
export const AGENT_TIMEOUT_MAX_MS = 30_000;

/**
 * The most of an agent's reply Novera reads. A support reply is a few kilobytes; past this
 * it is an attachment or a fault, and reading it whole cost minutes of CPU in redaction
 * and could keep a slice past the platform's limit (audit 2026-10-01, C6).
 */
export const MAX_REPLY_BYTES = 256 * 1024;

/** Below this, a message is not sent at all: the answer could not be waited for. */
const MIN_AGENT_WAIT_MS = 2_000;

export function agentTimeoutMs(config: { timeoutMs?: number }): number {
  const own = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : AGENT_TIMEOUT_MAX_MS;
  return Math.min(own, AGENT_TIMEOUT_MAX_MS);
}

/**
 * Text Postgres can store. JSON can carry `\u0000` and unpaired surrogate escapes, which
 * `JSON.parse` turns into characters no `text` or `jsonb` column accepts: one such reply
 * made the case's save throw and aborted the whole run (chaos audit 2026-10-17). They become
 * U+FFFD, the same mark undecodable bytes already get when the body is read, so the reply is
 * kept and graded with the unreadable character visibly marked — never dropped or invented.
 */
const UNSTORABLE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]|\u0000/g;

export function storableText<T>(value: T): T {
  // A whole surrogate pair is matched first and kept; anything else matched is unstorable.
  if (typeof value === "string") return value.replace(UNSTORABLE, (m) => (m.length === 2 ? m : "\uFFFD")) as T;
  if (Array.isArray(value)) return value.map((v) => storableText(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [storableText(k), storableText(v)]),
    ) as T;
  }
  return value;
}

/**
 * Where a redirect points, said in the error: "HTTP 308" alone sent a person looking at the
 * agent, when the fix is one changed address. The origin and path only — a query string can
 * carry a token — and never followed (see `redirect: "manual"` below).
 */
export function redirectNote(response: { status: number; headers: Headers }, requested: string): string {
  if (response.status < 300 || response.status > 399) return "";
  const location = response.headers.get("location");
  let target: URL | null = null;
  try {
    target = location ? new URL(location, requested) : null;
  } catch {
    target = null;
  }
  const where = target && (target.protocol === "https:" || target.protocol === "http:")
    ? ` to ${(target.origin + target.pathname).slice(0, 300)}`
    : "";
  return `, a redirect${where}. Novera does not follow redirects: change the agent's endpoint to the final address.`;
}

/** Which kind of connection failure a thrown fetch error was, for counting one cause. */
function connectionCause(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } })?.cause;
  const code = cause && typeof cause.code === "string" ? cause.code : null;
  return code ? code.toLowerCase() : "network";
}

/** The kinds of event a stream carried, said when none had text where the connection reads. */
function kindsNote(kinds: Record<string, number>): string {
  const names = Object.keys(kinds).slice(0, 8);
  return names.length ? ` The events were: ${names.map((k) => `${k} (${kinds[k]})`).join(", ")}.` : "";
}

/** A failed answer: the sentence stored with the case, and its classified cause for the runner. */
function failed(
  failure: AgentFailure,
  error: string,
  extra: Partial<AgentResult> & { latencyMs: number },
): AgentResult {
  return { ok: false, responseText: null, toolActivity: null, ...extra, error, failure };
}

/** The reply at a path as text: a string as itself, anything else structured as its JSON. */
export function replyValue(parsed: unknown, path: string): { text: string; structured: boolean } | undefined {
  const asText = replyText(parsed, path);
  if (asText !== undefined) return { text: asText, structured: false };
  const value = readPath(parsed, path);
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" || typeof value === "boolean") return { text: String(value), structured: true };
  if (typeof value === "object") return { text: JSON.stringify(value, null, 2), structured: true };
  return undefined;
}

/** The HTTP statuses that mean "not now" rather than "not this": the endpoint's availability. */
const UNAVAILABLE = new Set([408, 502, 503, 504]);

/**
 * What a non-2xx answer was, from its status and anything the platform said in its body. The
 * prefix `Agent returned HTTP <status>` is kept: stored runs, the repair classifier and the CI
 * gate read it.
 */
export function httpFailure(
  status: number, parsed: unknown, text: string, contentType: string | null, headers: Headers, requested: string,
): { failure: AgentFailure; error: string } {
  const upstream = readUpstreamError(parsed);
  const said = platformSaid(upstreamQuote(upstream));
  const head = `Agent returned HTTP ${status}${redirectNote({ status, headers }, requested)}`;
  if (status >= 300 && status <= 399) return { failure: { kind: "redirect", signature: `http:${status}` }, error: head };
  const wait = retryAfterMs(headers.get("retry-after"));
  if (status === 429 || isLimitSignal(upstream, status) && (status === 503 || status === 403)) {
    return {
      failure: { kind: "throttled", signature: `http:${status}`, refusedAtDoor: status === 429, ...(wait !== undefined ? { retryAfterMs: wait } : {}) },
      error: `${head}: the agent's platform refused it as over a limit.${said}`,
    };
  }
  const page = parsed === null ? webPage(contentType, text) : null;
  const pageNote = page ? ` The answer was a web page${page.title ? ` titled "${page.title}"` : ""}, not the agent's API.` : "";
  if (status === 401 || status === 403) {
    return { failure: { kind: "refused_auth", signature: `http:${status}`, refusedAtDoor: true }, error: `${head}.${said}${pageNote}` };
  }
  if (status >= 400 && status <= 499) {
    return { failure: { kind: "refused_input", signature: `http:${status}:${signaturePart(upstream)}` }, error: `${head}.${said}${pageNote}` };
  }
  return {
    failure: { kind: UNAVAILABLE.has(status) ? "unreachable" : "platform_error", signature: `http:${status}`, ...(wait !== undefined ? { retryAfterMs: wait } : {}) },
    error: `${head}.${said}${pageNote}`,
  };
}

export function httpAgent(config: HttpAgentConfig, authValue?: string): AgentAdapter {
  // Conversation ids the agent issued, by Novera's own id for the conversation. In memory for
  // this adapter only: a conversation's turns are all sent by one scenario's execution.
  const issuedIds = new Map<string, string>();

  async function call(
    input: string,
    policy: string,
    context?: Record<string, string>,
    history?: AgentInvocation["history"],
    conversationId?: string,
    deadline?: number,
  ): Promise<AgentResult> {
    const started = Date.now();
    const method = config.method ?? "POST";
    const headers: Record<string, string> = { ...(method === "GET" ? {} : { "content-type": "application/json" }), ...config.headers };
    if (authValue && config.authHeaderName) headers[config.authHeaderName] = authValue;

    // A platform that issues its own conversation ids refuses one it did not issue: the first
    // message of a conversation carries none, and later ones carry what the agent returned.
    const ownId = conversationId ?? crypto.randomUUID();
    const sentId = config.conversationIdPath ? issuedIds.get(ownId) ?? "" : ownId;
    const body = requestBody(config, { input, policy, context, history, conversationId: sentId });
    // Only ever in the path or query: `parseEndpointFields` refuses the placeholder in the host.
    const url = config.url.split(URL_CONVERSATION).join(encodeURIComponent(sentId));

    // Checked on every call, not only when the agent was connected: what a hostname
    // resolves to can change afterwards.
    try {
      await assertPublicUrl(url);
    } catch (error) {
      return failed({ kind: "not_sent", signature: "not_sent:address" }, `Not sent: ${error instanceof Error ? error.message : String(error)}`, { latencyMs: 0 });
    }

    const own = agentTimeoutMs(config);
    const wait = deadline === undefined ? own : Math.min(own, deadline - Date.now());
    if (wait < MIN_AGENT_WAIT_MS) {
      return failed({ kind: "not_sent", signature: "not_sent:slice" },
        "Not sent: this run's time slice was ending. This says nothing about the agent; retest the scenario.",
        { latencyMs: 0, timedOut: true, cutByNovera: true });
    }

    let response: Response;
    try {
      response = await guardedFetch(url, {
        method,
        headers,
        // A GET carries no body: fetch refuses one, and the refusal read as "unreachable".
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
        // A redirect is answered, never followed: following it could carry the request
        // to an address the check above never saw.
        redirect: "manual",
        signal: AbortSignal.timeout(wait),
        // The address connected to is checked when the connection opens, not only above.
        dispatcher: publicOnlyDispatcher(),
      } as RequestInit);
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        const cut = wait < own;
        return failed({ kind: cut ? "not_sent" : "timeout", signature: cut ? "not_sent:slice" : "timeout" },
          cut
            ? `Novera stopped waiting after ${Math.round(wait / 1000)} s because this run's time slice was ending. This says nothing about the agent; retest the scenario.`
            : `The agent did not answer within ${Math.round(own / 1000)} s.`,
          { latencyMs: Date.now() - started, timedOut: true, ...(cut ? { cutByNovera: true } : {}) });
      }
      const refused = refusedAddress(error);
      if (refused) return failed({ kind: "not_sent", signature: "not_sent:address" }, `Not sent: ${refused}`, { latencyMs: Date.now() - started });
      return failed({ kind: "unreachable", signature: `unreachable:${connectionCause(error)}` },
        `Request failed: ${error instanceof Error ? error.message : String(error)}`, { latencyMs: Date.now() - started });
    }

    const latencyMs = Date.now() - started;
    // The headers arriving is not the reply arriving: the body is read under the same
    // deadline, and a body that stalls is this scenario's timeout, not an exception that
    // ends the run (audit 2026-10-01, C5).
    let text: string;
    try {
      text = await readTextLimited(response, MAX_REPLY_BYTES);
    } catch (error) {
      const base = { statusCode: response.status, latencyMs: Date.now() - started };
      if (error instanceof BodyTooLarge) {
        return failed({ kind: "too_large", signature: "too_large" },
          `The agent's reply was larger than ${MAX_REPLY_BYTES / 1024} KB, so Novera stopped reading it. Nothing was graded; this says nothing about whether the reply was right.`, base);
      }
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        const cut = wait < own;
        return failed({ kind: cut ? "not_sent" : "timeout", signature: cut ? "not_sent:slice" : "timeout" },
          cut
            ? `Novera stopped waiting after ${Math.round(wait / 1000)} s because this run's time slice was ending. This says nothing about the agent; retest the scenario.`
            : `The agent's reply did not finish arriving within ${Math.round(own / 1000)} s.`,
          { ...base, timedOut: true, ...(cut ? { cutByNovera: true } : {}) });
      }
      return failed({ kind: "unreachable", signature: "unreachable:read" },
        `The agent's reply could not be read: ${error instanceof Error ? error.message : String(error)}`, base);
    }

    const contentType = response.headers.get("content-type");
    let parsed: unknown = null;
    try {
      parsed = storableText(JSON.parse(text));
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const { failure, error } = httpFailure(response.status, parsed, text, contentType, response.headers, config.url);
      return failed(failure, error, { statusCode: response.status, latencyMs, raw: parsed ?? storableText(text.slice(0, 4096)) });
    }

    // A reply in pieces: server-sent events, JSON lines, or the AI SDK's text stream.
    const pieces = parsed === null
      ? looksLikeEventStream(contentType, text) ? { format: "event_stream" as const, events: parseEventStream(storableText(text)) }
        : looksLikeTextStreamProtocol(contentType, text, response.headers.get("x-vercel-ai-data-stream")) ? { format: "text_stream" as const, events: parseTextStreamProtocol(storableText(text)) }
          : looksLikeJsonLines(contentType, text) ? { format: "json_lines" as const, events: parseJsonLines(storableText(text)) }
            : null
      : null;
    if (pieces) {
      const paths = streamPaths(config.responsePath, config.streamPath);
      const stream = assembleEvents(pieces.events, paths, { whole: config.streamMode === "whole", plain: config.responsePath === WHOLE_BODY_PATH || config.streamPath === WHOLE_BODY_PATH });
      const wire = {
        contentType, format: pieces.format, pieces: stream.pieces, matchedPath: stream.matchedPath,
        eventKinds: stream.eventKinds, finished: stream.finished, ...(stream.cumulative ? { cumulative: true } : {}),
      };
      const sample = stream.events.slice(0, 40).map((e) => e.data ?? e.raw.slice(0, 500));
      const base = { statusCode: response.status, latencyMs: Date.now() - started, raw: sample, wire };
      if (stream.error) {
        const sig = `stream:${signaturePart(stream.upstream)}`;
        return failed(stream.limit
          ? { kind: "throttled", signature: sig }
          // A workflow that failed part-way is often a step's dependency failing once: sent again
          // under the same rule as an HTTP 5xx (`worthOneMoreAttempt`).
          : { kind: "platform_error", signature: sig, ...(stream.workflowFailed ? { transient: true } : {}) }, stream.error, base);
      }
      if (stream.cumulative) {
        return failed({ kind: "repeated_stream", signature: "stream:cumulative" },
          "The agent's stream sends the whole reply so far in every event, and the connection reads each event as the next piece, so the pieces cannot be put together without repeating text. Nothing was graded. Set the connection's stream to \"whole text\" on the agent's page, then retest.",
          base);
      }
      if (stream.text === null || stream.text.trim() === "") {
        // A step of the agent's workflow failed and no reply followed, whether or not the stream
        // went on to say it finished: the failure is the cause, not the reply path.
        if (stream.failedStep) {
          const type = /^\[([^\]]+)\]/.exec(stream.failedStep)?.[1] ?? "step";
          return failed({ kind: "platform_error", signature: `stream:node_failed:${type.toLowerCase()}`, transient: true },
            `A step of the agent's workflow failed and no reply followed. Its platform said: "${stream.failedStep}".`, base);
        }
        if (stream.text !== null) {
          return failed({ kind: "empty", signature: "stream:empty" },
            stream.finished
              ? "The agent's stream finished normally and carried no reply text: the agent answered with an empty reply."
              : "The agent answered with an empty reply.",
            { ...base, emptyReply: true });
        }
        return failed({ kind: "path_miss", signature: "stream:path" },
          `The agent answered with a stream of ${stream.events.length} event${stream.events.length === 1 ? "" : "s"}, and none carried text at "${paths.join('" or "')}".${kindsNote(stream.eventKinds)}`,
          base);
      }
      if (config.conversationIdPath && conversationId) {
        const issued = firstInStream(stream.events, config.conversationIdPath);
        if (typeof issued === "string" && issued) issuedIds.set(conversationId, issued);
      }
      const activity = config.toolActivityPath
        ? stream.events.flatMap((e) => {
            const found = e.data && typeof e.data === "object" ? readPath(e.data, config.toolActivityPath as string) : undefined;
            return found === undefined || found === null || found === "" ? [] : Array.isArray(found) ? found : [found];
          })
        : [];
      return {
        ok: true, responseText: stream.text, toolActivity: activity.length ? activity : null,
        statusCode: response.status, latencyMs: Date.now() - started, raw: sample, wire,
      };
    }

    // Something in front of the agent answered with a web page: a sign-in page, a firewall, a bot check.
    const page = parsed === null ? webPage(contentType, text) : null;
    if (page) {
      return failed({ kind: "web_page", signature: "web_page" },
        `The agent's address answered HTTP ${response.status} with a web page${page.title ? ` titled "${page.title}"` : ""} instead of the agent's reply: a sign-in page, a firewall or a bot check usually answers like this, and the request did not reach the agent's API. Check the endpoint address and its access rules.`,
        { statusCode: response.status, latencyMs, raw: storableText(text.slice(0, 4096)), wire: { contentType, format: "text" } });
    }

    // An endpoint that answers in plain text, declared as such on the connection.
    if (config.responsePath === WHOLE_BODY_PATH) {
      const whole = storableText(text);
      const wire = { contentType, format: "text" as const };
      if (whole.trim() === "") {
        return failed({ kind: "empty", signature: "text:empty" }, "The agent answered with an empty reply.", { statusCode: response.status, latencyMs, raw: whole, wire, emptyReply: true });
      }
      return { ok: true, responseText: whole, toolActivity: null, statusCode: response.status, latencyMs, raw: whole, wire };
    }

    if (parsed === null) {
      return failed({ kind: "unreadable", signature: "unreadable" },
        text.trim() === "" ? "The agent answered with an empty reply." : "Agent response was not valid JSON",
        { statusCode: response.status, latencyMs, raw: text.slice(0, 4096), wire: { contentType, format: "text" }, ...(text.trim() === "" ? { emptyReply: true } : {}) });
    }

    const extracted = replyValue(parsed, config.responsePath);
    const wire = { contentType, format: "json" as const, matchedPath: config.responsePath, ...(extracted?.structured ? { structured: true } : {}) };
    if (extracted === undefined || extracted.text.trim() === "") {
      // The field is there and holds nothing: the agent said nothing. Not a wrong path.
      if (extracted !== undefined) {
        return failed({ kind: "empty", signature: "json:empty" }, "The agent answered with an empty reply.",
          { statusCode: response.status, latencyMs, raw: parsed, wire, emptyReply: true });
      }
      // An answer that is an error, sent with HTTP 200: the platform refused or failed, and the
      // reply path is not the problem.
      const stated = readUpstreamError(parsed);
      if (stated) {
        const limit = isLimitSignal(stated);
        return failed({ kind: limit ? "throttled" : "platform_error", signature: `body:${signaturePart(stated)}` },
          `The agent answered HTTP ${response.status} with an error instead of a reply${limit ? ", over a limit" : ""}.${platformSaid(upstreamQuote(stated))}`,
          { statusCode: response.status, latencyMs, raw: parsed, wire });
      }
      // The most common way an integration dies, and the least useful place to stop
      // talking. The response is right here; saying where the reply appears to be
      // turns a dead end into a one-line fix, at connection time and at run time both.
      return failed({ kind: "path_miss", signature: "json:path" },
        `No text found at response path "${config.responsePath}".${suggestPathHint(parsed)}`,
        { statusCode: response.status, latencyMs, raw: parsed, wire });
    }

    if (config.conversationIdPath && conversationId) {
      const issued = readPath(parsed, config.conversationIdPath);
      if (typeof issued === "string" && issued) issuedIds.set(conversationId, issued);
    }

    return {
      ok: true,
      responseText: extracted.text,
      toolActivity: config.toolActivityPath ? readPath(parsed, config.toolActivityPath) ?? null : null,
      statusCode: response.status,
      latencyMs,
      raw: parsed,
      wire,
    };
  }

  return {
    probe: () => call(PROBE_INPUT, ""),
    send: (invocation: AgentInvocation) =>
      call(invocation.input, invocation.policy, invocation.context, invocation.history, invocation.conversationId, invocation.deadline),
    acceptsContext: () => deliveryOf(config).context !== "none",
    acceptsConversation: () => deliveryOf(config).conversation !== "none",
    delivery: () => deliveryOf(config),
  };
}
