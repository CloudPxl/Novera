/**
 * Where the worker stops. Pure decisions over facts the page reported (page.ts gathers them).
 * A challenge is read page-wide; a login or a payment is read inside the widget, because a site
 * header's "Sign in" link is not the widget asking for credentials.
 */
export interface PageFacts {
  title: string;
  /** The first few thousand characters of the top document's visible text. */
  text: string;
  hasChallengeForm: boolean;
  iframeSrcs: string[];
}

export interface ScopeFacts {
  passwordInputs: number;
  cardInputs: number;
  paymentFrames: number;
  /** The widget's visible text. */
  text: string;
}

const CHALLENGE_TITLE = /just a moment|attention required|verify you are human|are you a robot|access denied|security check|ddos protection/i;
const CHALLENGE_TEXT = /checking your browser|verify you are (a )?human|complete the (security )?check|enable javascript and cookies to continue|press (and|&) hold|i'?m not a robot/i;
const CHALLENGE_FRAME = /hcaptcha\.com|recaptcha|challenges\.cloudflare\.com|turnstile|captcha-delivery|perimeterx|px-captcha|arkoselabs|funcaptcha/i;

export function challengeOf(f: PageFacts): string | null {
  if (f.hasChallengeForm) return "The page shows a challenge form.";
  if (CHALLENGE_TITLE.test(f.title)) return `The page title reads as a bot challenge ("${f.title.slice(0, 80)}").`;
  if (f.iframeSrcs.some((s) => CHALLENGE_FRAME.test(s))) return "The page embeds a captcha.";
  if (CHALLENGE_TEXT.test(f.text)) return "The page text asks the visitor to prove they are human.";
  return null;
}

const LOGIN_TEXT = /\b(log ?in|sign ?in)\b to (chat|continue|start|use)|please (log ?in|sign ?in)|enter your password|password required/i;
const PAYMENT_TEXT = /card number|add a (payment )?card|payment details|enter your card|cvv|cvc\b/i;

export type Stop = { kind: "blocked_login" | "blocked_payment"; detail: string };

export function loginOrPaymentOf(f: ScopeFacts): Stop | null {
  if (f.passwordInputs > 0) return { kind: "blocked_login", detail: "The widget shows a password field." };
  if (f.cardInputs > 0) return { kind: "blocked_payment", detail: "The widget shows a card field." };
  if (f.paymentFrames > 0) return { kind: "blocked_payment", detail: "The widget embeds a payment form." };
  if (PAYMENT_TEXT.test(f.text)) return { kind: "blocked_payment", detail: "The widget asks for payment details." };
  if (LOGIN_TEXT.test(f.text)) return { kind: "blocked_login", detail: "The widget asks the visitor to log in." };
  return null;
}

/** Whether the browser stayed on the target's site: the same host, or one a subdomain of the other, ignoring "www.". */
export function sameSite(target: string, final: string): boolean {
  let a: string, b: string;
  try {
    a = new URL(target).hostname.toLowerCase().replace(/^www\./, "");
    b = new URL(final).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`);
}
