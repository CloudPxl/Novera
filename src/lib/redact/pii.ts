/**
 * Removing what identifies a person from a production transcript, before it is stored.
 *
 * A production failure is the most useful test case there is and the most dangerous
 * one to keep: it is a real customer's words. So the original text is never stored —
 * only the redacted text, a hash of the original (which proves which text it came from
 * without keeping it) and a hash of the result.
 *
 * What it catches, by pattern: email addresses, phone numbers, IBANs, payment card
 * numbers (Luhn-checked, so an order number is not mistaken for one), IPv4 addresses
 * and credentials. What it cannot catch reliably without a model: names and street
 * addresses. Those are the person's to remove, and the form says so — a redactor that
 * claimed to catch names would be trusted exactly where it fails.
 *
 * Placeholders are stable within one text: the same address is `[EMAIL_1]` everywhere
 * it appears, so a scenario still reads as the conversation it came from.
 */

// 2: one placeholder map across all fields of a record (2026-10-08), and Novera's own keys,
// GitHub, AWS and Slack tokens as SECRET.
export const REDACTION_POLICY_VERSION = 2;

export type PiiKind = "EMAIL" | "PHONE" | "IBAN" | "CARD" | "IP" | "SECRET";

export interface Redaction {
  text: string;
  counts: Partial<Record<PiiKind, number>>;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

interface Rule {
  kind: PiiKind;
  pattern: RegExp;
  /** A match the pattern found but that is not really this kind. */
  accept?: (match: string) => boolean;
}

// Order matters: credentials and cards before phones, which would otherwise claim
// their digits; IBAN before cards for the same reason.
//
// Email and phone repetitions are bounded by what the thing can be, and the email's local part may only
// start where a run of its characters starts. Unbounded, the email pattern retried from
// every position of a long token with no "@" — a hash dump, a base64 attachment — and the
// cost grew with the square of its length: 6.9 s for 64 KB, on every report seal and every
// redacted model call (audit 2026-10-01, C6). tests/redact.test.ts holds each family linear.
const RULES: Rule[] = [
  { kind: "SECRET", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // A key is matched whole, however long: each alternative needs its literal prefix, so it
  // starts only where a key starts, and bounding it would leave the tail of a long one.
  { kind: "SECRET", pattern: /\b(?:sk|gsk|pk|rk)[-_][A-Za-z0-9_-]{6,}|\bsk-or-[A-Za-z0-9_-]{6,}|\bAIza[A-Za-z0-9_-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*|\bBearer\s+[A-Za-z0-9._-]{12,}|\b(?:nvk|whsec)_[A-Za-z0-9_-]{8,}|\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  // RFC 5321: a local part is at most 64 characters, a label 63, a name 253.
  { kind: "EMAIL", pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}(?![A-Za-z])/g },
  { kind: "IBAN", pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  {
    kind: "CARD",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    accept: (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits);
    },
  },
  { kind: "IP", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  {
    kind: "PHONE",
    // An international prefix, or a leading 0, then at least eight more digits with the
    // separators people type. A bare run of digits is left alone: it is far more often
    // an order number than a phone number.
    pattern: /(?:\+|00)\d{1,3}[\s().-]{0,3}(?:\d[\s().-]{0,3}){6,13}\d|\b0\d(?:[\s().-]{0,3}\d){7,11}\b/g,
    accept: (m) => m.replace(/\D/g, "").length >= 9,
  },
];

/** Placeholders already given out, so a record's fields share one numbering. */
interface RedactionState {
  counts: Partial<Record<PiiKind, number>>;
  seen: Map<string, string>;
}

export function redact(input: string, options: { only?: PiiKind[]; state?: RedactionState } = {}): Redaction {
  let text = input;
  const counts = options.state?.counts ?? {};
  const seen = options.state?.seen ?? new Map<string, string>();

  for (const rule of RULES) {
    if (options.only && !options.only.includes(rule.kind)) continue;
    text = text.replace(rule.pattern, (match) => {
      if (rule.accept && !rule.accept(match)) return match;
      // Already a placeholder from an earlier rule.
      if (/^\[[A-Z]+_\d+\]$/.test(match)) return match;
      const key = `${rule.kind}:${match.replace(/\s+/g, "").toLowerCase()}`;
      let placeholder = seen.get(key);
      if (!placeholder) {
        counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
        placeholder = `[${rule.kind}_${counts[rule.kind]}]`;
        seen.set(key, placeholder);
      }
      return placeholder;
    });
  }
  return { text, counts };
}

export const NOT_DETECTED =
  "Names and street addresses are not detected automatically; the person submitting removes them.";

/**
 * Several fields of one record, numbered together. Numbered per field, a customer who wrote
 * "I'm a@x.eu, change it to b@y.eu" and an agent who answered "Your email is now b@y.eu" were
 * stored as [EMAIL_2] and [EMAIL_1]: the record said the agent set the old address (app-wide
 * audit, 2026-10-08). Fields are taken in the order given.
 */
export function redactFields<K extends string>(fields: Record<K, string>): { fields: Record<K, string>; counts: Partial<Record<PiiKind, number>> } {
  const state: RedactionState = { counts: {}, seen: new Map() };
  const out = {} as Record<K, string>;
  for (const name of Object.keys(fields) as K[]) out[name] = redact(fields[name], { state }).text;
  return { fields: out, counts: state.counts };
}
