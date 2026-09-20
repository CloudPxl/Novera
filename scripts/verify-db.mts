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

    // A diagnosis is the one evidence row that has to change state, so the rule it
    // follows is narrower than append-only: frozen content, one decision, no deletes.
    const { data: builtIn } = await db
      .from("suites").select("id").is("workspace_id", null).limit(1).single();
    if (!builtIn) throw new Error("no built-in suite is seeded; run npm run seed:suites");
    const suiteId = builtIn.id;
    const { data: run } = await db
      .from("runs")
      .insert({ workspace_id: ws.id, agent_id: agent.id, policy_id: policy!.id, suite_id: suiteId, status: "completed" })
      .select("id")
      .single();
    const { data: runCase } = await db
      .from("run_cases")
      .insert({
        workspace_id: ws.id, run_id: run!.id, case_id: "V01", category: "verify",
        obligation: "policy_accuracy", severity: "low", input: "x", expected: "y",
        assertions: [], status: "fail",
      })
      .select("id")
      .single();
    const { data: diagnosis } = await db
      .from("diagnoses")
      .insert({ workspace_id: ws.id, run_case_id: runCase!.id, analysis: "because", proposed_new: "do better" })
      .select("id")
      .single();

    const { error: analysisErr } = await db
      .from("diagnoses").update({ analysis: "rewritten after the fact" }).eq("id", diagnosis!.id);
    report(!!analysisErr, "diagnoses refuses an edit to the analysis",
      analysisErr?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    const { error: unsignedErr } = await db
      .from("diagnoses").update({ status: "rejected" }).eq("id", diagnosis!.id);
    report(!!unsignedErr, "diagnoses refuses a decision with no decider recorded",
      unsignedErr?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    const { error: decideErr } = await db
      .from("diagnoses")
      .update({ status: "rejected", decided_by: userId, decided_at: new Date().toISOString() })
      .eq("id", diagnosis!.id);
    report(!decideErr, "diagnoses accepts exactly one decision", decideErr?.message.slice(0, 70) ?? "");

    const { error: redecideErr } = await db
      .from("diagnoses")
      .update({ status: "approved", decided_by: userId, decided_at: new Date().toISOString() })
      .eq("id", diagnosis!.id);
    report(!!redecideErr, "diagnoses refuses a second decision",
      redecideErr?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    const { error: diagDeleteErr } = await db.from("diagnoses").delete().eq("id", diagnosis!.id);
    report(!!diagDeleteErr, "diagnoses refuses DELETE outside an erasure",
      diagDeleteErr?.message.slice(0, 70) ?? "the delete SUCCEEDED, which is wrong");

    // The support queue carries the same draft/approved/sent discipline, and holds
    // the personal data of people who are not customers — so it gets both halves:
    // the states cannot be skipped, and the whole thing can still be erased.
    const { data: inbound } = await db
      .from("inbound_requests")
      .insert({ kind: "support", email: "verify@novera.invalid", message: "a verification message", status: "new" })
      .select("id")
      .single();
    const { data: draft } = await db
      .from("reply_drafts")
      .insert({ request_id: inbound!.id, body: "a drafted reply", citations: ["limitations"] })
      .select("id")
      .single();

    const { error: bodyErr } = await db
      .from("reply_drafts").update({ body: "quietly reworded" }).eq("id", draft!.id);
    report(!!bodyErr, "a draft's text cannot be edited after the fact",
      bodyErr?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    const { error: skipErr } = await db
      .from("reply_drafts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", draft!.id);
    report(!!skipErr, "a draft cannot be sent without being approved",
      skipErr?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    const { error: unsignedApproval } = await db
      .from("reply_drafts").update({ status: "approved" }).eq("id", draft!.id);
    report(!!unsignedApproval, "an approval must record who made it",
      unsignedApproval?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    await db.from("reply_drafts")
      .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
      .eq("id", draft!.id);
    await db.from("reply_drafts")
      .update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", draft!.id);

    const { error: unsendErr } = await db
      .from("reply_drafts").update({ status: "approved" }).eq("id", draft!.id);
    report(!!unsendErr, "a sent reply cannot be unsent",
      unsendErr?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

    const { error: draftDeleteErr } = await db.from("reply_drafts").delete().eq("id", draft!.id);
    report(!!draftDeleteErr, "a single draft cannot be deleted on its own",
      draftDeleteErr?.message.slice(0, 70) ?? "the delete SUCCEEDED, which is wrong");

    // ...and yet the person who wrote in can still be erased entirely.
    const { error: inboundEraseErr } = await db.rpc("erase_inbound_request", { target: inbound!.id });
    report(!inboundEraseErr, "an inbound request can nevertheless be erased in full",
      inboundEraseErr?.message.slice(0, 70) ?? "");

    const { count: leftover } = await db
      .from("reply_drafts").select("id", { count: "exact", head: true }).eq("request_id", inbound!.id);
    report(leftover === 0, "no draft survives the erasure", `${leftover} row(s) left`);

    // Cleanup goes through the one authorised erasure path. A plain delete is refused
    // by the append-only triggers, and this script used to announce a cleanup it had
    // not performed because it never looked at the error.
    const { error: eraseErr } = await db.rpc("erase_workspace", { target: ws.id });
    report(!eraseErr, "the verification workspace was erased", eraseErr?.message.slice(0, 70) ?? "");
  } catch (error) {
    report(false, "integrity checks could not run", error instanceof Error ? error.message : String(error));
  } finally {
    await db.auth.admin.deleteUser(userId);
    console.log("  removed the verification user");
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
