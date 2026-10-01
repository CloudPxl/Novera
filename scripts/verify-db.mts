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
      // Running, not completed: a completed run refuses every new case (0043), and the
      // invariant checks below must be refused by the invariant, not by that.
      .insert({ workspace_id: ws.id, agent_id: agent.id, policy_id: policy!.id, suite_id: suiteId, status: "running" })
      .select("id")
      .single();
    // ------------------------------------------------ verdict invariants (0019)
    // The application already refuses to write these. The point of checking them
    // here is that a script with the service role bypasses the application and not
    // the constraint — which is the difference between "we are careful" and "it
    // cannot be stored".
    const invariant = async (label: string, row: Record<string, unknown>) => {
      const { error } = await db.from("run_cases").insert({
        workspace_id: ws.id, run_id: run!.id, case_id: "V-INV", category: "verify",
        obligation: "policy_accuracy", severity: "low", input: "x", expected: "y",
        assertions: [], ...row,
      });
      // The refusal has to come from the invariant: an error about the run would make
      // this check pass while proving nothing about the verdict.
      report(Boolean(error) && !/completed|manifest/.test(error?.message ?? ""), label, error?.message ?? "the row was accepted");
      if (!error) await db.from("run_cases").delete().eq("run_id", run!.id).eq("case_id", "V-INV");
    };

    await invariant("a case that errored cannot also be a pass",
      { status: "pass", error: "the endpoint timed out" });
    await invariant("an evidence gap cannot sit on a verdict",
      { status: "pass", evidence_gap: "no_state_evidence" });
    await invariant("a rule-settled case cannot name a judge",
      { status: "fail", settled_by: "deterministic", judge_model: "groq/openai/gpt-oss-120b" });

    // ---------------------------------------------------- the run manifest (0016)
    // A run row is updated several times as it progresses, so the manifest cannot
    // rely on the append-only trigger the evidence tables use. It gets its own, and
    // the claim "these inputs were declared before the run" rests entirely on it.
    await db.from("runs").update({ manifest: { novera_manifest: 1, declared: "first" }, manifest_hash: "hash-one" }).eq("id", run!.id);
    const { data: declared } = await db.from("runs").select("manifest_hash").eq("id", run!.id).single();
    report(declared?.manifest_hash === "hash-one", "a run manifest can be declared once", String(declared?.manifest_hash));

    const { error: rewrite } = await db
      .from("runs").update({ manifest: { novera_manifest: 1, declared: "second" } }).eq("id", run!.id);
    report(Boolean(rewrite), "a declared manifest cannot be rewritten", rewrite?.message ?? "the update was accepted");

    const { error: rehash } = await db
      .from("runs").update({ manifest_hash: "hash-two" }).eq("id", run!.id);
    report(Boolean(rehash), "a declared manifest hash cannot be rewritten", rehash?.message ?? "the update was accepted");

    const { error: progress } = await db
      .from("runs").update({ status: "aborted" }).eq("id", run!.id);
    report(!progress, "a run can still change status with a manifest set", progress?.message ?? "");

    const { data: runCase } = await db
      .from("run_cases")
      .insert({
        workspace_id: ws.id, run_id: run!.id, case_id: "V01", category: "verify",
        obligation: "policy_accuracy", severity: "low", input: "x", expected: "y",
        assertions: [], status: "fail",
      })
      .select("id")
      .single();
    report(Boolean(runCase), "an aborted run still records a scenario that was in flight when it stopped");

    // ------------------------------------- a run's evidence belongs to the run (0043)
    // One row per declared scenario, written while the run is open. Found 2026-09-30:
    // the service role could add rows to a completed run, and for undeclared scenarios.
    const { data: declaredRun } = await db.from("runs").insert({
      workspace_id: ws.id, agent_id: agent.id, policy_id: policy!.id, suite_id: suiteId, status: "running",
      manifest: { novera_manifest: 1, suite: { id: suiteId, key: "k", version: 1, case_ids: ["A1", "A2"] } }, manifest_hash: "h",
    }).select("id").single();
    const scenario = (case_id: string) => ({
      workspace_id: ws.id, run_id: declaredRun!.id, case_id, category: "verify", obligation: "policy_accuracy",
      severity: "low", input: "x", expected: "y", assertions: [], status: "fail",
    });
    const { error: firstRow } = await db.from("run_cases").insert(scenario("A1"));
    report(!firstRow, "a declared scenario is recorded while its run is open", firstRow?.message ?? "");
    const { error: twice } = await db.from("run_cases").insert(scenario("A1"));
    report(/duplicate key/.test(twice?.message ?? ""), "a scenario is recorded once per run (0001)", twice?.message.slice(0, 70) ?? "the second row was accepted");
    const { error: undeclared } = await db.from("run_cases").insert(scenario("Z9"));
    report(/not in the manifest/.test(undeclared?.message ?? ""), "a scenario the manifest did not declare is refused", undeclared?.message.slice(0, 70) ?? "the row was accepted");
    // A completed run holds every scenario it declared (0048): marking one completed while a
    // declared scenario has no row is how a pipeline once read "pass" off a report that
    // said INCOMPLETE (audit R2, planted).
    const { error: early } = await db.from("runs").update({ status: "completed" }).eq("id", declaredRun!.id);
    report(/no recorded result/.test(early?.message ?? ""), "a run cannot be marked completed while a declared scenario has no row",
      early?.message.slice(0, 80) ?? "the run was marked completed with A2 missing");
    const { error: secondRow } = await db.from("run_cases").insert(scenario("A2"));
    const { error: done } = await db.from("runs").update({ status: "completed" }).eq("id", declaredRun!.id);
    report(!secondRow && !done, "once every declared scenario is recorded, it can be", (secondRow ?? done)?.message ?? "");
    const { error: late } = await db.from("run_cases").insert(scenario("A2"));
    report(/is completed/.test(late?.message ?? ""), "a completed run takes no new evidence, even a declared scenario", late?.message.slice(0, 70) ?? "the row was accepted");
    const { count: kept } = await db.from("run_cases").select("id", { count: "exact", head: true }).eq("run_id", declaredRun!.id);
    report(kept === 2, "and the run holds exactly the two rows it recorded", String(kept));
    const { data: partRun } = await db.from("runs").insert({
      workspace_id: ws.id, agent_id: agent.id, policy_id: policy!.id, suite_id: suiteId, status: "running",
      manifest: { novera_manifest: 1, suite: { id: suiteId, key: "k", version: 1, case_ids: ["B1", "B2"] } }, manifest_hash: "h2",
    }).select("id").single();
    await db.from("run_cases").insert({ ...scenario("B1"), run_id: partRun!.id });
    const { error: abortPart } = await db.from("runs").update({ status: "aborted" }).eq("id", partRun!.id);
    report(!abortPart, "an aborted run may end with declared scenarios missing — it is never sealed", abortPart?.message ?? "");

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

    // A retest is evidence too: append-only, and reachable by an erasure. The second
    // half matters as much as the first — every table that refuses deletion needs an
    // erasure path designed alongside it, which this product has now learned four times.
    const { data: retest, error: retestErr } = await db
      .from("case_retests")
      .insert({
        workspace_id: ws.id, run_case_id: runCase!.id, policy_id: policy!.id,
        status: "pass", rationale: "re-tested after a policy change",
      })
      .select("id")
      .single();
    report(!retestErr, "a retest can be recorded", retestErr?.message.slice(0, 70) ?? "");

    if (retest) {
      const { error: retestUpdate } = await db
        .from("case_retests").update({ status: "fail" }).eq("id", retest.id);
      report(!!retestUpdate, "case_retests refuses UPDATE",
        retestUpdate?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

      const { error: retestDelete } = await db.from("case_retests").delete().eq("id", retest.id);
      report(!!retestDelete, "case_retests refuses DELETE outside an erasure",
        retestDelete?.message.slice(0, 70) ?? "the delete SUCCEEDED, which is wrong");
    }

    // ------------------------------------------ evidence observations (0020)
    // What an independent read of the customer's system showed is evidence too, and
    // the strongest kind: it is the only thing that can say an action really
    // happened. It gets the same append-only discipline and the same erasure path.
    const { data: observed, error: observeErr } = await db
      .from("evidence_observations")
      .insert({
        workspace_id: ws.id, run_case_id: runCase!.id,
        connector: "http_read", connector_version: "1.0.0", mode: "read_only",
        status: "contradicted", detail: "the system of record does not show the action",
        checked: [{ type: "must_contain", value: "refunded" }], latency_ms: 12,
      })
      .select("id")
      .single();
    report(!observeErr, "an observation can be recorded", observeErr?.message.slice(0, 70) ?? "");

    if (observed) {
      const { error: observeUpdate } = await db
        .from("evidence_observations").update({ status: "confirmed" }).eq("id", observed.id);
      report(!!observeUpdate, "evidence_observations refuses UPDATE",
        observeUpdate?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

      const { error: observeDelete } = await db
        .from("evidence_observations").delete().eq("id", observed.id);
      report(!!observeDelete, "evidence_observations refuses DELETE outside an erasure",
        observeDelete?.message.slice(0, 70) ?? "the delete SUCCEEDED, which is wrong");
    }

    // ------------------------------------------ verdict reviews (0028)
    // A person's finding sits beside a verdict. The dangerous version of this feature is
    // one where the agency whose agent was tested quietly rewrites a failure before a
    // client sees it, so every property that prevents that is checked here, not read.
    const { data: reviewed, error: reviewErr } = await db
      .from("verdict_reviews")
      .insert({
        workspace_id: ws.id, run_case_id: runCase!.id, reviewer_id: userId,
        verdict_status: "fail", finding: "pass",
        note: "Read the transcript; the agent declined correctly.",
      })
      .select("id")
      .single();
    report(!reviewErr, "a person's finding can be recorded", reviewErr?.message.slice(0, 70) ?? "");

    if (reviewed) {
      const { error: reviewUpdate } = await db
        .from("verdict_reviews").update({ finding: "fail" }).eq("id", reviewed.id);
      report(!!reviewUpdate, "verdict_reviews refuses UPDATE — a changed mind is a second review",
        reviewUpdate?.message.slice(0, 70) ?? "the update SUCCEEDED, which is wrong");

      const { error: reviewDelete } = await db.from("verdict_reviews").delete().eq("id", reviewed.id);
      report(!!reviewDelete, "verdict_reviews refuses DELETE outside an erasure",
        reviewDelete?.message.slice(0, 70) ?? "the delete SUCCEEDED, which is wrong");
    }

    const { data: stillFailed } = await db.from("run_cases").select("status").eq("id", runCase!.id).single();
    report(stillFailed?.status === "fail", "a review that disagrees leaves the verdict exactly as graded",
      `the case reads ${stillFailed?.status}`);

    const { error: reasonless } = await db.from("verdict_reviews").insert({
      workspace_id: ws.id, run_case_id: runCase!.id, reviewer_id: userId,
      verdict_status: "fail", finding: "pass", note: "ok",
    });
    report(!!reasonless, "a finding with no real reason is refused",
      reasonless ? "refused by the constraint" : "it was ACCEPTED, which is wrong");

    const { error: indecisive } = await db.from("verdict_reviews").insert({
      workspace_id: ws.id, run_case_id: runCase!.id, reviewer_id: userId,
      verdict_status: "fail", finding: "error", note: "I could not decide either way here.",
    });
    report(!!indecisive, "a person cannot record 'no result' as a finding",
      indecisive ? "refused by the constraint" : "it was ACCEPTED, which is wrong");

    // A review cannot be attached to another workspace's case, even with the service
    // role, because a finding on someone else's evidence is not a finding.
    const { data: otherWs } = await db
      .from("workspaces").insert({ name: "__novera_verify_other__", owner_id: userId }).select("id").single();
    const { error: crossTenant } = await db.from("verdict_reviews").insert({
      workspace_id: otherWs!.id, run_case_id: runCase!.id, reviewer_id: userId,
      verdict_status: "fail", finding: "pass", note: "Filed against a case in another workspace.",
    });
    report(!!crossTenant, "a review cannot be filed against another workspace's case",
      crossTenant?.message.slice(0, 70) ?? "it was ACCEPTED, which is wrong");
    await db.rpc("erase_workspace", { target: otherWs!.id });

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

    const { count: retestsLeft } = await db
      .from("case_retests").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id);
    report(retestsLeft === 0, "no retest survives the erasure", `${retestsLeft} row(s) left`);

    const { count: observationsLeft } = await db
      .from("evidence_observations").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id);
    report(observationsLeft === 0, "no observation survives the erasure", `${observationsLeft} row(s) left`);

    const { count: reviewsLeft } = await db
      .from("verdict_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id);
    report(reviewsLeft === 0, "no review survives the erasure", `${reviewsLeft} row(s) left`);
  } catch (error) {
    report(false, "integrity checks could not run", error instanceof Error ? error.message : String(error));
  } finally {
    await db.auth.admin.deleteUser(userId);
    console.log("  removed the verification user");
  }
}

// The migration ledger decides which migrations run, so no API role may reach it (0045).
// Every probe is built so that it cannot change anything even where access is open: the
// read asks for no rows, the insert sends a name that can never be stored, and the update
// and delete target a name no migration has. A refusal is told apart from success by
// Postgres's own code, 42501, so this is safe against any database, production included.
console.log("\nThe migration ledger");
{
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const ledgerUser = `verify-ledger+${Date.now()}@novera.invalid`;
  const ledgerPassword = crypto.randomUUID();
  const { data: made } = await db.auth.admin.createUser({ email: ledgerUser, password: ledgerPassword, email_confirm: true });
  try {
    const signedIn = anonKey
      ? await createClient(url, anonKey, { auth: { persistSession: false } }).auth.signInWithPassword({ email: ledgerUser, password: ledgerPassword })
      : null;
    const callers: Array<[string, string | undefined]> = [
      ["anon", anonKey],
      ["authenticated", signedIn?.data.session?.access_token],
      ["service_role", key],
    ];
    const NEVER = "__never_a_migration__";
    for (const [role, token] of callers) {
      if (!token || !anonKey) {
        report(false, `${role}: could not get a token to probe with`);
        continue;
      }
      const probe = async (method: string, query: string, body?: unknown) => {
        const res = await fetch(`${url}/rest/v1/novera_migrations${query}`, {
          method,
          headers: { apikey: role === "service_role" ? key : anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await res.text();
        let code: string | undefined;
        try { code = (JSON.parse(text) as { code?: string }).code; } catch { /* not JSON */ }
        return { status: res.status, code };
      };
      const results = {
        SELECT: await probe("GET", "?select=name&limit=0"),
        INSERT: await probe("POST", "", { name: null, checksum: null }),
        UPDATE: await probe("PATCH", `?name=eq.${NEVER}`, { checksum: "x" }),
        DELETE: await probe("DELETE", `?name=eq.${NEVER}`),
      };
      const open = Object.entries(results).filter(([, r]) => r.code !== "42501");
      report(open.length === 0, `${role} is refused SELECT, INSERT, UPDATE and DELETE on the ledger`,
        open.length ? open.map(([verb, r]) => `${verb} answered ${r.status}${r.code ? ` (${r.code})` : ""}`).join(", ") : "42501 each time");
    }
  } finally {
    if (made?.user) await db.auth.admin.deleteUser(made.user.id);
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
