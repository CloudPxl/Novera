import { scanCustomerLanguage } from "../report/language.ts";

export const OG_DEFAULT_BADGE = "Testing evidence · sealed with SHA-256";
export const OG_DEFAULT_TITLE = "Evidence your AI agent behaves as your policies require";

// Words that must never appear on a card, whatever the language rule's sentence-level logic says.
const FORBIDDEN = /certif|complian|conformant|tamper[\s-]?proof|guarantee|zero[\s-]risk/i;

/** Control characters and angle brackets out, whitespace collapsed, length capped. */
export function cleanCardText(raw: string | null, max: number): string {
  if (!raw) return "";
  const text = raw.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function allowed(text: string): boolean {
  return scanCustomerLanguage(text).length === 0 && !FORBIDDEN.test(text);
}

/** What the card prints for the `title` and `badge` query values. Claim wording falls back to the defaults. */
export function cardText(titleParam: string | null, badgeParam: string | null): { title: string; badge: string } {
  let title = cleanCardText(titleParam, 90);
  if (!title || !allowed(title)) title = OG_DEFAULT_TITLE;
  let badge = cleanCardText(badgeParam, 60);
  if (!badge || !allowed(badge)) badge = OG_DEFAULT_BADGE;
  return { title, badge };
}
