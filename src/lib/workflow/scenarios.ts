"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { buildPromotedSuite } from "@/lib/scenarios/promote.ts";
import { importDataset, SOURCE_LABELS } from "@/lib/imports/datasets.ts";
import { recordProductionFailure } from "@/lib/regressions/record.ts";
import type { SuiteCase } from "@/lib/runner/types.ts";
import type { FormState } from "@/lib/workflow/actions.ts";
import { draftScenariosFromPolicy } from "@/lib/workflow/propose.ts";
import { spendModelCall } from "@/lib/workflow/model-budget.ts";
import { buildExtension, extensionKey, MAX_EXTENSION_SCENARIOS } from "@/lib/suites/extension.ts";
import { recordAudit } from "@/lib/audit/record.ts";

/**
 * The duty-to-test compiler, from the operator's side.
 *
 * Three actions and one rule between them: a model may draft, a person decides, and
 * only a decision moves anything. `scenario_drafts` enforces that in the database, so
 * these functions are the place it is *explained*, not the place it is held together.
 */

/**
 * Drafts scenarios from a policy version.
 *
 * Nothing here can run: every draft lands as `draft` and is inert until someone reads
 * it. A drafting attempt that produces nothing usable is not stored, for the same
 * reason a failed diagnosis is not — a row saying "the model could not help" is
 * clutter in a list whose whole job is to be decided.
 */
export async function draftScenarios(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "").trim();
  const wanted = Number(form.get("count") ?? 6);
  const gated = await gate(user.id, workspace.id, "scenario.draft");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;
  const overBudget = await spendModelCall(workspace.id);
  if (overBudget) return { error: overBudget };

  const drafted = await draftScenariosFromPolicy({ db: admin, workspaceId: workspace.id, agentId, wanted, by: { userId: user.id } });
  if (!drafted.ok) return { error: drafted.error };

  revalidatePath("/scenarios");

  const { drafts, refused, policyVersion, servedBy } = drafted.value;
  return {
    notice: `${drafts.length} scenario(s) drafted from policy v${policyVersion} by ${servedBy}.`
      + (refused ? ` ${refused} were discarded before storage: they did not hold up.` : ""),
  };
}

const MAX_IMPORT_BYTES = 1_000_000;

/** How each draft origin is named in a suite's provenance. */
const ORIGIN_TOOL = { policy: "novera-duty-compiler", import: "import", production: "production-failure" } as const;

/**
 * Imports another tool's test cases as drafts.
 *
 * Every item that converts lands as a `draft` with its provenance frozen on the row; an
 * item that does not is reported with its reason and not stored. Nothing is graded,
 * run or promoted here — the same approval as a drafted scenario decides what enters a
 * suite, one scenario at a time.
 */
export async function importScenarioDrafts(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file exported from Promptfoo, DeepEval, LangSmith or Langfuse." };
  if (file.size > MAX_IMPORT_BYTES) {
    return { error: `That file is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_IMPORT_BYTES / 1000} KB.` };
  }
  const gated = await gate(user.id, workspace.id, "scenario.draft");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  // Every id already used by a draft, so an imported case never shares a name with one.
  const { data: existing } = await admin.from("scenario_drafts").select("scenario").eq("workspace_id", workspace.id);
  const usedIds = (existing ?? []).map((row) => (row.scenario as SuiteCase)?.id).filter(Boolean) as string[];

  const result = importDataset(await file.text(), {
    filename: file.name,
    defaultObligation: String(form.get("obligation") ?? "").trim(),
    defaultSeverity: String(form.get("severity") ?? "").trim(),
    inputVar: String(form.get("inputVar") ?? "").trim() || undefined,
    usedIds,
  });
  if (!result.ok) return { error: result.error };

  const importedAt = new Date().toISOString();
  if (result.drafts.length > 0) {
    const { error } = await admin.from("scenario_drafts").insert(
      result.drafts.map((d) => ({
        workspace_id: workspace.id,
        origin: "import",
        scenario: d.scenario,
        import_provenance: { ...d.provenance, imported_by: user.id, imported_at: importedAt },
        duty_refs: [],
        risk_level: d.scenario.severity === "critical" || d.scenario.severity === "high" ? "high" : d.scenario.severity === "low" ? "low" : "medium",
        created_by: user.id,
      })),
    );
    if (error) return { error: `The drafts could not be saved: ${error.message}` };
  }

  revalidatePath("/scenarios");
  const refused = result.refused.length;
  const shown = result.refused.slice(0, 4).map((r) => `${r.source_id}: ${r.reason}`).join(" ");
  const summary = `${result.drafts.length} scenario(s) imported from ${SOURCE_LABELS[result.tool]} as drafts to review.`
    + (refused ? ` ${refused} not imported — ${shown}${refused > 4 ? ` (and ${refused - 4} more)` : ""}` : "")
    + (result.notes.length ? ` ${result.notes.join(" ")}` : "");
  return result.drafts.length ? { notice: summary } : { error: summary };
}

/**
 * A failure seen in production, recorded and drafted as a regression scenario.
 *
 * The work is `recordProductionFailure`, shared with `POST /api/v1/production-failures`:
 * redacted before anything is stored, the original kept only as a hash, the draft built
 * from the person's own statement of what should have happened — no model is asked —
 * and waiting for the same named approval as every other draft.
 */
export async function submitProductionFailure(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const gated = await gate(user.id, workspace.id, "regression.record");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  const result = await recordProductionFailure({
    db: admin,
    workspaceId: workspace.id,
    userId: user.id,
    input: {
      customerMessage: text("customerMessage"),
      agentReply: text("agentReply"),
      expectedBehavior: text("expectedBehavior"),
      whatWentWrong: text("whatWentWrong"),
      obligation: text("obligation"),
      severity: text("severity"),
      agentId: text("agentId") || null,
      occurredOn: text("occurredOn") || null,
    },
  });

  if (!result.ok) {
    if (result.kind !== "invalid") return { error: result.error };
    const p = result.problem;
    if (p.problem === "too_long") return { error: `Keep that field under ${p.limit} characters.` };
    if (p.field === "customerMessage") return { error: "Paste what the customer sent — that is what the scenario will send." };
    if (p.field === "expectedBehavior") return { error: "Say what should have happened. A regression test holds the agent to your expectation, so it cannot be left to guesswork." };
    if (p.field === "obligation") return { error: "Choose which obligation this failure breaks." };
    if (p.field === "severity") return { error: "Choose a severity." };
    return { error: "The date should look like 2026-09-26." };
  }

  revalidatePath("/scenarios");
  if (result.duplicate) {
    return { notice: `This failure was already recorded${result.scenarioId ? `, and drafted as ${result.scenarioId}` : ""}. Nothing new was stored.` };
  }
  const removed = Object.entries(result.removed).map(([kind, n]) => `${n} ${kind.toLowerCase()}`).join(", ");
  return {
    notice: `Recorded, and drafted as ${result.scenarioId} for your review. `
      + (removed ? `Removed before storing: ${removed}. ` : "Nothing needed removing automatically. ")
      + "The original text was not kept.",
  };
}

/**
 * A person's decision on one draft.
 *
 * The database refuses an approval with no name on it and a rejection with no reason,
 * so the only thing this has to get right is passing along who decided and why.
 */
export async function decideScenarioDraft(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const draftId = String(form.get("draftId") ?? "");
  const decision = String(form.get("decision") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const gated = await gate(user.id, workspace.id, "scenario.decide");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  if (decision !== "approve" && decision !== "reject") {
    return { error: "A draft is approved or rejected; there is no third option." };
  }
  if (decision === "reject" && !reason) {
    return { error: "Say why. A rejection with no reason teaches the next draft nothing." };
  }

  const now = new Date().toISOString();
  const patch = decision === "approve"
    ? { status: "approved", approved_by: user.id, approved_at: now }
    : { status: "rejected", rejected_by: user.id, rejected_at: now, rejection_reason: reason };

  const { data: decided, error } = await admin
    .from("scenario_drafts").update(patch)
    .eq("id", draftId).eq("workspace_id", workspace.id).eq("status", "draft").select("id");

  if (error) return { error: `That decision could not be recorded: ${error.message}` };
  // Decided meanwhile, in another tab or by a teammate: say so rather than seem to succeed.
  if (!decided?.length) return { error: "That draft has already been decided. Reload to see how." };

  revalidatePath("/scenarios");
  return { notice: decision === "approve" ? "Approved. It can now enter a suite version." : "Rejected." };
}

/**
 * Promotes every approved draft into a new suite version.
 *
 * Always a new version. The version a report cites has to keep meaning what it meant
 * on the day it was issued, so an existing one is read and never written.
 */
export async function promoteApprovedScenarios(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const key = String(form.get("key") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const extendId = String(form.get("extend") ?? "").trim();
  const gated = await gate(user.id, workspace.id, "scenario.promote");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
    return { error: "A suite key is lowercase letters, digits and hyphens — it identifies the suite across versions." };
  }
  if (!name) return { error: "The suite needs a name." };

  const { data: approved } = await admin
    .from("scenario_drafts").select("id, scenario, origin, import_provenance, production_failure_id")
    .eq("workspace_id", workspace.id).eq("status", "approved")
    // A draft that belongs to a Suite Builder build is published with its build, never from here:
    // promoting it here stranded the build with nothing left to publish (Round 2 audit, 2026-10-19).
    .is("build_id", null)
    .order("created_at");

  if (!approved?.length) {
    return { error: "Nothing has been approved yet. A draft only enters a suite once a person approves it." };
  }

  // Optionally carrying an existing version's cases forward. Read only.
  let baseCases: SuiteCase[] = [];
  if (extendId) {
    const { data: base } = await admin
      .from("suites").select("cases").eq("id", extendId)
      .or(`workspace_id.eq.${workspace.id},workspace_id.is.null`).maybeSingle();
    if (!base) return { error: "The suite version you asked to extend could not be read." };
    baseCases = (base.cases as SuiteCase[]) ?? [];
  }

  const { data: versions } = await admin
    .from("suites").select("version").eq("workspace_id", workspace.id).eq("key", key)
    .order("version", { ascending: false }).limit(1);
  const version = (versions?.[0]?.version ?? 0) + 1;

  const promotion = buildPromotedSuite({
    key, name, version, baseCases,
    approved: approved.map((row) => ({ draftId: row.id as string, scenario: row.scenario as SuiteCase })),
  });

  if (!promotion.ok) return { error: promotion.errors.join(" ") };

  const { data: suite, error } = await admin.from("suites").insert({
    workspace_id: workspace.id,
    key, version, name,
    cases: promotion.suite.cases,
    // Every case approved by a named person (0056 requires promoted_by for this).
    approval: "customer_approved",
    // Where these scenarios came from is part of the evidence, not metadata: every
    // case here was approved by a named person, and was either drafted from a policy
    // version or imported from another tool — said separately, because they are
    // different claims about why a case is in the suite.
    provenance: {
      source_tool: [...new Set(approved.map((r) => ORIGIN_TOOL[r.origin as keyof typeof ORIGIN_TOOL] ?? String(r.origin)))].sort().join("+"),
      transformation_version: 1,
      drafted_from_policies: approved.some((r) => r.origin === "policy"),
      from_policy: approved.filter((r) => r.origin === "policy").length,
      imported: [...new Map(
        approved.filter((r) => r.origin === "import").map((r) => {
          const p = r.import_provenance as { source_tool: string; source_filename: string; original_hash: string };
          return [p.original_hash, { source_tool: p.source_tool, source_filename: p.source_filename, original_hash: p.original_hash }];
        }),
      ).values()],
      // Regression cases name the production failure each one guards against.
      from_production_failures: approved.filter((r) => r.origin === "production").map((r) => r.production_failure_id),
      approved_scenarios: promotion.draftIds.length,
      carried_from_suite: extendId || null,
      promoted_by: user.id,
      promoted_at: new Date().toISOString(),
    },
  }).select("id").single();

  if (error) return { error: `Could not create the suite version: ${error.message}` };

  // Only now are the drafts spent. If this update failed the suite would exist with
  // drafts still marked approved, which reads as "not yet promoted" — the safe way
  // round, because promoting twice creates a new version rather than corrupting one.
  const { error: markError } = await admin
    .from("scenario_drafts")
    .update({ status: "included", included_in_suite_id: suite.id })
    .in("id", promotion.draftIds);

  if (markError) {
    return { error: `${key} v${version} was created, but the drafts could not be marked as included: ${markError.message}` };
  }

  revalidatePath("/scenarios");
  revalidatePath("/dashboard");
  return { notice: `${key} v${version} created with ${promotion.suite.cases.length} scenario(s).` };
}

/**
 * Publishes a suite extension: an official suite version, unchanged, with up to five of this
 * workspace's approved scenarios after it, as a new immutable workspace suite version.
 *
 * The same permission as promoting approved drafts into any suite version, and the same rule:
 * only an approved draft enters, and it is marked included once the version exists. The
 * database (0071) refuses an extension whose base part is not the official suite byte for byte,
 * that adds more than five, or that adds a scenario no one here approved.
 */
export async function publishSuiteExtension(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const baseId = String(form.get("baseSuiteId") ?? "").trim();
  const draftIds = [...new Set(form.getAll("draftId").map((v) => String(v).trim()).filter(Boolean))];
  const gated = await gate(user.id, workspace.id, "scenario.promote");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  if (!baseId) return { error: "Choose the official suite to extend." };
  if (draftIds.length === 0) return { error: "Tick at least one approved scenario to add." };
  // Said before anything is read: the limit is the product's, not a property of these drafts.
  if (draftIds.length > MAX_EXTENSION_SCENARIOS) {
    return { error: `An extension adds at most ${MAX_EXTENSION_SCENARIOS} scenarios to an official suite; ${draftIds.length} were ticked. Untick ${draftIds.length - MAX_EXTENSION_SCENARIOS}, or build your own suite in the Suite Builder.` };
  }

  const [{ data: base }, { data: drafts }] = await Promise.all([
    admin.from("suites").select("id, key, version, name, cases, workspace_id, approval").eq("id", baseId).is("workspace_id", null).maybeSingle(),
    admin.from("scenario_drafts").select("id, status, scenario, destructive, fixture_only").eq("workspace_id", workspace.id).in("id", draftIds),
  ]);
  if (!base) return { error: "That suite is not an official Novera suite, so it cannot be extended here." };
  if ((drafts ?? []).length !== draftIds.length) return { error: "One of the ticked scenarios is not a draft in this workspace. Reload and choose again." };

  const key = extensionKey({ key: base.key as string, version: base.version as number });
  const { data: versions } = await admin
    .from("suites").select("version").eq("workspace_id", workspace.id).eq("key", key)
    .order("version", { ascending: false }).limit(1);
  const version = ((versions?.[0]?.version as number | undefined) ?? 0) + 1;

  // In the order the form lists them, so the suite reads in the order the person saw.
  const ordered = draftIds.map((id) => (drafts ?? []).find((d) => d.id === id)!).filter(Boolean);
  const built = buildExtension({
    base: {
      id: base.id as string, key: base.key as string, version: base.version as number, name: base.name as string,
      cases: (base.cases as SuiteCase[]) ?? [], workspace_id: null, approval: base.approval as string,
    },
    drafts: ordered.map((d) => ({
      draftId: d.id as string, status: d.status as string, scenario: d.scenario as SuiteCase,
      destructive: Boolean(d.destructive), fixture_only: Boolean(d.fixture_only),
    })),
    version,
  });
  if (!built.ok) return { error: built.errors.join(" ") };

  const now = new Date().toISOString();
  const { data: suite, error } = await admin.from("suites").insert({
    workspace_id: workspace.id,
    key: built.key, version: built.version, name: built.name,
    cases: built.cases,
    approval: "customer_approved",
    extends_suite_id: base.id,
    provenance: {
      source_tool: "novera-suite-extension",
      transformation_version: 1,
      extends: built.record,
      approved_scenarios: built.draftIds.length,
      promoted_by: user.id,
      promoted_at: now,
    },
  }).select("id").single();
  if (error || !suite) {
    return { error: `The extension could not be created: ${error?.message ?? "no row returned"}` };
  }

  const { error: markError } = await admin
    .from("scenario_drafts").update({ status: "included", included_in_suite_id: suite.id })
    .in("id", built.draftIds).eq("workspace_id", workspace.id);
  if (markError) {
    return { error: `${built.key} v${built.version} was created, but the drafts could not be marked as included: ${markError.message}` };
  }

  await recordAudit(admin, {
    workspaceId: workspace.id, actorId: user.id, action: "suite.published",
    detail: {
      suite_id: suite.id, key: built.key, version: built.version, kind: "extension",
      extends: { key: built.record.key, version: built.record.version },
      scenarios: built.draftIds.length, case_ids: built.record.extension_case_ids,
    },
  });

  revalidatePath("/scenarios");
  // The launcher in the shared layout offers the new version at once.
  revalidatePath("/", "layout");
  // To the new version in the library: the drafts it took have left the list this form was in,
  // and the form with them, so a notice there would never be seen.
  redirect(`/scenarios?suite=${suite.id as string}`);
}
