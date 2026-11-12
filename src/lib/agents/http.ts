import type { AgentAdapter, AgentInvocation, AgentResult, HttpAgentConfig } from "./types.ts";
import { PROBE_INPUT } from "./types.ts";
import { readPath, replyText } from "./template.ts";
import { deliveryOf, requestBody, URL_CONVERSATION, WHOLE_BODY_PATH } from "./delivery.ts";
import { assembleEventStream, firstInStream, looksLikeEventStream, streamPaths } from "./sse.ts";
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
    const headers: Record<string, string> = { "content-type": "application/json", ...config.headers };
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
      return {
        ok: false, responseText: null, toolActivity: null, latencyMs: 0,
        error: `Not sent: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const own = agentTimeoutMs(config);
    const wait = deadline === undefined ? own : Math.min(own, deadline - Date.now());
    if (wait < MIN_AGENT_WAIT_MS) {
      return {
        ok: false, responseText: null, toolActivity: null, latencyMs: 0, timedOut: true, cutByNovera: true,
        error: "Not sent: this run's time slice was ending. This says nothing about the agent; retest the scenario.",
      };
    }

    let response: Response;
    try {
      response = await guardedFetch(url, {
        method: config.method ?? "POST",
        headers,
        body: JSON.stringify(body),
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
        return {
          ok: false, responseText: null, toolActivity: null, latencyMs: Date.now() - started, timedOut: true,
          ...(cut ? { cutByNovera: true } : {}),
          error: cut
            ? `Novera stopped waiting after ${Math.round(wait / 1000)} s because this run's time slice was ending. This says nothing about the agent; retest the scenario.`
            : `The agent did not answer within ${Math.round(own / 1000)} s.`,
        };
      }
      const refused = refusedAddress(error);
      return {
        ok: false,
        responseText: null,
        toolActivity: null,
        latencyMs: Date.now() - started,
        error: refused ? `Not sent: ${refused}` : `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const latencyMs = Date.now() - started;
    // The headers arriving is not the reply arriving: the body is read under the same
    // deadline, and a body that stalls is this scenario's timeout, not an exception that
    // ends the run (audit 2026-10-01, C5).
    let text: string;
    try {
      text = await readTextLimited(response, MAX_REPLY_BYTES);
    } catch (error) {
      const base = { ok: false as const, responseText: null, toolActivity: null, statusCode: response.status, latencyMs: Date.now() - started };
      if (error instanceof BodyTooLarge) {
        return { ...base, error: `The agent's reply was larger than ${MAX_REPLY_BYTES / 1024} KB, so Novera stopped reading it. Nothing was graded; this says nothing about whether the reply was right.` };
      }
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        const cut = wait < own;
        return {
          ...base, timedOut: true, ...(cut ? { cutByNovera: true } : {}),
          error: cut
            ? `Novera stopped waiting after ${Math.round(wait / 1000)} s because this run's time slice was ending. This says nothing about the agent; retest the scenario.`
            : `The agent's reply did not finish arriving within ${Math.round(own / 1000)} s.`,
        };
      }
      return { ...base, error: `The agent's reply could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }

    const contentType = response.headers.get("content-type");
    let parsed: unknown = null;
    try {
      parsed = storableText(JSON.parse(text));
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        responseText: null,
        toolActivity: null,
        statusCode: response.status,
        latencyMs,
        raw: parsed ?? text,
        error: `Agent returned HTTP ${response.status}${redirectNote(response, config.url)}`,
      };
    }

    // A stream of server-sent events: the pieces of the reply, put back together in order.
    if (parsed === null && looksLikeEventStream(contentType, text)) {
      const stream = assembleEventStream(storableText(text), streamPaths(config.responsePath, config.streamPath));
      const wire = { contentType, format: "event_stream" as const, pieces: stream.pieces, matchedPath: stream.matchedPath };
      const sample = stream.events.slice(0, 40).map((e) => e.data);
      if (stream.error) {
        return { ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs: Date.now() - started, raw: sample, wire, error: stream.error };
      }
      if (stream.text === null || stream.text.trim() === "") {
        return {
          ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs: Date.now() - started, raw: sample, wire,
          ...(stream.text !== null ? { emptyReply: true } : {}),
          error: stream.text !== null
            ? "The agent answered with an empty reply."
            : `The agent answered with a stream of ${stream.events.length} event${stream.events.length === 1 ? "" : "s"}, and none carried text at "${streamPaths(config.responsePath, config.streamPath).join('" or "')}".`,
        };
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

    // An endpoint that answers in plain text, declared as such on the connection.
    if (config.responsePath === WHOLE_BODY_PATH) {
      const whole = storableText(text);
      const wire = { contentType, format: "text" as const };
      if (whole.trim() === "") {
        return { ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs, raw: whole, wire, emptyReply: true, error: "The agent answered with an empty reply." };
      }
      return { ok: true, responseText: whole, toolActivity: null, statusCode: response.status, latencyMs, raw: whole, wire };
    }

    if (parsed === null) {
      return {
        ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs,
        raw: text, wire: { contentType, format: "text" },
        error: "Agent response was not valid JSON",
      };
    }

    const wire = { contentType, format: "json" as const, matchedPath: config.responsePath };
    const extracted = replyText(parsed, config.responsePath);
    if (typeof extracted !== "string" || extracted.trim() === "") {
      // The field is there and holds nothing: the agent said nothing. Not a wrong path.
      if (typeof extracted === "string") {
        return {
          ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs,
          raw: parsed, wire, emptyReply: true,
          error: "The agent answered with an empty reply.",
        };
      }
      // The most common way an integration dies, and the least useful place to stop
      // talking. The response is right here; saying where the reply appears to be
      // turns a dead end into a one-line fix, at connection time and at run time both.
      return {
        ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs,
        raw: parsed, wire,
        error: `No text found at response path "${config.responsePath}".${suggestPathHint(parsed)}`,
      };
    }

    if (config.conversationIdPath && conversationId) {
      const issued = readPath(parsed, config.conversationIdPath);
      if (typeof issued === "string" && issued) issuedIds.set(conversationId, issued);
    }

    return {
      ok: true,
      responseText: extracted,
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
