import { canonicalise, type Json } from "./hash.ts";

/**
 * Last line of defence before a report becomes a shareable URL.
 *
 * Redaction is done when the payload is built; this is the guard that proves it. It
 * throws rather than stripping, because a payload that still contains a key means the
 * builder has a bug that stripping would hide.
 */
export class LeakError extends Error {
  kind: string;

  constructor(kind: string) {
    super(`Refusing to publish: report payload contains ${kind}`);
    this.name = "LeakError";
    this.kind = kind;
  }
}

/** Shapes that must never reach a shared report, whatever the builder did. */
const PATTERNS: Array<[string, RegExp]> = [
  ["an Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{8,}/],
  ["an OpenAI API key", /\bsk-[A-Za-z0-9]{20,}/],
  ["a Google API key", /\bAIza[A-Za-z0-9_-]{20,}/],
  ["a bearer token", /\bBearer\s+[A-Za-z0-9._-]{16,}/i],
  ["a JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a Supabase service role key", /\bservice_role\b/],
];

/**
 * @param payload the report payload about to be stored and shared
 * @param literals exact strings from this run that must not appear (policy body,
 *        system prompt, decrypted auth header) — checked verbatim
 */
export function assertPublishable(payload: Json, literals: string[] = []): void {
  const serialised = canonicalise(payload);

  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(serialised)) throw new LeakError(kind);
  }

  for (const literal of literals) {
    // Short strings produce false positives against ordinary prose; a real secret or
    // a policy document is never this small.
    if (literal.length < 24) continue;
    if (serialised.includes(literal)) throw new LeakError("private run material");
  }
}
