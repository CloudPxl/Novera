/**
 * Proves the identity model (0054, 0055) against the live database and app: profiles, roles,
 * invitations, removal, the audit trail, assistant history and memory, erasure of a workspace
 * and of an account, the trial per owner, and retention.
 *
 * Every check runs as a real signed-in user through the anon key — the browser's key — or
 * through the app's own HTTP routes. Inspecting the policies would not prove any of it.
 * Throwaway users and workspaces, all removed at the end.
 *
 * Run: npm run verify:identity   (needs `npm run dev` for the HTTP checks)
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mintKey } from "../src/lib/api/keys.ts";
import { sealThrowawayReport } from "./verify-fixtures.mts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`  ${ok ? " ok " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const section = (s: string) => console.log(`\n${s}`);

interface Person { id: string; email: string; c: SupabaseClient }
const users: string[] = [];
const workspaces: string[] = [];
const stamp = Date.now();

async function person(tag: string): Promise<Person> {
  const email = `identity-${tag}+${stamp}@novera.invalid`, password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create ${tag}: ${error?.message}`);
  users.push(data.user.id);
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error: signIn } = await c.auth.signInWithPassword({ email, password });
  if (signIn) throw new Error(`could not sign ${tag} in: ${signIn.message}`);
  return { id: data.user.id, email, c };
}
async function workspaceOf(owner: Person, name: string): Promise<string> {
  const { data, error } = await owner.c.from("workspaces").insert({ name, owner_id: owner.id }).select("id").single();
  if (error || !data) throw new Error(`workspace: ${error?.message}`);
  workspaces.push(data.id);
  return data.id as string;
}
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
async function invite(ws: string, by: Person, email: string, role: string, extra: Record<string, unknown> = {}) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const { data, error } = await admin.from("workspace_invitations").insert({ workspace_id: ws, email, role, token_hash: sha(token), invited_by: by.id, ...extra }).select("id").single();
  if (error) throw new Error(`invitation: ${error.message}`);
  return { token, id: data!.id as string };
}

// Leftovers from an earlier run that threw before its cleanup.
const { data: before } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const u of before?.users ?? []) {
  if (u.email?.startsWith("identity-")) {
    const { data: owned } = await admin.from("workspaces").select("id").eq("owner_id", u.id);
    for (const w of owned ?? []) await admin.rpc("erase_workspace", { target: w.id });
    await admin.rpc("erase_account", { target: u.id });
    await admin.auth.admin.deleteUser(u.id);
  }
}

let fixture: Awaited<ReturnType<typeof sealThrowawayReport>> | null = null;
try {
  const owner = await person("owner"), ops = await person("operator"), rev = await person("reviewer"), aud = await person("auditor"), out = await person("outsider");
  const A = await workspaceOf(owner, "__identity_A__");

  section("Profiles");
  const { data: p1, error: pe } = await owner.c.rpc("ensure_profile").single();
  check(!pe && (p1 as { account_mode: string }).account_mode === "personal" && (p1 as { onboarding_status: string }).onboarding_status === "not_started",
    "a new account gets a personal profile, onboarding not started", pe?.message);
  const { data: again } = await owner.c.rpc("ensure_profile").single();
  check((again as { user_id: string }).user_id === owner.id, "ensure_profile is idempotent");
  await out.c.rpc("ensure_profile");
  const { data: peek } = await out.c.from("user_profiles").select("user_id").eq("user_id", owner.id);
  check((peek ?? []).length === 0, "nobody reads another person's profile");
  const { error: foreignDefault } = await out.c.from("user_profiles").update({ default_workspace_id: A }).eq("user_id", out.id);
  check(Boolean(foreignDefault), "a profile cannot default to a workspace its person does not belong to", foreignDefault?.message.slice(0, 60));
  const { error: badTz } = await owner.c.from("user_profiles").update({ timezone: "Mars/Olympus" }).eq("user_id", owner.id);
  check(Boolean(badTz), "an unknown timezone is refused", badTz?.message.slice(0, 50));

  section("Invitations");
  const { token: opToken } = await invite(A, owner, ops.email, "operator");
  const { data: acc, error: accErr } = await ops.c.rpc("accept_invitation", { p_token_hash: sha(opToken) }).single();
  check(!accErr && (acc as { role: string }).role === "operator", "the invited address accepts and becomes operator", accErr?.message);
  const { error: reuse } = await ops.c.rpc("accept_invitation", { p_token_hash: sha(opToken) }).single();
  check(/invitation_used/.test(reuse?.message ?? ""), "an invitation works once");
  const { token: revToken } = await invite(A, owner, rev.email, "reviewer");
  const { error: wrongPerson } = await out.c.rpc("accept_invitation", { p_token_hash: sha(revToken) }).single();
  check(/invitation_other_email/.test(wrongPerson?.message ?? ""), "another account cannot accept someone else's invitation");
  await rev.c.rpc("accept_invitation", { p_token_hash: sha(revToken) }).single();
  const { token: audToken } = await invite(A, owner, aud.email, "auditor");
  await aud.c.rpc("accept_invitation", { p_token_hash: sha(audToken) }).single();
  const past = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const { token: oldToken } = await invite(A, owner, out.email, "auditor", { created_at: past, expires_at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
  const { error: expired } = await out.c.rpc("accept_invitation", { p_token_hash: sha(oldToken) }).single();
  check(/invitation_expired/.test(expired?.message ?? ""), "an expired invitation is refused");
  const { token: rvkToken, id: rvkId } = await invite(A, owner, out.email, "auditor");
  await admin.from("workspace_invitations").update({ revoked_at: new Date().toISOString(), revoked_by: owner.id }).eq("id", rvkId);
  const { error: revoked } = await out.c.rpc("accept_invitation", { p_token_hash: sha(rvkToken) }).single();
  check(/invitation_revoked/.test(revoked?.message ?? ""), "a revoked invitation is refused");
  const { error: unrevoke } = await admin.from("workspace_invitations").update({ revoked_at: null }).eq("id", rvkId);
  check(Boolean(unrevoke), "a revoked invitation stays revoked, even for the service role");
  const { data: seenInv } = await ops.c.from("workspace_invitations").select("id").eq("workspace_id", A);
  check((seenInv ?? []).length === 0, "an operator cannot read the workspace's invitations (they carry addresses)");

  section("Roles in the database");
  const { data: agent } = await admin.from("agents").insert({ workspace_id: A, name: "identity agent", kind: "http", config: { url: "https://identity.invalid/chat" }, is_production: false }).select("id").single();
  // 0057: no client writes an agent, whatever its role. The server does, behind the role check.
  await ops.c.from("agents").update({ name: "renamed by operator", is_production: true }).eq("id", agent!.id);
  await rev.c.from("agents").update({ name: "renamed by reviewer" }).eq("id", agent!.id);
  await aud.c.from("agents").update({ name: "renamed by auditor" }).eq("id", agent!.id);
  const { data: afterRev } = await admin.from("agents").select("name, is_production").eq("id", agent!.id).single();
  check(afterRev?.name === "identity agent" && afterRev?.is_production === false,
    "no member edits an agent straight through the REST API — not its name, not the production flag");
  const { error: opInsert } = await ops.c.from("agents").insert({ workspace_id: A, name: "x", kind: "http", config: {} });
  const { error: audInsert } = await aud.c.from("agents").insert({ workspace_id: A, name: "x", kind: "http", config: {} });
  check(Boolean(opInsert) && Boolean(audInsert), "nobody connects an agent through the REST API; connecting is a server action");
  const { error: attest } = await admin.from("agents").update({ attestation_text: "rewritten" }).eq("id", agent!.id);
  check(/attestation and workspace are fixed/.test(attest?.message ?? ""), "an agent's attestation cannot be rewritten, even by the service role");
  const { error: failureInsert } = await ops.c.from("production_failures").insert({ workspace_id: A, customer_message: "card 4111 1111 1111 1111" });
  check(Boolean(failureInsert), "a production failure cannot be inserted by a client, so it cannot skip redaction");
  const { error: throttleAnon } = await createClient(url, anon, { auth: { persistSession: false } }).rpc("throttle_hit", { key: `assistant:${ops.id}`, window_seconds: 3600 });
  const { error: throttleMember } = await ops.c.rpc("throttle_peek", { key: `assistant:${ops.id}`, window_seconds: 3600 });
  check(Boolean(throttleAnon) && Boolean(throttleMember), "nobody but the server can spend or read a rate limit");
  const { data: readByAud } = await aud.c.from("agents").select("id").eq("workspace_id", A);
  check((readByAud ?? []).length === 1, "an auditor reads the workspace's evidence");
  const { error: ownerRemove } = await admin.from("workspace_members").delete().eq("workspace_id", A).eq("user_id", owner.id);
  check(/owner cannot be removed/.test(ownerRemove?.message ?? ""), "the owner cannot be removed, even by the service role");
  const { error: secondOwner } = await admin.from("workspace_members").update({ role: "owner" }).eq("workspace_id", A).eq("user_id", ops.id);
  check(/Only the workspace's owner/.test(secondOwner?.message ?? ""), "nobody else can be given the owner role");
  const { error: badRole } = await admin.from("workspace_members").update({ role: "member" }).eq("workspace_id", A).eq("user_id", ops.id);
  check(Boolean(badRole), "the old 'member' role no longer exists");

  section("Removal");
  const k = mintKey();
  await admin.from("api_keys").insert({ workspace_id: A, name: "ops key", prefix: k.prefix, key_hash: k.hash, scopes: ["read"], created_by: ops.id });
  const apiBefore = await fetch(`${base}/api/v1/agents`, { headers: { authorization: `Bearer ${k.key}` } }).then((r) => r.status).catch(() => 0);
  const { data: revokedKeys, error: removeErr } = await admin.rpc("remove_workspace_member", { p_ws: A, p_user: ops.id, p_actor: owner.id });
  check(!removeErr && revokedKeys === 1, "removing a member revokes the API keys they created", removeErr?.message ?? `${revokedKeys} revoked`);
  const { data: afterRemoval } = await ops.c.from("agents").select("id").eq("workspace_id", A);
  check((afterRemoval ?? []).length === 0, "a removed member's live session reads nothing at once");
  const apiAfter = await fetch(`${base}/api/v1/agents`, { headers: { authorization: `Bearer ${k.key}` } }).then((r) => r.status).catch(() => 0);
  if (apiBefore === 0) check(false, "the app answers for the API checks", `start it at ${base}`);
  else check(apiBefore === 200 && apiAfter === 401, "their API key worked before and is refused after", `${apiBefore} → ${apiAfter}`);
  const { data: removedEvent } = await admin.from("audit_events").select("detail").eq("workspace_id", A).eq("action", "member.removed").eq("subject_user_id", ops.id).maybeSingle();
  check((removedEvent?.detail as { keys_revoked?: number } | undefined)?.keys_revoked === 1, "the removal is in the audit trail with the keys it revoked");
  const { error: rejoin } = await ops.c.from("workspace_members").insert({ workspace_id: A, user_id: ops.id, role: "operator" });
  check(Boolean(rejoin), "a removed member cannot add themselves back");

  section("Audit trail");
  const { data: audSees } = await aud.c.from("audit_events").select("id").eq("workspace_id", A);
  const { data: revSees } = await rev.c.from("audit_events").select("id").eq("workspace_id", A);
  check((audSees ?? []).length > 0 && (revSees ?? []).length === 0, "an auditor reads the trail; a reviewer does not", `${audSees?.length} / ${revSees?.length}`);
  const { error: tamper } = await admin.from("audit_events").update({ action: "member.joined" }).eq("workspace_id", A);
  const { error: erase1 } = await admin.from("audit_events").delete().eq("workspace_id", A);
  check(Boolean(tamper) && Boolean(erase1), "the trail cannot be edited or deleted, even by the service role");

  section("Assistant history and memory");
  const { data: thread } = await admin.from("assistant_threads").insert({ workspace_id: A, user_id: rev.id, title: "reviewer's question" }).select("id").single();
  const { data: msg } = await admin.from("assistant_messages").insert({ thread_id: thread!.id, role: "user", content: "what is no result?" }).select("id").single();
  const { data: ownThread } = await rev.c.from("assistant_threads").select("id");
  const { data: teamThread } = await aud.c.from("assistant_threads").select("id");
  check((ownThread ?? []).length === 1 && (teamThread ?? []).length === 0, "a conversation is visible to its person only, not to teammates");
  const { error: editMsg } = await admin.from("assistant_messages").update({ content: "rewritten" }).eq("id", msg!.id);
  check(Boolean(editMsg), "a stored message cannot be rewritten");
  await admin.from("assistant_memory").insert({ user_id: rev.id, workspace_id: null, key: "language", value: "German", source: "settings" });
  await admin.from("assistant_memory").insert({ user_id: owner.id, workspace_id: A, key: "terminology", value: "Penny is the refund bot", source: "settings" });
  const { data: revMem } = await rev.c.from("assistant_memory").select("key, workspace_id");
  const { data: audMem } = await aud.c.from("assistant_memory").select("key, workspace_id");
  const { data: outMem } = await out.c.from("assistant_memory").select("key");
  check((revMem ?? []).length === 2 && (audMem ?? []).length === 1 && (outMem ?? []).length === 0,
    "personal memory is its person's; workspace memory is its members'; outsiders see neither", `${revMem?.length}/${audMem?.length}/${outMem?.length}`);
  const { error: secretMem } = await admin.from("assistant_memory").insert({ user_id: rev.id, key: "note", value: "my key is sk-live_abcdefghijklmnopqrstuv", source: "settings" });
  check(Boolean(secretMem), "a key-shaped value is refused by the database itself, whoever writes it");

  section("Trial per owner");
  const B = await workspaceOf(owner, "__identity_B__");
  const { data: pol } = await admin.from("policies").insert({ workspace_id: A, agent_id: agent!.id, version: 1, body: "x" }).select("id").single();
  const { data: agentB } = await admin.from("agents").insert({ workspace_id: B, name: "b", kind: "http", config: { url: "https://b.invalid" }, is_production: false }).select("id").single();
  const { data: polB } = await admin.from("policies").insert({ workspace_id: B, agent_id: agentB!.id, version: 1, body: "x" }).select("id").single();
  const { data: suite } = await admin.from("suites").select("id").eq("key", "eu-support").is("workspace_id", null).order("version", { ascending: false }).limit(1).single();
  const run = (ws: string, ag: string, po: string) => admin.from("runs").insert({ workspace_id: ws, agent_id: ag, policy_id: po, suite_id: suite!.id, status: "aborted", judge_source: "trial_free", manifest_hash: `identity-${crypto.randomUUID()}` });
  const r1 = await run(A, agent!.id, pol!.id), r2 = await run(A, agent!.id, pol!.id), r3 = await run(B, agentB!.id, polB!.id), r4 = await run(B, agentB!.id, polB!.id);
  check(!r1.error && !r2.error && !r3.error && /trial_exhausted/.test(r4.error?.message ?? ""),
    "three trial runs per owner across two workspaces; the fourth is refused", r4.error?.message.slice(0, 70) ?? "fourth accepted");

  section("Retention");
  await admin.from("assistant_threads").update({ last_message_at: new Date(Date.now() - 200 * 86_400_000).toISOString() }).eq("id", thread!.id);
  await admin.from("assistant_memory").update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() }).eq("user_id", rev.id).eq("key", "language");
  const { data: pass, error: passErr } = await admin.rpc("expire_inbound_and_probes");
  const { data: goneThread } = await admin.from("assistant_threads").select("id").eq("id", thread!.id);
  const { data: goneMem } = await admin.from("assistant_memory").select("id").eq("user_id", rev.id).eq("key", "language");
  check(!passErr && (goneThread ?? []).length === 0 && (goneMem ?? []).length === 0, "the daily pass removes a conversation idle 180 days and expired memory", JSON.stringify(pass));

  section("Report links after removal");
  fixture = await sealThrowawayReport(admin, "identity");
  await admin.from("workspace_members").insert({ workspace_id: fixture.workspaceId, user_id: rev.id, role: "reviewer" });
  await admin.rpc("remove_workspace_member", { p_ws: fixture.workspaceId, p_user: rev.id, p_actor: rev.id });
  const { data: reportRows } = await rev.c.from("reports").select("id").eq("workspace_id", fixture.workspaceId);
  const link = await fetch(`${base}/report/${fixture.token}`).then((r) => r.status).catch(() => 0);
  check((reportRows ?? []).length === 0 && link === 200, "a removed member loses the workspace; the report link is governed by its token alone", `rows ${reportRows?.length}, link ${link}`);

  section("Your data");
  const exportStatus = await fetch(`${base}/api/me/export`).then((r) => r.status).catch(() => 0);
  check(exportStatus === 401, "the data export refuses a request with no session, in JSON", `${exportStatus}`);

  section("Erasure");
  const { error: ownerErase } = await admin.rpc("erase_account", { target: owner.id });
  check(/owns_workspaces/.test(ownerErase?.message ?? ""), "an account that owns workspaces cannot be erased until they are");
  const { data: revResult, error: revErase } = await admin.rpc("erase_account", { target: rev.id });
  const [{ data: m1 }, { data: m2 }, { data: m3 }] = await Promise.all([
    admin.from("workspace_members").select("workspace_id").eq("user_id", rev.id),
    admin.from("user_profiles").select("user_id").eq("user_id", rev.id),
    admin.from("assistant_memory").select("id").eq("user_id", rev.id),
  ]);
  check(!revErase && !(m1 ?? []).length && !(m2 ?? []).length && !(m3 ?? []).length, "erasing an account removes memberships, profile and memory", JSON.stringify(revResult));
  const { error: eraseA } = await admin.rpc("erase_workspace", { target: A, requested_by: owner.id });
  const [{ data: inv }, { data: ev }, { data: mem }] = await Promise.all([
    admin.from("workspace_invitations").select("id").eq("workspace_id", A),
    admin.from("audit_events").select("id").eq("workspace_id", A),
    admin.from("assistant_memory").select("id").eq("workspace_id", A),
  ]);
  check(!eraseA && !(inv ?? []).length && !(ev ?? []).length && !(mem ?? []).length, "erasing a workspace removes its invitations, audit trail and shared memory", eraseA?.message);
  if (!eraseA) workspaces.splice(workspaces.indexOf(A), 1);
} catch (e) {
  check(false, "the verification ran to the end", e instanceof Error ? e.message : String(e));
} finally {
  if (fixture) await fixture.erase().catch((e) => console.log(`  note  fixture erase: ${e.message}`));
  for (const w of workspaces) {
    await admin.from("runs").update({ status: "aborted" }).eq("workspace_id", w).in("status", ["queued", "running"]);
    const { error } = await admin.rpc("erase_workspace", { target: w });
    if (error) console.log(`  note  could not erase ${w}: ${error.message}`);
  }
  for (const u of users) {
    await admin.rpc("erase_account", { target: u });
    const { error } = await admin.auth.admin.deleteUser(u);
    if (error) console.log(`  note  could not delete user ${u}: ${error.message}`);
  }
}

console.log(failures ? `\n${failures} failed.` : "\nAll passed.");
process.exit(failures ? 1 : 0);
