/**
 * Proves the trial boundary and the bring-your-own-key path against the live
 * database, on a throwaway workspace.
 *
 * Two claims are made to customers here and neither should rest on reading the code:
 * that the trial is capped, and that a workspace with its own key is graded on that
 * key alone — never quietly on ours, because the report states who funded the
 * grading and that statement has to stay true.
 *
 * Run: npm run verify:byok
 */
import { createClient } from "@supabase/supabase-js";
import { storeSecret } from "../src/lib/store/secrets.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "../src/lib/auth/entitlement.ts";
import { connectionsForWorkspace } from "../src/lib/providers/workspace-connections.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const throwaway = `byok+${Date.now()}@novera.invalid`;
const { data: created, error: userErr } = await db.auth.admin.createUser({
  email: throwaway,
  password: crypto.randomUUID(),
  email_confirm: true,
});
if (userErr || !created?.user) {
  console.error(`Could not create a verification user: ${userErr?.message}`);
  process.exit(1);
}
const userId = created.user.id;

console.log("\nTrial boundary and BYOK");

try {
  const { data: ws } = await db
    .from("workspaces").insert({ name: "__novera_byok__", owner_id: userId }).select("id").single();
  const workspaceId = ws!.id as string;

  const { data: agent } = await db
    .from("agents").insert({ workspace_id: workspaceId, name: "byok", kind: "http", config: {} })
    .select("id").single();
  const { data: policy } = await db
    .from("policies").insert({ workspace_id: workspaceId, agent_id: agent!.id, version: 1, body: "p" })
    .select("id").single();
  const { data: suite } = await db
    .from("suites").select("id").is("workspace_id", null).limit(1).single();

  const fresh = await workspaceEntitlement({ client: db, workspaceId });
  report(fresh.canRun && !fresh.ownKey, "a new workspace may run on the trial allowance",
    `${fresh.runsUsed}/${fresh.runsAllowed}`);
  report(fresh.judgeSource === "trial_free", "a trial run is attributed to the trial allowance");

  // Fill the trial exactly to its limit.
  for (let i = 0; i < TRIAL_RUN_LIMIT; i++) {
    await db.from("runs").insert({
      workspace_id: workspaceId, agent_id: agent!.id, policy_id: policy!.id,
      suite_id: suite!.id, status: "completed", judge_source: "trial_free",
    });
  }

  const exhausted = await workspaceEntitlement({ client: db, workspaceId });
  report(!exhausted.canRun, `the trial stops at ${TRIAL_RUN_LIMIT} runs`,
    exhausted.canRun ? "it did NOT stop, which is wrong" : `${exhausted.runsUsed} used`);
  report(Boolean(exhausted.blockedReason), "the refusal explains itself to the customer");

  // A queued run counts too: three started at once is still three runs.
  const beforeQueued = (await workspaceEntitlement({ client: db, workspaceId })).runsUsed;
  await db.from("runs").insert({
    workspace_id: workspaceId, agent_id: agent!.id, policy_id: policy!.id,
    suite_id: suite!.id, status: "queued", judge_source: "trial_free",
  });
  const afterQueued = (await workspaceEntitlement({ client: db, workspaceId })).runsUsed;
  report(afterQueued === beforeQueued + 1, "a queued run counts against the trial");

  // Now the workspace brings its own key.
  await storeSecret({
    client: db, workspaceId, scope: "judge_key",
    plaintext: "sk-not-a-real-key-only-used-to-prove-resolution", provider: "groq",
  });

  const byok = await workspaceEntitlement({ client: db, workspaceId });
  report(byok.ownKey && byok.canRun, "its own key lifts the cap");
  report(byok.runsAllowed === null, "a workspace on its own key is unmetered");
  report(byok.judgeSource === "workspace_key", "the run is attributed to the customer's key");

  const { connections, source } = await connectionsForWorkspace({ client: db, workspaceId });
  report(source === "workspace_key", "grading resolves to the customer's credential");
  report(connections.size === 1 && connections.has("groq"),
    "our own keys are NOT silently available as a fallback",
    `resolved: ${[...connections.keys()].join(", ") || "none"}`);

  // Removing it puts the workspace back on the capped allowance.
  await db.from("secrets").delete().eq("workspace_id", workspaceId).eq("scope", "judge_key");
  const removed = await workspaceEntitlement({ client: db, workspaceId });
  report(!removed.ownKey && !removed.canRun, "removing the key restores the trial cap");

  const { error: eraseErr } = await db.rpc("erase_workspace", { target: workspaceId });
  report(!eraseErr, "the verification workspace was erased", eraseErr?.message.slice(0, 70) ?? "");
} catch (error) {
  report(false, "the checks could not run", error instanceof Error ? error.message : String(error));
} finally {
  await db.auth.admin.deleteUser(userId);
  console.log("  removed the verification user");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
