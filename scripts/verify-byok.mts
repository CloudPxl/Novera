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
import type { Task } from "../src/lib/router/routes.ts";

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

  // Fill the trial to one short of its limit; the last one is queued, because a queued run
  // counts too: three started at once is still three runs.
  for (let i = 0; i < TRIAL_RUN_LIMIT - 1; i++) {
    await db.from("runs").insert({
      workspace_id: workspaceId, agent_id: agent!.id, policy_id: policy!.id,
      suite_id: suite!.id, status: "completed", judge_source: "trial_free",
    });
  }
  const beforeQueued = (await workspaceEntitlement({ client: db, workspaceId })).runsUsed;
  await db.from("runs").insert({
    workspace_id: workspaceId, agent_id: agent!.id, policy_id: policy!.id,
    suite_id: suite!.id, status: "queued", judge_source: "trial_free",
  });
  const afterQueued = (await workspaceEntitlement({ client: db, workspaceId })).runsUsed;
  report(afterQueued === beforeQueued + 1, "a queued run counts against the trial");

  const exhausted = await workspaceEntitlement({ client: db, workspaceId });
  report(!exhausted.canRun, `the trial stops at ${TRIAL_RUN_LIMIT} runs`,
    exhausted.canRun ? "it did NOT stop, which is wrong" : `${exhausted.runsUsed} used`);
  report(Boolean(exhausted.blockedReason), "the refusal explains itself to the customer");

  // And the database holds the line itself (0049), whoever inserts: the application's check
  // alone let twenty starts at once through.
  const { error: fourth } = await db.from("runs").insert({
    workspace_id: workspaceId, agent_id: agent!.id, policy_id: policy!.id,
    suite_id: suite!.id, status: "queued", judge_source: "trial_free",
  });
  report(/trial_exhausted/.test(fourth?.message ?? ""), `a trial run past the ${TRIAL_RUN_LIMIT}rd is refused by the database, even inserted directly`,
    fourth?.message.slice(0, 70) ?? "the fourth run was accepted");

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

  // Every provider the settings form offers, not just the one that happened to work.
  // Until 2026-09-24 this check tested groq alone, and groq alone was routable: a
  // google, anthropic or openrouter key resolved no candidate at all and errored every
  // case in the run. A verification that exercises one value of four proves one thing.
  const tasks: Task[] = ["judge", "judge_critical", "diagnose", "draft"];
  for (const provider of ["groq", "google", "openrouter", "anthropic"]) {
    await db.from("secrets").delete().eq("workspace_id", workspaceId).eq("scope", "judge_key");
    await storeSecret({
      client: db, workspaceId, scope: "judge_key",
      plaintext: "sk-not-a-real-key-only-used-to-prove-resolution",
      provider, models: ["their-model-a", "their-model-b"],
    });

    const resolved = await connectionsForWorkspace({ client: db, workspaceId });
    const everyTaskRoutable = tasks.every(
      (task) => resolved.routes[task].length > 0
        && resolved.routes[task].every((c) => resolved.connections.has(c.connection)),
    );
    report(everyTaskRoutable, `a ${provider} key can actually grade`,
      everyTaskRoutable
        ? resolved.routes.judge.map((c) => `${c.connection}/${c.model}`).join(", ")
        : "at least one task routes to a connection this workspace has no key for");
  }

  // A key stored before models travelled with it (migration 0025) falls back to the
  // models our own table measures on that connection — and when there are none, the
  // workspace is refused rather than quietly graded on our allowance.
  await db.from("secrets").delete().eq("workspace_id", workspaceId).eq("scope", "judge_key");
  await storeSecret({
    client: db, workspaceId, scope: "judge_key", plaintext: "legacy-key", provider: "groq",
  });
  const legacy = await connectionsForWorkspace({ client: db, workspaceId });
  report(legacy.source === "workspace_key" && legacy.routes.judge.length > 0,
    "a key stored before models were recorded still grades",
    legacy.routes.judge.map((c) => c.model).join(", "));

  await db.from("secrets").delete().eq("workspace_id", workspaceId).eq("scope", "judge_key");
  await storeSecret({
    client: db, workspaceId, scope: "judge_key", plaintext: "legacy-key", provider: "anthropic",
  });
  const unroutable = await workspaceEntitlement({ client: db, workspaceId });
  report(!unroutable.canRun && Boolean(unroutable.blockedReason),
    "an unroutable key refuses the run instead of erroring every case",
    unroutable.blockedReason?.slice(0, 60) ?? "it was allowed to run");
  let fellBack = false;
  try {
    await connectionsForWorkspace({ client: db, workspaceId });
    fellBack = true;
  } catch {
    fellBack = false;
  }
  report(!fellBack, "an unroutable key never falls back to our own credentials");

  // The database refuses the state that caused all of this: a key recorded as having
  // models, with none in the list.
  const { error: emptyModels } = await db.from("secrets").insert({
    workspace_id: workspaceId, scope: "judge_key", provider: "groq",
    models: [], ciphertext: "x", iv: "y", tag: "z",
  });
  report(Boolean(emptyModels), "a judge key cannot be stored with an empty model list",
    emptyModels ? "refused by the constraint" : "it was accepted, which is wrong");

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
