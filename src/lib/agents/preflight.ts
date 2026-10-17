import type { AgentResult } from "./types.ts";
import { discoverShape } from "./discover.ts";

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
      detail: `The reply was read at "${config.responsePath}". This test is not saved; saving the agent sends one more check and keeps its receipt.`,
      replyPreview: preview, replyTruncated: truncated,
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
      detail: "The request reached the endpoint and was refused. Check the header name and the credential under Authentication.",
    };
  }

  if (status >= 300 && status < 400) {
    return {
      ...base, outcome: "redirect", ok: false,
      headline: `The endpoint answered with a redirect (HTTP ${status})`,
      detail: "Novera does not follow redirects, so a request can never be handed on to an address it did not check. Enter the final address.",
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
      detail: status >= 500
        ? "The endpoint was reached and failed while answering. Check its logs; a test sends one short message."
        : "The endpoint was reached and did not accept the request. Check the address and the request body.",
    };
  }

  if (/larger than/i.test(error)) {
    return {
      ...base, outcome: "too_large", ok: false,
      headline: `HTTP ${status}, but the reply was too large to read`,
      detail: "Novera reads at most 256 KB of a reply. Point it at an endpoint that answers with the reply itself.",
    };
  }

  if (typeof result.raw === "string" || result.raw === undefined || result.raw === null) {
    return {
      ...base, outcome: "not_json", ok: false,
      headline: `HTTP ${status}, but the reply was not JSON`,
      detail: "Novera reads the reply text from a JSON response. Check that the endpoint answers with JSON.",
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
