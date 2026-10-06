/**
 * What went wrong in an authentication call, as a kind this application owns.
 *
 * Supabase's messages are not shown to people: "Error sending confirmation email" names
 * neither what happened to their account (nothing was saved) nor what to do next, and a
 * provider's wording can change under us. Each kind below was observed from GoTrue
 * v2.197 (2026-10-06, local stack with confirmations on): a code where it sends one, the
 * message where it does not — an SMTP failure arrives as `unexpected_failure`.
 */
export type AuthErrorKind =
  | "rate_limited"
  | "email_send_failed"
  | "address_not_allowed"
  | "invalid_address"
  | "weak_password"
  | "signups_closed"
  | "already_registered"
  | "not_confirmed"
  | "invalid_credentials"
  | "provider_disabled"
  | "identity_taken"
  | "manual_linking_disabled"
  | "single_identity"
  | "reauthentication_needed"
  | "same_password"
  | "unknown";

interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
  message?: string | null;
}

const BY_CODE: Record<string, AuthErrorKind> = {
  over_email_send_rate_limit: "rate_limited",
  over_request_rate_limit: "rate_limited",
  email_address_not_authorized: "address_not_allowed",
  email_address_invalid: "invalid_address",
  weak_password: "weak_password",
  signup_disabled: "signups_closed",
  email_provider_disabled: "signups_closed",
  user_already_exists: "already_registered",
  email_exists: "already_registered",
  email_not_confirmed: "not_confirmed",
  invalid_credentials: "invalid_credentials",
  provider_disabled: "provider_disabled",
  oauth_provider_not_supported: "provider_disabled",
  identity_already_exists: "identity_taken",
  manual_linking_disabled: "manual_linking_disabled",
  single_identity_not_deletable: "single_identity",
  reauthentication_needed: "reauthentication_needed",
  same_password: "same_password",
};

export function classifyAuthError(error: AuthErrorLike | null | undefined): AuthErrorKind {
  if (!error) return "unknown";
  const byCode = error.code ? BY_CODE[error.code] : undefined;
  if (byCode) return byCode;
  const message = error.message ?? "";
  if (error.status === 429 || /rate limit|only request this after/i.test(message)) return "rate_limited";
  if (/error sending .*email/i.test(message)) return "email_send_failed";
  if (/not authori[sz]ed/i.test(message)) return "address_not_allowed";
  if (/already registered|already exists|already in use/i.test(message)) return "already_registered";
  if (/email not confirmed/i.test(message)) return "not_confirmed";
  if (/invalid login credentials/i.test(message)) return "invalid_credentials";
  if (/provider is not enabled|unsupported provider/i.test(message)) return "provider_disabled";
  if (/already linked|identity is already/i.test(message)) return "identity_taken";
  if (/manual linking/i.test(message)) return "manual_linking_disabled";
  if (/at least 1 identity|single identity/i.test(message)) return "single_identity";
  if (/password should|weak password/i.test(message)) return "weak_password";
  if (/signups? not allowed|signups? (are )?disabled/i.test(message)) return "signups_closed";
  return "unknown";
}

/** Where a person goes when email cannot reach them. Written once, used by every refusal. */
export const NOT_TRAPPED = "You can continue with Google or GitHub where offered, or write to us at /support — a person reads it.";

/** The sentence a person reads for each kind, worded for the form that was refused. */
export function authErrorMessage(kind: AuthErrorKind, context: "signup" | "signin" | "reset" | "resend" | "link" | "password"): string {
  switch (kind) {
    case "rate_limited":
      return context === "signin"
        ? "Too many attempts for now. Wait a few minutes and try again."
        : `Too many emails have been asked for in a short time, so none was sent. Wait a minute or two and try again. ${NOT_TRAPPED}`;
    case "email_send_failed":
      return context === "signup"
        ? `Your account was not created: the confirmation email could not be sent, and nothing was saved. Try again in a few minutes. ${NOT_TRAPPED}`
        : `The email could not be sent just now. Try again in a few minutes. ${NOT_TRAPPED}`;
    case "address_not_allowed":
      return `Email cannot be sent to that address from here yet, so nothing was created. ${NOT_TRAPPED}`;
    case "invalid_address":
      return "That address does not look like one that can receive email. Check it and try again.";
    case "weak_password":
      return "Choose a stronger password: at least 8 characters, and not a common one.";
    case "signups_closed":
      return `New accounts cannot be created with email and password at the moment. ${NOT_TRAPPED}`;
    case "not_confirmed":
      return "This address has not been confirmed yet. Use the link in the confirmation email, or send a new one below.";
    case "invalid_credentials":
      return "That email address and password do not match an account.";
    case "provider_disabled":
      return "That sign-in method is not available yet. Use email and password, or another method.";
    case "identity_taken":
      return "That account is already connected to a different Novera sign-in, so it was not linked here. Nothing changed.";
    case "manual_linking_disabled":
      return "Connecting another sign-in method is not switched on for this service yet. Nothing changed.";
    case "single_identity":
      return "That is your only way to sign in, so it cannot be removed. Add another method first.";
    case "reauthentication_needed":
      return "For safety, sign out and sign in again, then change your password.";
    case "same_password":
      return "That is already your password. Choose a different one.";
    case "already_registered":
    case "unknown":
      return context === "link"
        ? "That did not work and nothing changed. Try again, or write to us at /support."
        : "That did not work. Try again in a moment, or write to us at /support.";
  }
}
