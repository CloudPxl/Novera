import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appOrigin, isOAuthProvider, safeNext } from "../src/lib/auth/redirects.ts";
import { authErrorMessage, classifyAuthError, type AuthErrorKind } from "../src/lib/auth/errors.ts";
import { PROBLEMS, problemMessage } from "../src/app/auth/confirm/problems.ts";

test("safeNext: only a fixed list of destinations, path only", () => {
  for (const ok of ["/dashboard", "/welcome", "/settings/account", "/reset-password", "/builder"]) assert.equal(safeNext(ok), ok);
  assert.equal(safeNext("/invite/abcdefghijklmnop1234"), "/invite/abcdefghijklmnop1234");
  assert.equal(safeNext("/dashboard?ws=11111111-2222"), "/dashboard", "a query string never rides along");
  for (const bad of [
    "//evil.example", "//evil.example/dashboard", "/\\evil.example", "https://evil.example/dashboard", "javascript:alert(1)",
    "/settings/members", "/runs/123", "/invite/short", "/invite/../dashboard/../../x", "dashboard", "", null, undefined,
    "/%2F%2Fevil.example", "/dashboard\u0000", "/\tdashboard", "/" + "a".repeat(400),
  ]) assert.equal(safeNext(bad as string), "/dashboard", String(bad));
  assert.equal(safeNext("//evil", "/welcome"), "/welcome");
});

test("appOrigin: the request's origin only when this deployment answers there", () => {
  const prod = { VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://www.nover.space" };
  assert.equal(appOrigin("https://www.nover.space", prod), "https://www.nover.space");
  assert.equal(appOrigin("https://evil.example", prod), "https://www.nover.space");
  assert.equal(appOrigin("https://novera-git-x.vercel.app", prod), "https://www.nover.space", "a preview alias never ends up in an email");
  assert.equal(appOrigin("http://localhost:3000", prod), "https://www.nover.space", "localhost is refused in production");
  assert.equal(appOrigin(null, prod), "https://www.nover.space");
  const dev = { NEXT_PUBLIC_APP_URL: "http://localhost:3000" };
  assert.equal(appOrigin("http://localhost:3100", dev), "http://localhost:3100");
  assert.equal(appOrigin("http://127.0.0.1:3000", dev), "http://127.0.0.1:3000");
  assert.equal(appOrigin("http://localhost.evil.example", dev), "https://www.nover.space");
  assert.equal(appOrigin("not a url", dev), "https://www.nover.space");
  assert.equal(appOrigin("https://x.example", { CANONICAL_HOST: "x.example", VERCEL_ENV: "production" }), "https://x.example");
});

test("classifyAuthError: each observed GoTrue answer maps to a kind of ours", () => {
  // Observed from GoTrue v2.197, 2026-10-06 (local stack, confirmations on, SMTP down for the 500s).
  const cases: Array<[Parameters<typeof classifyAuthError>[0], AuthErrorKind]> = [
    [{ status: 500, code: "unexpected_failure", message: "Error sending confirmation email" }, "email_send_failed"],
    [{ status: 500, code: "unexpected_failure", message: "Error sending recovery email" }, "email_send_failed"],
    [{ status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 0 seconds." }, "rate_limited"],
    [{ status: 422, code: "user_already_exists", message: "User already registered" }, "already_registered"],
    [{ status: 400, code: "email_not_confirmed", message: "Email not confirmed" }, "not_confirmed"],
    [{ status: 400, code: "invalid_credentials", message: "Invalid login credentials" }, "invalid_credentials"],
    [{ status: 400, code: "email_address_not_authorized", message: "Email address \"x@y.z\" cannot be used as it is not authorized" }, "address_not_allowed"],
    [{ status: 422, code: "identity_already_exists", message: "Identity is already linked to another user" }, "identity_taken"],
    [{ status: 404, code: "manual_linking_disabled", message: "Manual linking is disabled" }, "manual_linking_disabled"],
    [{ status: 422, code: "single_identity_not_deletable", message: "User must have at least 1 identity after unlinking" }, "single_identity"],
    [{ status: 422, code: "weak_password", message: "Password should be at least 8 characters." }, "weak_password"],
    [{ status: 422, code: "signup_disabled", message: "Signups not allowed for this instance" }, "signups_closed"],
    [{ message: "Something nobody has seen" }, "unknown"],
    [null, "unknown"],
  ];
  for (const [error, kind] of cases) assert.equal(classifyAuthError(error), kind, JSON.stringify(error));
});

test("authErrorMessage: no provider wording, a way forward when email cannot reach someone", () => {
  const kinds: AuthErrorKind[] = ["rate_limited", "email_send_failed", "address_not_allowed", "invalid_address", "weak_password", "signups_closed",
    "already_registered", "not_confirmed", "invalid_credentials", "provider_disabled", "identity_taken", "manual_linking_disabled", "single_identity",
    "reauthentication_needed", "same_password", "unknown"];
  for (const kind of kinds) for (const ctx of ["signup", "signin", "reset", "resend", "link", "password"] as const) {
    const m = authErrorMessage(kind, ctx);
    assert.ok(m.length > 10 && !/Error sending|GoTrue|supabase/i.test(m), `${kind}/${ctx}`);
  }
  assert.match(authErrorMessage("email_send_failed", "signup"), /not created.*nothing was saved/);
  for (const kind of ["email_send_failed", "address_not_allowed", "signups_closed"] as const) assert.match(authErrorMessage(kind, "signup"), /Google or GitHub|support/);
});

test("problems: a code from the query string selects our sentence; anything else is neutral", () => {
  for (const code of Object.keys(PROBLEMS)) assert.equal(problemMessage(code), PROBLEMS[code as keyof typeof PROBLEMS]);
  for (const odd of ["constructor", "toString", "__proto__", "hasOwnProperty", "Your account is locked, call +44"]) {
    assert.equal(problemMessage(odd), "That link did not work. Sign in, or ask for a new one.", odd);
  }
  assert.equal(problemMessage(undefined), null);
});

test("providers: only Google and GitHub", () => {
  assert.ok(isOAuthProvider("google") && isOAuthProvider("github"));
  for (const p of ["email", "apple", "", "GitHub", null]) assert.equal(isOAuthProvider(p), false, String(p));
});

test("every email-sending auth call names its return address; none passes a raw origin", () => {
  const actions = readFileSync(new URL("../src/app/sign-in/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /signUp\(\{[\s\S]*?emailRedirectTo: `\$\{await origin\(\)\}\/auth\/callback\?flow=signup`/);
  assert.match(actions, /resend\(\{[\s\S]*?emailRedirectTo: `\$\{await origin\(\)\}\/auth\/callback\?flow=signup`/);
  assert.match(actions, /resetPasswordForEmail\(email, \{\s*redirectTo: `\$\{await origin\(\)\}\/auth\/callback\?flow=recovery`/);
  assert.doesNotMatch(actions, /headers\(\)\)\.get\("origin"\) \?\?/, "the origin is checked by appOrigin, never used as sent");
  const methods = readFileSync(new URL("../src/lib/workflow/sign-in-methods.ts", import.meta.url), "utf8");
  assert.match(methods, /flow=link&provider=/);
  assert.doesNotMatch(methods, /provider_token|provider_refresh_token/, "provider tokens are never read");
});
