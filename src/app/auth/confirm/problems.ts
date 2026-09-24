/**
 * Why a confirmation link failed, as a code rather than a sentence.
 *
 * `/auth/confirm` used to redirect with the message itself in the query string, and
 * `/sign-in` rendered whatever arrived inside its alert box. React escaped it, so there
 * was no markup injection — but a link like
 * `…/sign-in?problem=Your%20account%20is%20locked,%20call%20+44…` put an attacker's
 * sentence inside Novera's own branded alert, on the one page that asks for a password.
 * Text injection is a phishing primitive even when it cannot execute.
 *
 * So the route names a reason it knows about and this file owns the words. Anything
 * unrecognised gets the neutral line: a stranger's link can no longer say anything at
 * all through us.
 */
export const PROBLEMS = {
  link_invalid: "That confirmation link is not valid. Ask for a new one.",
  link_spent: "That confirmation link has expired or was already used. Ask for a new one.",
  reset_expired: "That password reset link has expired or was already used. Ask for a new one below.",
  signed_out: "You have been signed out.",
} as const;

export type ProblemCode = keyof typeof PROBLEMS;

export function problemMessage(code: string | undefined): string | null {
  if (!code) return null;
  return PROBLEMS[code as ProblemCode] ?? "That link did not work. Sign in, or ask for a new one.";
}
