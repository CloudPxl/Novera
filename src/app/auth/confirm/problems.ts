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
  link_invalid: "That confirmation link is not valid. Send yourself a new one below.",
  link_spent: "That confirmation link has expired or was already used. Send yourself a new one below.",
  reset_expired: "That password reset link has expired or was already used. Ask for a new one below.",
  signed_out: "You have been signed out.",
  signed_out_everywhere: "You have been signed out on every device.",
  // The address is confirmed by the time this is shown: Supabase only sends a code back after
  // the token checked out. What failed is starting a session in *this* browser — the link was
  // opened somewhere other than where the account was created.
  confirmed_sign_in: "Your email address is confirmed. Sign in to continue.",
  oauth_cancelled: "Sign-in was cancelled, so nothing changed. Choose a way to sign in.",
  oauth_failed: "That sign-in did not complete. Try again, or use another method.",
  oauth_verify_email: "That provider has not verified your email address, so we sent a confirmation link to it. Open the link, then continue with the provider again.",
  oauth_no_email: "That account did not share a verified email address, so it cannot be used to sign in here. Use another method, or make the address visible to the provider and try again.",
} as const;

export type ProblemCode = keyof typeof PROBLEMS;

export function problemMessage(code: string | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(PROBLEMS, code) ? PROBLEMS[code as ProblemCode] : "That link did not work. Sign in, or ask for a new one.";
}
