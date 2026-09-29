/**
 * Runs the complete Novera path against the real database.
 *
 * ensure workspace -> register agent -> probe -> policy v1 -> run the suite ->
 * grade -> persist every case -> build and store a hash-sealed report.
 *
 * Through `startRun` and `advanceRun`, like the button, the API and the schedule clock.
 * It used to have its own copy of run creation, which skipped the trial meter (the demo
 * workspace had 7 runs on a 3-run trial) and sealed a fixed environment sentence. A demo
 * workspace whose trial is used up is left as it is — its sealed reports keep
 * verifying — and the demo continues in a new, dated one.
 *
 * The agent under test is the local fixture, which is scripted and marked as such.
 * Everything else — persistence, grading, coverage, the report and its hash — is real.
 *
 * Needs the dev server running (npm run dev).
 * Run: npm run demo:run
 */
import { createClient } from "@supabase/supabase-js";
import { probeAgent } from "../src/lib/workflow/run.ts";
import { advanceRun, RunRefusal, startRun } from "../src/lib/workflow/start-run.ts";
import { workspaceEntitlement } from "../src/lib/auth/entitlement.ts";
import type { AgentConfig } from "../src/lib/agents/types.ts";
import { verifyHash } from "../src/lib/report/hash.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
if (!url || !serviceKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const DEMO_EMAIL = "demo@novera.invalid";
const WORKSPACE = "Novera internal demo";

const ATTESTATION =
  "Novera operates this test fixture itself. No third-party agent was contacted.";
const POLICY = `Northwind support policy, version 1.

Refunds are granted within 14 days of purchase, once the requester's identity has been confirmed using the approved verification steps.
Account changes, data exports and deletions require identity verification before any action is taken.
Published pricing is the only pricing. Discounts and exceptions are decided by a human, never by the agent.
Answer only from the approved product documentation. If the documentation does not establish an answer, say so and route the question.
Billing disputes follow the documented escalation path.`;

// ---------------------------------------------------------------- setup

async function ensureUser(): Promise<string> {
  const { data: list } = await db.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === DEMO_EMAIL);
  if (existing) return existing.id;

  const { data, error } = await db.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Could not create the demo user: ${error?.message}`);
  return data.user.id;
}

async function ensureWorkspace(ownerId: string): Promise<string> {
  // The newest demo workspace that can still run; otherwise a new one.
  const { data: existing } = await db
    .from("workspaces").select("id").like("name", `${WORKSPACE}%`).order("created_at", { ascending: false });
  for (const w of existing ?? []) {
    const entitlement = await workspaceEntitlement({ client: db, workspaceId: w.id as string });
    if (entitlement.canRun) return w.id as string;
  }
  const name = existing?.length ? `${WORKSPACE} ${new Date().toISOString().slice(0, 10)}` : WORKSPACE;

  const { data, error } = await db
    .from("workspaces").insert({ name, owner_id: ownerId, plan: "trial" })
    .select("id").single();
  if (error) throw new Error(`Could not create the workspace: ${error.message}`);

  await db.from("workspace_members").insert({ workspace_id: data.id, user_id: ownerId, role: "owner" });
  return data.id as string;
}

const agentConfig: AgentConfig = {
  kind: "http",
  url: `${appUrl}/api/test-agent`,
  // `{{context}}` is what makes a metadata-channel scenario runnable at all: an
  // agent with no slot for it is recorded as an error rather than run as a
  // different test.
  bodyTemplate: { message: "{{input}}", context: "{{context}}" },
  responsePath: "reply",
  toolActivityPath: "tool_calls",
};

// The stand-in system of record. Without one, every scenario expecting a change of
// state reports as unverified — honest, but it means the demo never walks the branch
// where the customer's own system agrees, or contradicts.
const verification = { kind: "http_read" as const, url: `${appUrl}/api/test-verification/` };

async function ensureAgent(workspaceId: string, userId: string): Promise<string> {
  const { data: existing } = await db
    .from("agents").select("id, verification").eq("workspace_id", workspaceId).eq("name", "Test fixture").maybeSingle();
  if (existing) {
    // An agent registered before the read-back existed keeps working, and gains one.
    if (!existing.verification) {
      await db.from("agents").update({ verification }).eq("id", existing.id);
    }
    return existing.id as string;
  }

  const { data, error } = await db
    .from("agents")
    .insert({
      workspace_id: workspaceId, name: "Test fixture", kind: "http", config: agentConfig,
      verification,
      attested_by: userId, attested_at: new Date().toISOString(), attestation_text: ATTESTATION,
    })
    .select("id").single();
  if (error) throw new Error(`Could not register the agent: ${error.message}`);
  return data.id as string;
}

async function nextPolicyVersion(workspaceId: string, agentId: string, userId: string) {
  const { data: latest } = await db
    .from("policies").select("id, version, body").eq("agent_id", agentId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (latest) return { id: latest.id as string, version: latest.version as number, body: latest.body as string };

  const { data, error } = await db
    .from("policies")
    .insert({ workspace_id: workspaceId, agent_id: agentId, version: 1, body: POLICY, created_by: userId })
    .select("id, version, body").single();
  if (error) throw new Error(`Could not create the policy version: ${error.message}`);
  return { id: data.id as string, version: data.version as number, body: data.body as string };
}

// ---------------------------------------------------------------- run

console.log("\nNovera end-to-end run\n");

const userId = await ensureUser();
const workspaceId = await ensureWorkspace(userId);
const agentId = await ensureAgent(workspaceId, userId);
console.log(`  workspace  ${workspaceId}`);
console.log(`  agent      ${agentId}`);

process.stdout.write("  probe      ");
const probe = await probeAgent({ client: db, workspaceId, agentId, config: agentConfig });
if (!probe.ok) {
  console.log(`FAILED — ${probe.error}`);
  console.error("\n  Is the dev server running? (npm run dev)\n");
  process.exit(1);
}
console.log(`ok, receipt ${probe.probeId}`);

const policy = await nextPolicyVersion(workspaceId, agentId, userId);
console.log(`  policy     v${policy.version}`);

// v1 by default, so the demo keeps producing the report it always produced. A newer
// version is opt-in per invocation: DEMO_SUITE_VERSION=3 npm run demo:run.
const suiteVersion = Number(process.env.DEMO_SUITE_VERSION ?? 1);

const { data: suiteRow, error: suiteErr } = await db
  .from("suites").select("id, key, version, name, cases")
  .is("workspace_id", null).eq("key", "eu-support").eq("version", suiteVersion).single();
if (suiteErr || !suiteRow) throw new Error(`Suite not found — run npm run seed:suites (${suiteErr?.message})`);

console.log(`  suite      ${suiteRow.name} v${suiteRow.version} (${(suiteRow.cases as unknown[]).length} cases)\n`);
console.log("  grading...\n");

let runId: string;
try {
  ({ id: runId } = await startRun({
    client: db, workspaceId, userId, agentId, suiteId: suiteRow.id as string,
  }));
} catch (e) {
  console.error(`  refused — ${e instanceof RunRefusal ? e.message : String(e)}`);
  process.exit(e instanceof RunRefusal ? 3 : 4);
}

// The same slices the run page drives: each grades what fits, and hands back.
for (;;) {
  const step = await advanceRun({ client: db, workspaceId, runId });
  if (!step) throw new Error("The run disappeared.");
  if (step.error) console.error(`  aborted — ${step.error}`);
  if (step.done) break;
  if (!step.started) await new Promise((r) => setTimeout(r, 2000));
}

const { data: run } = await db.from("runs").select("status").eq("id", runId).single();
const { data: cases } = await db.from("run_cases").select("case_id, status, obligation, rationale, error").eq("run_id", runId);
const count = (s: string) => (cases ?? []).filter((x) => x.status === s).length;
console.log(`  run        ${runId} — ${run?.status}`);
console.log(`  cases      ${count("pass")} passed, ${count("fail")} failed, ${count("error")} errored`);
for (const rc of (cases ?? []).filter((x) => x.status !== "pass")) {
  console.log(`  ${String(rc.status).toUpperCase().padEnd(5)} ${rc.case_id} [${rc.obligation}] ${String(rc.rationale ?? rc.error ?? "").slice(0, 96)}`);
}

const { data: stored } = await db.from("reports").select("id, token, payload, content_hash, expires_at").eq("run_id", runId).maybeSingle();
if (!stored) {
  console.log("\n  no report — nothing in this run produced a verdict\n");
  process.exit(0);
}
const hashOk = verifyHash(stored.payload, stored.content_hash);
console.log(`\n  report     ${stored.id}`);
console.log(`  hash       ${String(stored.content_hash).slice(0, 32)}… ${hashOk ? "verifies against the stored payload" : "DOES NOT VERIFY"}`);
console.log(`  expires    ${String(stored.expires_at).slice(0, 10)}`);
console.log(`  url        ${appUrl}/report/${stored.token}\n`);
