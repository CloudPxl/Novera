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

export const REDACTION_POLICY_VERSION = 1;

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
const RULES: Rule[] = [
  { kind: "SECRET", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "SECRET", pattern: /\b(?:sk|gsk|pk|rk)[-_][A-Za-z0-9_-]{6,}|\bsk-or-[A-Za-z0-9_-]{6,}|\bAIza[A-Za-z0-9_-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*|\bBearer\s+[A-Za-z0-9._-]{12,}/g },
  { kind: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
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
    pattern: /(?:\+|00)\d{1,3}[\s().-]*(?:\d[\s().-]*){6,13}\d|\b0\d(?:[\s().-]*\d){7,11}\b/g,
    accept: (m) => m.replace(/\D/g, "").length >= 9,
  },
];

export function redact(input: string): Redaction {
  let text = input;
  const counts: Partial<Record<PiiKind, number>> = {};
  const seen = new Map<string, string>();

  for (const rule of RULES) {
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
