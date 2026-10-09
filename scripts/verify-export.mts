/**
 * Proves the workspace export (0061) against the live database and a running app: the file is
 * the active workspace's only, carries no other workspace's rows and no report token or agent
 * credential, its receipt records the SHA-256 of exactly the bytes sent, the link works once,
 * for its requester, while they manage the workspace, and not after it expires.
 *
 * Throwaway users and workspaces, erased at the end. Needs 0061 applied and the app running:
 *   VERIFY_EXPORT_BASE=http://localhost:3400 npm run verify:export
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const base = process.env.VERIFY_EXPORT_BASE ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`  ${ok ? " ok " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const stamp = Date.now();
const users: string[] = [];
const workspaces: string[] = [];

/** A person signed in the way the browser is: the SSR client's own cookies, captured. */
async function person(tag: string): Promise<{ id: string; cookie: string }> {
  const email = `export-${tag}+${stamp}@novera.invalid`, password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create ${tag}: ${error?.message}`);
  users.push(data.user.id);
  const jar = new Map<string, string>();
  const c = createServerClient(url, anon, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (set) => { for (const k of set) jar.set(k.name, k.value); } },
  });
  const { error: signIn } = await c.auth.signInWithPassword({ email, password });
  if (signIn) throw new Error(`could not sign ${tag} in: ${signIn.message}`);
  return { id: data.user.id, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}

async function workspace(ownerId: string, name: string): Promise<string> {
  const { data, error } = await admin.from("workspaces").insert({ name, owner_id: ownerId }).select("id").single();
  if (error || !data) throw new Error(`workspace: ${error?.message}`);
  workspaces.push(data.id as string);
  return data.id as string;
}

async function seed(ws: string, ownerId: string, marker: string): Promise<string> {
  const { data: agent, error } = await admin.from("agents").insert({
    workspace_id: ws, name: `Agent ${marker}`, kind: "http", is_production: false, attested_by: ownerId, attested_at: new Date().toISOString(),
    attestation_text: "verify:export fixture", config: { kind: "http", url: `https://${marker}.example/chat`, headers: { authorization: `Bearer SECRET-${marker}` }, bodyTemplate: { q: "{{input}}" }, responsePath: "reply" },
  }).select("id").single();
  if (error || !agent) throw new Error(`agent: ${error?.message}`);
  await admin.from("api_keys").insert({ workspace_id: ws, name: `key ${marker}`, prefix: `nvk_${marker.slice(0, 4)}`, key_hash: "a".repeat(64), scopes: ["read"], created_by: ownerId });
  return agent.id as string;
}

async function job(ws: string, by: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from("workspace_exports").insert({ workspace_id: ws, requested_by: by, ...extra }).select("id").single();
  if (error || !data) throw new Error(`export job: ${error?.message}`);
  return data.id as string;
}

const get = (id: string, cookie: string, ws?: string) =>
  fetch(`${base}/api/workspace-export/${id}`, { headers: { cookie: ws ? `${cookie}; nv_ws=${ws}` : cookie }, redirect: "manual" });

try {
  const a = await person("a"), b = await person("b"), reviewer = await person("r");
  const wa = await workspace(a.id, `Export A ${stamp}`), wb = await workspace(b.id, `Export B ${stamp}`);
  await admin.from("workspace_members").insert({ workspace_id: wa, user_id: reviewer.id, role: "reviewer" });
  await seed(wa, a.id, `alpha${stamp}`);
  await seed(wb, b.id, `bravo${stamp}`);

  console.log("\nDelivery");
  const first = await job(wa, a.id);
  const res = await get(first, a.cookie, wa);
  const body = await res.text();
  check(res.status === 200, "the requester downloads their export", String(res.status));
  check(/attachment; filename="novera-workspace-/.test(res.headers.get("content-disposition") ?? ""), "as an attachment");
  check(/no-store/.test(res.headers.get("cache-control") ?? "") && /noindex/.test(res.headers.get("x-robots-tag") ?? ""), "never cached, never indexed");
  const sha = createHash("sha256").update(body).digest("hex");
  check(res.headers.get("x-novera-export-sha256") === sha, "the SHA-256 header is the body's");
  const doc = JSON.parse(body || "{}");
  check(doc.format === "novera.workspace-export.v1" && doc.workspace?.id === wa, "versioned, and of the active workspace");
  check(body.includes(`alpha${stamp}`) && !body.includes(`bravo${stamp}`), "no other workspace's rows");
  check(!body.includes("SECRET-") && !body.includes("a".repeat(64)) && !body.includes("nvk_"), "no agent credential, key hash or key prefix");
  const { data: receipt } = await admin.from("workspace_exports").select("status, sha256, row_counts").eq("id", first).single();
  check(receipt?.status === "ready" && receipt?.sha256 === sha, "the receipt records exactly the bytes sent");
  const { count: audited } = await admin.from("audit_events").select("*", { count: "exact", head: true }).eq("workspace_id", wa).eq("action", "workspace.exported");
  check((audited ?? 0) === 1, "the download is in the audit trail");

  console.log("\nRefusals");
  check((await get(first, a.cookie, wa)).status === 410, "a second download is refused");
  check((await fetch(`${base}/api/workspace-export/${first}`, { redirect: "manual" })).status === 401, "signed out: 401, not a redirect");
  const forA = await job(wa, a.id);
  check((await get(forA, b.cookie, wb)).status === 404, "another workspace's owner: no such export");
  check((await get(forA, b.cookie, wa)).status === 404, "…even with that workspace forced in the cookie");
  const forReviewer = await job(wa, reviewer.id);
  check((await get(forReviewer, reviewer.cookie, wa)).status === 403, "a reviewer cannot export");
  check((await get(forA, reviewer.cookie, wa)).status === 403, "nor download the owner's export");
  const old = await job(wa, a.id, { created_at: new Date(Date.now() - 3_600_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() });
  check((await get(old, a.cookie, wa)).status === 410, "an expired link is refused");
  const { data: oldRow } = await admin.from("workspace_exports").select("status").eq("id", old).single();
  check(oldRow?.status === "expired", "and recorded as expired");
} finally {
  for (const ws of workspaces) await admin.rpc("erase_workspace", { target: ws, requested_by: null });
  for (const id of users) await admin.auth.admin.deleteUser(id);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll export checks passed.");
process.exit(failures ? 1 : 0);
