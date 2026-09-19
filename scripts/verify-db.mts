/**
 * Checks that the Novera schema is present and that its integrity guarantees are
 * actually enforced by the database — not merely written in a migration file.
 *
 * Run: npm run verify:db
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const TABLES = [
  "workspaces", "workspace_members", "agents", "secrets", "policies",
  "suites", "probes", "runs", "run_cases", "diagnoses", "reports",
];

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

console.log("\nSchema");
for (const table of TABLES) {
  const { error } = await db.from(table).select("*", { count: "exact", head: true });
  report(!error, table, error?.message ?? "");
}

console.log("\nIntegrity");

// The append-only triggers are a core product claim, so they get verified against the
// live database rather than trusted from the migration file. Needs a real auth user
// because workspaces.owner_id references auth.users; created and removed here.
const throwaway = `verify+${Date.now()}@novera.invalid`;
const { data: created, error: userErr } = await db.auth.admin.createUser({
  email: throwaway,
  password: crypto.randomUUID(),
  email_confirm: true,
});

if (userErr || !created?.user) {
  report(false, "could not create a verification user", userErr?.message ?? "no user returned");
} else {
  const userId = created.user.id;
  try {
    const { data: ws, error: wsErr } = await db
      .from("workspaces")
      .insert({ name: "__novera_verify__", owner_id: userId })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(wsErr?.message ?? "no workspace returned");

    const { data: agent, error: agentErr } = await db
      .from("agents")
      .insert({ workspace_id: ws.id, name: "verify", kind: "http", config: {} })
      .select("id")
      .single();
    if (agentErr || !agent) throw new Error(agentErr?.message ?? "no agent returned");

    const { data: probe, error: probeErr } = await db
      .from("probes")
      .insert({ workspace_id: ws.id, agent_id: agent.id, request: { check: true }, status_code: 200 })
      .select("id")
      .single();
    if (probeErr || !probe) throw new Error(probeErr?.message ?? "no probe returned");

    const { error: updateErr } = await db.from("probes").update({ status_code: 500 }).eq("id", probe.id);
    report(!!updateErr, "probes refuses UPDATE even for the service role",
      updateErr?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    const { error: deleteErr } = await db.from("probes").delete().eq("id", probe.id);
    report(!!deleteErr, "probes refuses DELETE even for the service role",
      deleteErr?.message.slice(0, 70) ?? "the delete SUCCEEDED, which is wrong");

    const { data: policy } = await db
      .from("policies")
      .insert({ workspace_id: ws.id, agent_id: agent.id, version: 1, body: "v1 policy" })
      .select("id")
      .single();
    const { error: policyErr } = await db.from("policies").update({ body: "rewritten" }).eq("id", policy!.id);
    report(!!policyErr, "policies refuses UPDATE (a policy version is immutable)",
      policyErr?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    await db.from("workspaces").delete().eq("id", ws.id);
    console.log("  cleaned up the verification workspace");
  } catch (error) {
    report(false, "integrity checks could not run", error instanceof Error ? error.message : String(error));
  } finally {
    await db.auth.admin.deleteUser(userId);
    console.log("  removed the verification user");
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
