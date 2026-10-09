import { redact } from "../redact/pii.ts";

/**
 * What an error report may carry, and nothing else.
 *
 * An error is the one place where whatever a request held can leave the application by
 * accident: a database refusal quotes the failing row (a policy's text), a provider error
 * echoes the request (a customer's key), a path carries a report's share token — and the
 * token *is* the access control of a sealed report. So the event is built from an allow
 * list, never by copying the error, and every string that survives goes through the
 * scrubber below. Pure and dependency-free so a test can prove it, and so it runs in any
 * runtime.
 *
 * Kept: the error's class name, its digest, a scrubbed and shortened message, scrubbed
 * stack frames, the request method, the route *pattern*, the path with tokens and query
 * removed, and Next's context fields. Dropped: every header but a few harmless ones, the
 * query string, the body, `cause`, any other property of the error, and any caller-supplied
 * detail that is not a short enum-like value under an allowed key.
 */

export interface ScrubbedEvent {
  /** Always "error" today; the field exists so another kind is a value, not a new shape. */
  kind: "error";
  timestamp: string;
  name: string;
  message: string;
  digest?: string;
  stack?: string[];
  request?: { method: string; path: string; headers: Record<string, string>; droppedHeaders: number };
  context?: Record<string, string>;
  detail?: Record<string, string | number | boolean>;
  environment: string;
  release?: string;
}

export const MESSAGE_LIMIT = 500;
export const STACK_FRAMES = 12;

/** Paths whose next segment is a capability or an identifier a stranger should not learn. */
const TOKEN_SEGMENTS = /\/(report|reports|invite|invitations)\/[^/?#]+/g;

/** Text replacements, in order. Each one is a shape that has leaked somewhere before. */
const TEXT_RULES: Array<[RegExp, string]> = [
  // Postgres quotes the row it refused, and the values of a duplicate key: a policy's text,
  // an agent's reply, an email.
  [/Failing row contains \([\s\S]*?\)(?=\.?\s*$|\.\s)/g, "Failing row contains [ROW]"],
  [/Failing row contains \([\s\S]*$/g, "Failing row contains [ROW]"],
  [/Key \(([^)]{1,200})\)=\([^)]*\)/g, "Key ($1)=([VALUE])"],
  // Supabase's session cookies, whole or as their base64 value.
  [/\bsb-[A-Za-z0-9-]+-auth-token(?:[.-][A-Za-z0-9]+)?=[^;\s]*/g, "[COOKIE]"],
  [/\bbase64-[A-Za-z0-9+/=_-]{16,}/g, "[COOKIE]"],
  [/\b(cookie|set-cookie)\s*[:=]\s*[^\n]*/gi, "$1: [REDACTED]"],
  [/\b(authorization|proxy-authorization|x-api-key|apikey)\s*[:=]\s*[^\n;,]*/gi, "$1: [REDACTED]"],
  // URLs keep their origin and path (with tokens removed below); the query string carries
  // one-time codes, token hashes and signatures, so it goes.
  [/(https?:\/\/[^\s"'`?#]+)\?[^\s"'`#]*/g, "$1?[QUERY]"],
  [/(^|[?&\s;,(])((?:code|token|token_hash|access_token|refresh_token|key|apikey|api_key|secret|signature|sig|password)=)[^&\s"'`;,)]+/gi, "$1$2[REDACTED]"],
  // A quoted passage long enough to be content — a policy line, an agent's reply, a prompt
  // — rather than an identifier. Errors that quote what they could not parse are the usual way
  // raw agent content reaches a log.
  // A quote opens only after a boundary and closes only before one, so the closing quote of
  // `"policies"` is never read as the opening of the passage after it.
  [/(?<=^|[\s:(=,[])"[^"\n]{41,}"(?=$|[\s.,;:)\]])/g, "\"[QUOTED_TEXT]\""],
  [/(?<=^|[\s:(=,[])'[^'\n]{41,}'(?=$|[\s.,;:)\]])/g, "'[QUOTED_TEXT]'"],
  [/`[^`\n]{41,}`/g, "`[QUOTED_TEXT]`"],
  [/“[^”\n]{41,}”/g, "“[QUOTED_TEXT]”"],
];

/**
 * Applied after the named rules: any remaining long opaque run — a report token outside a
 * path, a hash-shaped secret, a base64 blob. A legitimate identifier this long (a UUID is 36
 * with dashes) is rarely what a person needs to read an error.
 */
const OPAQUE: [RegExp, string] = [/[A-Za-z0-9_+=-]{40,}/g, "[OPAQUE]"];

/** One string, made safe to leave the application. */
export function scrubText(input: string, limit = MESSAGE_LIMIT): string {
  let text = input.replace(TOKEN_SEGMENTS, (_m, segment: string) => `/${segment}/[token]`);
  for (const [pattern, replacement] of TEXT_RULES) text = text.replace(pattern, replacement);
  // Keys, bearer tokens, JWTs, emails, phones, IBANs, cards, IP addresses: the same rules
  // that redact a production transcript before it is stored.
  text = redact(text).text;
  text = text.replace(OPAQUE[0], OPAQUE[1]);
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;
}

/** A request path: no query, no fragment, no token. */
export function scrubPath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return scrubText(bare.replace(TOKEN_SEGMENTS, (_m, segment: string) => `/${segment}/[token]`), 300);
}

/** Headers worth having in an error and harmless to keep. Everything else is counted, not kept. */
const KEPT_HEADERS = new Set(["accept", "content-type", "content-length", "x-vercel-id", "next-action", "rsc", "next-router-prefetch"]);

export function scrubHeaders(headers: Record<string, string | string[] | undefined>): { headers: Record<string, string>; dropped: number } {
  const kept: Record<string, string> = {};
  let dropped = 0;
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!KEPT_HEADERS.has(name) || value === undefined) { dropped++; continue; }
    // A server action's id is an opaque hash; its presence is the useful part.
    kept[name] = name === "next-action" ? "[present]" : scrubText(Array.isArray(value) ? value.join(", ") : value, 120);
  }
  return { headers: kept, dropped };
}

/** Keys whose values are content, never metadata, whatever their value looks like. */
const CONTENT_KEYS = /body|policy|reply|response|input|output|transcript|content|text|prompt|message|email|token|key|secret|password|cookie|header|auth|url|query/i;
const ENUM_LIKE = /^[A-Za-z0-9_.:/-]{1,64}$/;

/** Caller-supplied detail: short enum-like strings, numbers and booleans, under keys that are not content. */
export function scrubDetail(detail: Record<string, unknown> | undefined): Record<string, string | number | boolean> | undefined {
  if (!detail) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(detail).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key) || CONTENT_KEYS.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && ENUM_LIKE.test(value) && scrubText(value, 64) === value) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Stack frames: the "at …" lines only, scrubbed, at most STACK_FRAMES of them. */
export function scrubStack(stack: string | undefined): string[] | undefined {
  if (!stack) return undefined;
  const frames = stack.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("at ")).slice(0, STACK_FRAMES);
  return frames.length ? frames.map((f) => scrubText(f, 300)) : undefined;
}

const CONTEXT_KEYS = ["routerKind", "routePath", "routeType", "renderSource", "revalidateReason", "renderType"] as const;

export interface RawRequest { path: string; method: string; headers: Record<string, string | string[] | undefined> }

/**
 * Builds the event from an allow list. `error` is whatever was thrown — an Error, a string,
 * anything. Nothing of it is copied except what is named here.
 */
export function scrubEvent(input: {
  error: unknown;
  request?: RawRequest;
  context?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  now?: Date;
  environment?: string;
  release?: string;
}): ScrubbedEvent {
  const { error } = input;
  const isError = error instanceof Error;
  const rawName = isError ? error.name : typeof error;
  const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(rawName) ? rawName : "Error";
  const rawMessage = isError ? error.message : typeof error === "string" ? error : "A non-Error value was thrown.";
  const digest = typeof error === "object" && error !== null && "digest" in error && typeof (error as { digest: unknown }).digest === "string"
    ? scrubText((error as { digest: string }).digest, 80)
    : undefined;

  const event: ScrubbedEvent = {
    kind: "error",
    timestamp: (input.now ?? new Date()).toISOString(),
    name,
    message: scrubText(rawMessage),
    environment: input.environment ?? "unknown",
  };
  if (input.release && ENUM_LIKE.test(input.release)) event.release = input.release;
  if (digest) event.digest = digest;
  const stack = scrubStack(isError ? error.stack : undefined);
  if (stack) event.stack = stack;
  if (input.request) {
    const { headers, dropped } = scrubHeaders(input.request.headers ?? {});
    const method = /^[A-Z]{3,7}$/.test(input.request.method) ? input.request.method : "UNKNOWN";
    event.request = { method, path: scrubPath(input.request.path ?? ""), headers, droppedHeaders: dropped };
  }
  if (input.context) {
    const context: Record<string, string> = {};
    for (const key of CONTEXT_KEYS) {
      const value = input.context[key];
      if (typeof value === "string") context[key] = scrubPath(value);
    }
    if (Object.keys(context).length) event.context = context;
  }
  const detail = scrubDetail(input.detail);
  if (detail) event.detail = detail;
  return event;
}
