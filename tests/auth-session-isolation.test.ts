import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalRedirect } from "../src/lib/net/canonical-host.ts";
import { pickActiveWorkspace } from "../src/lib/auth/active-workspace.ts";

/**
 * One browser, two people (live test, 2026-10-18): a browser signed in as A signed up B, and B's
 * confirmation link left the browser in A's account. These tests hold the four fixes.
 */

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a sign-up, a password sign-in or a provider sign-in first ends the session this browser holds and its workspace cookie", () => {
  const actions = source("src/app/sign-in/actions.ts");
  for (const call of ["signUp", "signInWithPassword", "signInWithOAuth"]) {
    assert.match(actions, new RegExp(`await endBrowserSession\\(supabase\\);[\\s\\S]{0,160}supabase\\.auth\\.${call}\\(`), `${call} starts from no session`);
  }
  const helper = source("src/lib/auth/switch.ts");
  assert.match(helper, /signOut\(\{ scope: "local" \}\)/, "this browser only, never the person's other devices");
  assert.match(helper, /delete\(ACTIVE_WORKSPACE_COOKIE\)/);
});

test("a callback that cannot spend its link ends the stale session; it never falls through to an older account", () => {
  const callback = source("src/app/auth/callback/handle.ts");
  // Every failure goes through `problem`, and `problem` signs this browser out first.
  assert.match(callback, /const problem = async \(code: ProblemCode, page = "\/sign-in"\) => \{\n\s+await endBrowserSession\(await sessionClient\(\)\);/);
  const exchange = callback.slice(callback.indexOf("exchangeCodeForSession"), callback.indexOf("const recovered"));
  assert.match(exchange, /return problem\("confirmed_sign_in"\)/);
  assert.doesNotMatch(exchange, /to\("\/dashboard"\)|safeNext/, "a failed exchange never redirects onward");
  // Linking a provider happens inside an account and keeps it.
  assert.match(callback, /if \(flow === "link"\) return settings\("problem=link_failed"\);/);
  // A new session never inherits the previous person's workspace choice.
  assert.match(callback, /await forgetWorkspaceChoice\(\);\n\s+if \(flow === "signup"\)/);
  // A token_hash link works without this browser's PKCE verifier, through the route that starts no session.
  assert.match(callback, /new URL\("\/auth\/confirm", url\.origin\)/);
});

test("a stale workspace cookie from another person is ignored: only a workspace this person is a member of is chosen", () => {
  const mine = [{ workspace: { id: "b-1" }, role: "owner" }, { workspace: { id: "b-2" }, role: "admin" }];
  assert.equal(pickActiveWorkspace(mine, "a-workspace-of-someone-else", "b-2").workspace.id, "b-2", "falls back to the default");
  assert.equal(pickActiveWorkspace(mine, "a-workspace-of-someone-else", null).workspace.id, "b-1", "or the first");
  assert.equal(pickActiveWorkspace(mine, "b-2", "b-1").workspace.id, "b-2", "a cookie naming one's own workspace is honoured");
  assert.equal(pickActiveWorkspace(mine, undefined, "missing").workspace.id, "b-1");
});

test("production answers only on www.nover.space: the apex and any other host get a 308 before auth runs", () => {
  const prod = { VERCEL_ENV: "production" };
  for (const raw of ["https://nover.space/auth/callback?code=abc&flow=signup", "https://nover.space/dashboard", "https://novera.vercel.app/sign-in?next=%2Fdashboard"]) {
    const u = new URL(raw);
    assert.equal(canonicalRedirect(u, u.host, prod, "www.nover.space"), `https://www.nover.space${u.pathname}${u.search}`, raw);
  }
  assert.equal(canonicalRedirect(new URL("https://www.nover.space/dashboard"), "www.nover.space", prod, "www.nover.space"), null);
  assert.equal(canonicalRedirect(new URL("https://x.vercel.app/"), "x.vercel.app", { VERCEL_ENV: "preview" }, "www.nover.space"), null, "previews stay put");
  const proxy = source("src/proxy.ts");
  const body = proxy.slice(proxy.indexOf("export async function proxy"));
  assert.ok(body.indexOf("canonicalRedirect(") < body.indexOf("updateSession") || !body.includes("updateSession"), "the host is decided first");
  assert.match(body, /if \(canonical\) return NextResponse\.redirect\(canonical, 308\);/);
});
