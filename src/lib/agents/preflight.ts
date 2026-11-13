import type { AgentResult, HttpAgentConfig } from "./types.ts";
import { discoverShape } from "./discover.ts";
import { deliveryOf, requestBody } from "./delivery.ts";

/**
 * "Test connection": one diagnostic message from a connection that has not been saved, and
 * what came back, in words a person can act on.
 *
 * Pure: it reads an `AgentResult` the HTTP adapter already produced — the same adapter, the
 * same template filling, the same header and the same public-address guard a run uses — and
 * decides what to say. Nothing here is stored: a test leaves no probe receipt, no agent row
 * and no log line, and it never echoes a credential (the adapter's result carries none).
 *
 * `outcome` is a stable code, returned as is by `POST /api/v1/agents/test-connection`; the
 * sentences are for the screen and may change.
 */

export const PREFLIGHT_MESSAGE = "Hello, this is a connection check from Novera. Please reply briefly.";

/** How long a test waits for the whole answer. A run may wait longer (its own timeout, up to 30 s). */
export const PREFLIGHT_TIMEOUT_MS = 10_000;

/** The reply is shown to the person configuring the agent — their own agent's output — cut here. */
export const PREFLIGHT_PREVIEW_CHARS = 200;

/** At most this many top-level keys are named when the reply was not found. */
const MAX_KEYS = 20;

/**
 * Tests a workspace can make, counted in Postgres (`throttle_hit`, 0024): each one makes Novera
 * call an address someone typed, so it is limited like any outbound request a person can repeat.
 * The form and the API share one allowance.
 */
export const PREFLIGHT_LIMIT = { max: 20, windowSeconds: 10 * 60 } as const;

export const PREFLIGHT_OUTCOMES = [
  "ok",
  "timeout",
  "unreachable",
  "refused_address",
  "unauthorized",
  "http_error",
  "redirect",
  "too_large",
  "not_json",
  "no_reply_at_path",
  "rate_limited",
  "platform_error",
  "web_page",
  "empty_reply",
  "stream_repeats",
] as const;
export type PreflightOutcome = (typeof PREFLIGHT_OUTCOMES)[number];

export interface PreflightResult {
  outcome: PreflightOutcome;
  ok: boolean;
  /** One line: what happened. */
  headline: string;
  /** What to do about it, or what the success means. */
  detail: string;
  statusCode: number | null;
  /** Round trip, when a request was sent. */
  latencyMs: number | null;
  /** The extracted reply, cut at `PREFLIGHT_PREVIEW_CHARS`. Only on success. */
  replyPreview?: string;
  replyTruncated?: boolean;
  /** Top-level JSON keys of a reply whose text was not found. Names only, never values. */
  topLevelKeys?: string[];
  /** Where the reply appears to be, when that differs from the configured path. */
  suggestedPath?: string | null;
  /** The exchange itself, for the person configuring it: what was sent and how the answer was read. */
  inspector?: PreflightInspector;
}

/**
 * What one connection check sent and received, shown to the person who typed the connection and
 * to nobody else: nothing here is stored. The credential is named by its header only.
 */
export interface PreflightInspector {
  request: {
    method: string;
    /** Origin and path. A query string can carry a token, so it is not repeated here. */
    address: string;
    /** `name: value` for fixed headers; the credential's header shows no value. */
    headers: string[];
    body: string;
    bodyTruncated: boolean;
  };
  response: {
    contentType: string | null;
    /** How Novera read the answer; null when nothing readable arrived. */
    format: "json" | "event_stream" | "json_lines" | "text_stream" | "text" | null;
    /** For a stream: how many events carried a piece of the reply. */
    pieces: number | null;
    /** For a stream: how many events of each kind arrived, in order of first arrival. */
    eventKinds?: Record<string, number>;
    /** The value at the reply path was structured data, read as its JSON text. */
    structured?: boolean;
    /** Where the reply text was read; null when it was not found. */
    matchedPath: string | null;
  };
  /** The text fields of a JSON answer, for choosing the reply path when it was not found. */
  fields: Array<{ path: string; preview: string }>;
  /** How conversations and metadata reach this agent, and anything Novera adjusted. */
  notes: string[];
}

const INSPECTOR_BODY_CHARS = 1500;
const INSPECTOR_FIELDS = 12;
const INSPECTOR_PREVIEW = 70;

/** How this connection carries conversations and metadata, in the words the form uses. */
export function deliveryNotes(config: Pick<HttpAgentConfig, "bodyTemplate" | "url" | "inlineChannels" | "conversationIdPath">): string[] {
  const how = deliveryOf(config);
  return [
    how.conversation === "field"
      ? config.conversationIdPath
        ? `Conversations: carried by the id the agent returns at "${config.conversationIdPath}".`
        : "Conversations: carried by the request's own fields."
      : how.conversation === "message"
        ? "Conversations: the request has no field for earlier turns, so they are sent as a labelled block at the top of the message. A report says so beside each such scenario."
        : "Conversations: the request has no field for earlier turns, so conversation scenarios are not sent. Add {{messages}}, {{history}} or {{conversation_id}}, or tick the delivery option.",
    how.context === "field"
      ? "Metadata: carried by the request's {{context}} field."
      : how.context === "message"
        ? "Metadata: the request has no {{context}} field, so a scenario's metadata is sent as a labelled block at the top of the message. A report says so beside each such scenario."
        : "Metadata: the request has no {{context}} field, so scenarios that deliver content as metadata are not sent. Add {{context}}, or tick the delivery option.",
  ];
}

export function inspectPreflight(
  result: AgentResult,
  config: HttpAgentConfig,
  sent: { message: string; conversationId: string; credentialSent: boolean; notes?: string[] },
): PreflightInspector {
  const body = JSON.stringify(requestBody(config, { input: sent.message, policy: "", conversationId: sent.conversationId }), null, 2);
  let address = config.url;
  try {
    const u = new URL(config.url.split("{{conversation_id}}").join(encodeURIComponent(sent.conversationId)));
    address = `${u.origin}${u.pathname}`;
  } catch {
    address = config.url.split("?")[0];
  }
  const headers = [
    "content-type: application/json",
    ...Object.entries(config.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    ...(config.authHeaderName && sent.credentialSent ? [`${config.authHeaderName}: (your credential, not shown)`] : []),
  ];
  const json = result.wire?.format === "json" || (!result.wire && result.raw && typeof result.raw === "object");
  const fields = json && !result.ok
    ? discoverShape(result.raw).paths.slice(0, INSPECTOR_FIELDS).map((p) => ({
        path: p.path,
        preview: p.preview.length > INSPECTOR_PREVIEW ? `${p.preview.slice(0, INSPECTOR_PREVIEW)}…` : p.preview,
      }))
    : [];
  return {
    request: {
      method: config.method ?? "POST", address, headers,
      body: body.length > INSPECTOR_BODY_CHARS ? `${body.slice(0, INSPECTOR_BODY_CHARS)}…` : body,
      bodyTruncated: body.length > INSPECTOR_BODY_CHARS,
    },
    response: {
      contentType: result.wire?.contentType ?? null,
      format: result.wire?.format ?? (json ? "json" : null),
      pieces: isStream(result.wire?.format) ? result.wire?.pieces ?? 0 : null,
      matchedPath: result.ok ? result.wire?.matchedPath ?? config.responsePath : null,
      ...(result.wire?.eventKinds && Object.keys(result.wire.eventKinds).length ? { eventKinds: result.wire.eventKinds } : {}),
      ...(result.wire?.structured ? { structured: true } : {}),
    },
    fields,
    notes: [...(sent.notes ?? []), ...deliveryNotes(config)],
  };
}

function isStream(format: string | undefined): boolean {
  return format === "event_stream" || format === "json_lines" || format === "text_stream";
}

/** Past this, a reply is slow enough that long conversations may not fit a run's time slice. */
export const SLOW_REPLY_MS = 20_000;

/** The platform's quoted reason from an adapter error, as its own sentence, or nothing. */
function said(error: string): string {
  const m = /Its platform said: "([\s\S]*?)"\.?(?:\s|$)/.exec(error);
  return m ? ` It said: "${m[1]}".` : "";
}

/** A reply cut for the result card, on a character boundary that does not split a surrogate pair. */
export function previewReply(text: string, max = PREFLIGHT_PREVIEW_CHARS): { preview: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return { preview: clean, truncated: false };
  return { preview: `${chars.slice(0, max).join("").trimEnd()}…`, truncated: true };
}

/** The key names at the top of a JSON value; never a value. An array has none. */
export function topLevelKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.keys(raw as Record<string, unknown>).slice(0, MAX_KEYS);
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

/** What one diagnostic message's result means. */
export function classifyPreflight(
  result: AgentResult,
  config: { responsePath: string },
  timeoutMs: number = PREFLIGHT_TIMEOUT_MS,
): PreflightResult {
  const status = typeof result.statusCode === "number" ? result.statusCode : null;
  const latency = Number.isFinite(result.latencyMs) && result.latencyMs > 0 ? result.latencyMs : null;
  const base = { statusCode: status, latencyMs: latency };
  const error = result.error ?? "";

  if (result.ok && typeof result.responseText === "string") {
    const { preview, truncated } = previewReply(result.responseText);
    return {
      ...base, outcome: "ok", ok: true,
      headline: `Connected: HTTP ${status ?? 200} in ${latency ?? 0} ms`,
      detail: (isStream(result.wire?.format)
        ? `The agent answered as ${result.wire?.format === "json_lines" ? "JSON lines" : result.wire?.format === "text_stream" ? "a text stream" : "a stream"}; the reply is the ${result.wire?.pieces ?? 0} piece${result.wire?.pieces === 1 ? "" : "s"} read at "${result.wire?.matchedPath ?? config.responsePath}", ${result.wire?.pieces ? "in order" : "from the stream's final event"}.`
        : result.wire?.format === "text"
          ? "The agent answered in plain text; the whole body is the reply."
          : result.wire?.structured
            ? `The value at "${config.responsePath}" is structured data, not text; a run grades it as the JSON shown.`
            : `The reply was read at "${config.responsePath}".`)
        + (latency !== null && latency > SLOW_REPLY_MS ? ` The reply took ${seconds(latency)}: a run gives each message at most 30 s, and a conversation scenario sends several, so a slow agent leaves some of them without a result.` : "")
        + " This test is not saved; saving the agent sends one more check and keeps its receipt.",
      replyPreview: preview, replyTruncated: truncated,
    };
  }

  // What the adapter classified, before the status-based reading below.
  const kind = result.failure?.kind;
  if (kind === "throttled") {
    return {
      ...base, outcome: "rate_limited", ok: false,
      headline: status === 429 || status === null ? "The endpoint is limiting requests" : `HTTP ${status}, and the platform refused it as over a limit`,
      detail: `The agent's platform refused this message as over a rate, quota or concurrency limit.${said(error)} In a run, Novera waits and sends again, then slows to one message at a time; a limit that does not lift stops the run after three scenarios, recorded as errors, never as failed scenarios. Check the platform's plan and limits.`,
    };
  }
  if (kind === "web_page") {
    return {
      ...base, outcome: "web_page", ok: false,
      headline: `HTTP ${status ?? 200}, but a web page answered, not the agent`,
      detail: `${error.replace(/^The agent's address answered HTTP \d+ /, "The address answered ")}`,
    };
  }
  if (kind === "repeated_stream") {
    return {
      ...base, outcome: "stream_repeats", ok: false,
      headline: `HTTP ${status ?? 200}, a stream that repeats the whole reply in every event`,
      detail: "Each event carries the whole reply so far, not the next piece of it. Set the stream to \"whole text\" under the connection's advanced settings, and the last event is read as the reply.",
    };
  }
  if (kind === "platform_error" && status !== null && status >= 200 && status < 300) {
    return {
      ...base, outcome: "platform_error", ok: false,
      headline: isStream(result.wire?.format) ? `HTTP ${status}, and the stream ended in an error` : `HTTP ${status}, and the answer was an error`,
      detail: `The agent's platform answered with an error instead of a reply.${said(error)} This is usually the agent's own configuration on the platform: a missing input variable, a step that failed, a model or key it could not use. Fix it there, then test again.`,
    };
  }
  if (kind === "empty" && result.wire?.finished) {
    return {
      ...base, outcome: "empty_reply", ok: false,
      headline: `HTTP ${status ?? 200}, and the agent's answer was empty`,
      detail: `The stream finished normally without any reply text.${said(error)} On a workflow platform, this usually means the path the message took ends without an answer step, or that step's text is empty. Check the agent's flow for this message.`,
    };
  }

  if (result.timedOut) {
    return {
      ...base, outcome: "timeout", ok: false,
      headline: `Could not reach the endpoint within ${seconds(timeoutMs)}`,
      detail: status !== null
        ? `It answered HTTP ${status}, but the reply did not finish arriving in time. A run waits up to the agent's own timeout; check that the endpoint answers promptly.`
        : "Nothing came back in time. Check the address, and that the endpoint is running and reachable from the internet.",
    };
  }

  if (status === null) {
    // Refused before a connection was made: the name resolves to an address Novera never calls.
    if (/private or internal address/i.test(error)) {
      return {
        ...base, outcome: "refused_address", ok: false,
        headline: "Not sent: this is not a public address",
        detail: "The address resolves to a private, loopback or internal network address. Novera calls only addresses on the public internet.",
      };
    }
    return {
      ...base, outcome: "unreachable", ok: false,
      headline: `Could not reach the endpoint within ${seconds(timeoutMs)}`,
      detail: /could not be resolved/i.test(error)
        ? "The host name could not be resolved. Check the address for a typo."
        : "No connection could be made. Check the address, and that the endpoint is running and reachable from the internet.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      ...base, outcome: "unauthorized", ok: false,
      headline: `The endpoint returned HTTP ${status} — check the header or token`,
      detail: `The request reached the endpoint and was refused. Check the header name and the credential under Authentication.${said(error)}`,
    };
  }

  if (status >= 300 && status < 400) {
    // The adapter's error names where it points (`redirectNote`); the address is the whole fix.
    const target = /a redirect to (\S+?)\. /.exec(error)?.[1];
    return {
      ...base, outcome: "redirect", ok: false,
      headline: `The endpoint answered with a redirect (HTTP ${status})`,
      detail: "Novera does not follow redirects, so a request can never be handed on to an address it did not check. "
        + (target ? `It points to ${target}: if that is your agent, enter it as the address.` : "Enter the final address."),
    };
  }

  if (status === 408 || status === 429) {
    // Rate limiting is not a fault in the request: telling a person to check the address and the
    // body sent them looking in the wrong place (audit 2026-10-17). A run treats it the same way,
    // as an unreachable endpoint, never as a failed scenario (`isTransportFailure`).
    return {
      ...base, outcome: "http_error", ok: false,
      headline: `The endpoint returned HTTP ${status}`,
      detail: status === 429
        ? "The endpoint is rate limiting requests. Allow Novera's traffic (one message every 250 ms during a run); in a run this is recorded as an error, never as a failed scenario."
        : "The endpoint timed out waiting for the request. In a run this is recorded as an error, never as a failed scenario.",
    };
  }

  if (status < 200 || status >= 300) {
    return {
      ...base, outcome: "http_error", ok: false,
      headline: `The endpoint returned HTTP ${status}`,
      detail: (status >= 500
        ? "The endpoint was reached and failed while answering. Check its logs; a test sends one short message."
        : "The endpoint was reached and did not accept the request. Check the address and the request body.") + said(error),
    };
  }

  if (/larger than/i.test(error)) {
    return {
      ...base, outcome: "too_large", ok: false,
      headline: `HTTP ${status}, but the reply was too large to read`,
      detail: "Novera reads at most 256 KB of a reply. Point it at an endpoint that answers with the reply itself.",
    };
  }

  if (result.emptyReply) {
    return {
      ...base, outcome: "no_reply_at_path", ok: false,
      headline: `HTTP ${status}, and the reply was empty`,
      detail: `The endpoint answered, and the text at "${config.responsePath}" was empty. Check that the agent answers this message with text; in a run, an empty reply to a customer's message is not a reply.`,
    };
  }

  if (isStream(result.wire?.format)) {
    const kinds = Object.keys(result.wire?.eventKinds ?? {});
    return {
      ...base, outcome: "no_reply_at_path", ok: false,
      headline: `HTTP ${status}, a stream, but no text was found in it`,
      detail: `The endpoint answered as a stream of events, and none carried text at "${config.responsePath}". Set the stream path to the field each event carries its piece of the reply in.`
        + (kinds.length ? ` The events were: ${kinds.slice(0, 8).join(", ")}.` : ""),
    };
  }

  if (typeof result.raw === "string" || result.raw === undefined || result.raw === null) {
    const plain = typeof result.raw === "string" && result.raw.trim() !== "" && !/^\s*</.test(result.raw);
    return {
      ...base, outcome: "not_json", ok: false,
      headline: `HTTP ${status}, but the reply was not JSON`,
      detail: plain
        ? "The endpoint answered with text rather than JSON. If that text is the agent's reply, set the reply path to $text and the whole body is read as the reply."
        : "Novera reads the reply text from a JSON response. Check that the endpoint answers with JSON.",
      ...(plain ? { suggestedPath: "$text" } : {}),
    };
  }

  const keys = topLevelKeys(result.raw);
  const guess = discoverShape(result.raw).replyPaths.find((p) => p !== config.responsePath) ?? null;
  return {
    ...base, outcome: "no_reply_at_path", ok: false,
    headline: `HTTP ${status}, but there is no reply text at "${config.responsePath}"`,
    detail: Array.isArray(result.raw)
      ? "The reply is a JSON array. Set the reply path to the text inside it, for example 0.text."
      : keys.length
        ? "The reply carries these top-level keys. Set the reply path to the one that holds the text."
        : "The reply is an empty JSON object, so there is no text to read.",
    topLevelKeys: keys,
    suggestedPath: guess,
  };
}

/** The refusals a test can meet before anything is sent, as stable codes for the API. */
export type PreflightRefusal = "invalid_request" | "not_found" | "archived" | "rate_limited" | "limit_unavailable" | "not_http";
