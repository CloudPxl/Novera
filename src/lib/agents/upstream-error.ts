import { redact } from "../redact/pii.ts";

/**
 * What an agent's platform said when it refused or failed a request, read from whatever it sent.
 *
 * Platforms put an error in many shapes: Dify `{code, message, status}` (also inside an `error`
 * event of a stream), OpenAI `{error: {message, type, code}}`, Anthropic `{type: "error", error:
 * {type, message}}`, FastAPI `{detail}`, GraphQL-style `{errors: [{message}]}`, a failed Dify
 * workflow `{data: {status: "failed", error}}`. Novera does not interpret what was said — it is
 * quoted, so the person reading the run sees the platform's own words instead of "the stream
 * ended in an error". Quoted text is cleaned first: control characters out, whitespace collapsed,
 * at most 300 characters, and passed through the same pattern redaction as stored evidence, so a
 * platform that echoes a key, an address or a card number back does not leave it in the record.
 *
 * Pure and browser-safe.
 */
export interface UpstreamError {
  code: string | null;
  message: string | null;
  /** A status the platform stated inside the body (Dify's `status: 429`), not the HTTP status. */
  status: number | null;
}

const MAX_QUOTE = 300;

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The error a body or event states, or null when it states none. Only explicit error shapes
 * count: a reply that merely contains the word "error" is a reply.
 */
export function readUpstreamError(data: unknown): UpstreamError | null {
  const d = obj(data);
  if (!d) return null;
  const status = typeof d.status === "number" && d.status >= 400 && d.status <= 599 ? d.status : null;

  // { error: { message, type, code } } (OpenAI, Anthropic, many gateways)
  const nested = obj(d.error);
  if (nested) {
    const message = str(nested.message) ?? str(nested.detail);
    const code = str(nested.code) ?? str(nested.type) ?? str(nested.status);
    if (message || code) return { code, message, status };
  }
  // { errors: [{ message }] }
  if (Array.isArray(d.errors) && d.errors.length) {
    const first = obj(d.errors[0]);
    const message = first ? str(first.message) : str(d.errors[0]);
    if (message) return { code: first ? str(first.code) ?? str(first.extensions && obj(first.extensions)?.code) : null, message, status };
  }
  // A failed workflow or step: { data: { status: "failed", error } } (Dify workflow_finished, node_finished)
  const inner = obj(d.data);
  if (inner && (inner.status === "failed" || inner.status === "stopped") && (str(inner.error) || inner.status === "stopped")) {
    const step = str(inner.title);
    const said = str(inner.error) ?? "the workflow was stopped";
    return { code: inner.status === "stopped" ? "workflow_stopped" : "workflow_failed", message: step ? `${step}: ${said}` : said, status };
  }
  // { error: "message" } or { code, message } (Dify) or { detail } (FastAPI)
  const flatMessage = str(d.error) ?? (typeof d.detail === "string" ? d.detail : null) ?? null;
  const code = typeof d.code === "string" && d.code.trim() ? d.code : null;
  const message = flatMessage ?? (code || status || d.event === "error" || d.type === "error" ? str(d.message) : null);
  if (message || code) return { code, message, status };
  if (status && (d.event === "error" || d.type === "error")) return { code: null, message: null, status };
  return null;
}

/** Text from outside, made safe to store and show: one line, bounded, patterns redacted. */
export function sanitiseUpstream(text: string): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  const bounded = flat.length > MAX_QUOTE ? `${flat.slice(0, MAX_QUOTE - 1)}…` : flat;
  return redact(bounded).text;
}

/** The platform's words as one quotable string, or null when it said nothing. */
export function upstreamQuote(u: UpstreamError | null): string | null {
  if (!u) return null;
  const parts = [u.code, u.message].filter((p): p is string => Boolean(p));
  // A code repeated as the message says it once.
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  const said = unique.join(": ") || (u.status ? `status ${u.status}` : "");
  return said ? sanitiseUpstream(said) : null;
}

/** The sentence every stored error ends with when the platform said something. */
export function platformSaid(quote: string | null): string {
  return quote ? ` Its platform said: "${quote}".` : "";
}

/**
 * The quoted reason inside a stored error sentence: this sentence, or the older stream wording
 * `The agent's stream ended with an error (code: message).` that runs before this module stored.
 */
export function quotedReason(storedError: string | null | undefined): string | null {
  if (!storedError) return null;
  const now = /Its platform said: "([\s\S]*)"\.?\s*$/.exec(storedError) ?? /Its platform said: "([^"]*)"/.exec(storedError);
  if (now) return now[1];
  const old = /stream ended with an error \(([\s\S]+)\)\.?/.exec(storedError);
  return old ? old[1] : null;
}

/**
 * Whether what the platform said is a limit on how much or how fast — a rate limit, a quota, a
 * concurrency cap, an overloaded model — rather than a refusal of this request. Read from its
 * code, message or stated status; one matcher, so the stream, the body and the run agree.
 */
const LIMIT_WORDS = /(rate[\s_-]?limit|too[\s_-]many[\s_-]requests|quota|throttl|concurren|overload|over[\s_-]?capacity|capacity[\s_-]exceeded|resource[\s_-]exhausted|slow[\s_-]down|try[\s_-]again[\s_-]later|limit[\s_-]exceeded|credits?[\s_-](exhausted|exceeded|insufficient)|insufficient[\s_-]credits?)/i;

export function isLimitSignal(u: UpstreamError | null, httpStatus?: number): boolean {
  if (httpStatus === 429) return true;
  if (!u) return false;
  if (u.status === 429) return true;
  return LIMIT_WORDS.test(`${u.code ?? ""} ${u.message ?? ""}`);
}

/** The wait a `Retry-After` header asks for, in ms: seconds or an HTTP date, at most 20 s. */
export const MAX_RETRY_AFTER_MS = 20_000;

export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  let ms: number | undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) ms = Number(trimmed) * 1000;
  else {
    const at = Date.parse(trimmed);
    if (!Number.isNaN(at)) ms = at - now;
  }
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(Math.round(ms), MAX_RETRY_AFTER_MS);
}

/** A short, stable name for a platform's code, for counting one cause across scenarios. */
export function signaturePart(u: UpstreamError | null): string {
  const code = u?.code ?? (u?.status ? String(u.status) : null);
  return code ? code.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 60) : "unspecified";
}

/** Whether an HTTP body is a web page rather than an API answer, and its title. */
export function webPage(contentType: string | null, body: string): { title: string | null } | null {
  const head = body.slice(0, 2048).trimStart().toLowerCase();
  const html = (contentType && /\btext\/html\b/i.test(contentType)) || head.startsWith("<!doctype html") || head.startsWith("<html");
  if (!html) return null;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body.slice(0, 64 * 1024));
  const clean = title ? sanitiseUpstream(title[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')).slice(0, 120) : null;
  return { title: clean || null };
}
