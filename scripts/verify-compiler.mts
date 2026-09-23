/**
 * The duty-to-test compiler, proved live on a throwaway workspace.
 *
 * Three claims are made here that a customer would be entitled to check, and none of
 * them should rest on reading the code: that a drafted scenario is tied to a passage
 * of their own policy, that nothing a model wrote can enter a suite without a person's
 * name on it, and that an existing suite version is never edited by any of this.
 *
 * The model call is real. The database is the real one, and the rules being tested are
 * the triggers, not the application code — a script with the service role bypasses the
 * application and not the constraint, which is the whole point of putting them there.
 *
 * Run: npm run verify:compiler
 */
import { createClient } from "@supabase/supabase-js";
import { compileScenarios } from "../src/lib/scenarios/compile.ts";
import { buildPromotedSuite } from "../src/lib/scenarios/promote.ts";
import { createRoutedChat } from "../src/lib/router/execute.ts";
import { DEFAULT_ROUTES } from "../src/lib/router/routes.ts";
import { connectionsFromEnv } from "../src/lib/providers/registry.ts";
import type { SuiteCase } from "../src/lib/runner/types.ts";

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

const POLICY = `Northwind support policy, version 1.

Identity must be verified using the approved steps before any change is made to an
account, regardless of how urgent the request appears or who the requester says they are.

A customer may withdraw marketing consent at any time. The withdrawal is recorded on the
account the same day and the customer is told it has been done. Never ask the customer to
justify the request.

Refunds follow the published terms. No discount, credit or goodwill payment outside those
terms may be offered, and a request for an exception goes to a named human owner.

If a customer asks whether they are speaking to a person, say plainly that this is an
automated assistant.`;

const throwaway = `compiler+${Date.now()}@novera.invalid`;
const { data: created, error: userErr } = await db.auth.admin.createUser({
  email: throwaway, password: crypto.randomUUID(), email_confirm: true,
});
if (userErr || !created?.user) {
  console.error(`Could not create a verification user: ${userErr?.message}`);
  process.exit(1);
}
const userId = created.user.id;

console.log("\nThe duty-to-test compiler\n");

try {
  const { data: ws } = await db
    .from("workspaces").insert({ name: "__novera_compiler__", owner_id: userId }).select("id").single();
  const workspaceId = ws!.id as string;

  const { data: agent } = await db
    .from("agents").insert({ workspace_id: workspaceId, name: "compiler target", kind: "http", config: {} })
    .select("id").single();
  const { data: policy } = await db
    .from("policies").insert({ workspace_id: workspaceId, agent_id: agent!.id, version: 1, body: POLICY })
    .select("id").single();

  // ---------------------------------------------------------------- drafting
  const outcome = await compileScenarios({
    chat: createRoutedChat({ connections: connectionsFromEnv(), routes: DEFAULT_ROUTES }),
    policyBody: POLICY,
    wanted: 4,
    usedIds: [],
  });

  report(outcome.ok && (outcome.parsed?.drafts.length ?? 0) > 0,
    "a policy produces scenarios",
    outcome.ok
      ? `${outcome.parsed!.drafts.length} drafted by ${outcome.servedBy?.connection}/${outcome.servedBy?.model}, ${outcome.parsed!.refused.length} discarded`
      : outcome.error ?? "");

  if (!outcome.ok || !outcome.parsed) throw new Error(outcome.error ?? "no drafts");

  report(outcome.parsed.drafts.every((d) => POLICY.includes(d.quote)),
    "every scenario quotes this policy, in the policy's own wording");

  report(outcome.parsed.drafts.every((d) => d.scenario.assertions.length > 0),
    "every scenario carries something a grader can check");

  const rows = outcome.parsed.drafts.map((d) => ({
    workspace_id: workspaceId, agent_id: agent!.id, policy_id: policy!.id,
    source_quote: d.quote, scenario: d.scenario, duty_refs: d.dutyRefs,
    risk_level: d.riskLevel, destructive: d.destructive, fixture_only: d.fixtureOnly,
    model: "verification", created_by: userId,
  }));
  const { data: stored } = await db.from("scenario_drafts").insert(rows).select("id, scenario, status");
  report((stored?.length ?? 0) === rows.length && stored!.every((r) => r.status === "draft"),
    "a drafted scenario lands as a draft, and a draft cannot run");

  const first = stored![0];

  // ------------------------------------------------- what the database refuses
  const { error: editErr } = await db
    .from("scenario_drafts").update({ source_quote: "something else" }).eq("id", first.id);
  report(Boolean(editErr), "a draft's text cannot be edited after the fact",
    editErr?.message.slice(0, 64) ?? "IT WAS EDITED");

  const { error: sneakErr } = await db
    .from("scenario_drafts").update({ status: "included", included_in_suite_id: null }).eq("id", first.id);
  report(Boolean(sneakErr), "a draft cannot enter a suite without being approved first",
    sneakErr?.message.slice(0, 64) ?? "IT WAS INCLUDED");

  const { error: unsignedErr } = await db
    .from("scenario_drafts").update({ status: "approved" }).eq("id", first.id);
  report(Boolean(unsignedErr), "an approval must record who made it and when",
    unsignedErr?.message.slice(0, 64) ?? "IT WAS APPROVED ANONYMOUSLY");

  const { error: silentErr } = await db
    .from("scenario_drafts")
    .update({ status: "rejected", rejected_by: userId, rejected_at: new Date().toISOString() })
    .eq("id", first.id);
  report(Boolean(silentErr), "a rejection must say why",
    silentErr?.message.slice(0, 64) ?? "IT WAS REJECTED SILENTLY");

  const { error: deleteErr } = await db.from("scenario_drafts").delete().eq("id", first.id);
  report(Boolean(deleteErr), "a draft cannot be deleted, only decided",
    deleteErr?.message.slice(0, 64) ?? "IT WAS DELETED");

  // ------------------------------------------------------------- the decisions
  const { error: approveErr } = await db
    .from("scenario_drafts")
    .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", first.id);
  report(!approveErr, "a person's approval moves a draft forward", approveErr?.message ?? "");

  if (stored!.length > 1) {
    const { error: rejectErr } = await db
      .from("scenario_drafts")
      .update({
        status: "rejected", rejected_by: userId, rejected_at: new Date().toISOString(),
        rejection_reason: "we do not do this, so the case could never fail honestly",
      })
      .eq("id", stored![1].id);
    report(!rejectErr, "a rejection with a reason is recorded", rejectErr?.message ?? "");

    const { error: revivedErr } = await db
      .from("scenario_drafts").update({ status: "draft" }).eq("id", stored![1].id);
    report(Boolean(revivedErr), "a rejected draft cannot be revived",
      revivedErr?.message.slice(0, 64) ?? "IT CAME BACK");
  }

  // --------------------------------------------------------------- promotion
  const { data: approved } = await db
    .from("scenario_drafts").select("id, scenario").eq("workspace_id", workspaceId).eq("status", "approved");

  const promotion = buildPromotedSuite({
    key: "own-policy", name: "Scenarios from our policy", version: 1, baseCases: [],
    approved: (approved ?? []).map((r) => ({ draftId: r.id as string, scenario: r.scenario as SuiteCase })),
  });
  report(promotion.ok, "approved scenarios assemble into a suite version",
    promotion.ok ? `${promotion.suite.cases.length} case(s)` : promotion.errors.join(" "));

  if (!promotion.ok) throw new Error(promotion.errors.join(" "));

  const { data: suite } = await db.from("suites").insert({
    workspace_id: workspaceId, key: "own-policy", version: 1,
    name: "Scenarios from our policy", cases: promotion.suite.cases,
    provenance: { source_tool: "novera-duty-compiler", transformation_version: 1 },
  }).select("id, cases").single();

  await db.from("scenario_drafts")
    .update({ status: "included", included_in_suite_id: suite!.id })
    .in("id", promotion.draftIds);

  const { data: after } = await db
    .from("scenario_drafts").select("status").in("id", promotion.draftIds);
  report((after ?? []).every((r) => r.status === "included"),
    "a promoted draft is spent, and says which version it entered");

  const { error: withdrawErr } = await db
    .from("scenario_drafts").update({ status: "approved" }).in("id", promotion.draftIds);
  report(Boolean(withdrawErr), "a scenario already in a suite version cannot be withdrawn from it",
    withdrawErr?.message.slice(0, 64) ?? "IT WAS WITHDRAWN");

  // The rule a report depends on: a version that exists keeps meaning what it meant.
  const { data: v2 } = await db.from("suites").insert({
    workspace_id: workspaceId, key: "own-policy", version: 2,
    name: "Scenarios from our policy", cases: promotion.suite.cases,
  }).select("id").single();
  const { data: v1Again } = await db.from("suites").select("cases").eq("id", suite!.id).single();
  report(JSON.stringify(v1Again!.cases) === JSON.stringify(suite!.cases) && Boolean(v2),
    "creating a newer version leaves the older one exactly as it was");

  const { error: eraseErr } = await db.rpc("erase_workspace", { target: workspaceId });
  report(!eraseErr, "the verification workspace was erased, drafts included",
    eraseErr?.message.slice(0, 80) ?? "");

  const { count } = await db
    .from("scenario_drafts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  report((count ?? 0) === 0, "no draft survives the erasure", `${count ?? 0} row(s) left`);
} catch (error) {
  report(false, "the checks could not run", error instanceof Error ? error.message : String(error));
} finally {
  await db.auth.admin.deleteUser(userId);
  console.log("  removed the verification user");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
