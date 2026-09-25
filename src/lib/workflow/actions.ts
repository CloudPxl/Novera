"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { storeSecret } from "@/lib/store/secrets.ts";
import { probeAgent } from "@/lib/workflow/run.ts";
import { retestCase } from "@/lib/workflow/retest.ts";
import { validateSuite, suiteFromCsv } from "@/lib/suites/validate.ts";
import { diagnoseFailure } from "@/lib/diagnose/index.ts";
import { applyPolicyChange } from "@/lib/diagnose/parse.ts";
import { createRoutedChat } from "@/lib/router/execute.ts";
import { DEFAULT_ROUTES } from "@/lib/router/routes.ts";
import { connectionsFromEnv } from "@/lib/providers/registry.ts";
import { plannedRoutes, workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { explainKeyFailure } from "@/lib/providers/key-failure.ts";
import { REVIEW_NOTE_MIN, REVIEW_NOTE_MAX } from "@/lib/evidence/reviews.ts";
import { manifestForNewRun } from "../report/manifest.ts";
import { httpVerificationConnector } from "../evidence/connectors/http.ts";
import { connectionFor } from "@/lib/providers/workspace-connections.ts";
import type { AgentConfig, HttpAgentConfig } from "@/lib/agents/types.ts";

export interface FormState {
  error?: string;
  notice?: string;
}

/**
 * Registers an agent and immediately proves the connection.
 *
 * The attestation is not a checkbox we forget: it is stored on the agent and copied
 * onto every run, so a report can always say on whose authority the agent was tested.
 */
export async function connectAgent(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();

  const name = String(form.get("name") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  const responsePath = String(form.get("responsePath") ?? "").trim();
  const bodyTemplateRaw = String(form.get("bodyTemplate") ?? "").trim();
  const toolActivityPath = String(form.get("toolActivityPath") ?? "").trim();
  const authHeaderName = String(form.get("authHeaderName") ?? "").trim();
  const authValue = String(form.get("authValue") ?? "");
  const attested = form.get("attested") === "on";

  if (!name) return { error: "Give the agent a name." };
  if (!url) return { error: "Enter the agent's endpoint URL." };
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return { error: "That endpoint URL is not valid." };
  }
  if (!responsePath) return { error: "Tell us where the reply text sits in the response." };
  if (!attested) {
    return { error: "Confirm that you own this agent or are authorised to test it." };
  }

  let bodyTemplate: Record<string, unknown>;
  try {
    bodyTemplate = JSON.parse(bodyTemplateRaw || '{"message":"{{input}}"}');
    if (typeof bodyTemplate !== "object" || Array.isArray(bodyTemplate) || bodyTemplate === null) {
      throw new Error();
    }
  } catch {
    return { error: "The request body must be a JSON object, for example {\"message\": \"{{input}}\"}." };
  }
  if (!JSON.stringify(bodyTemplate).includes("{{input}}")) {
    return { error: "The request body needs {{input}} somewhere, so we know where to put the scenario." };
  }

  const config: HttpAgentConfig = {
    kind: "http",
    url,
    bodyTemplate,
    responsePath,
    ...(toolActivityPath ? { toolActivityPath } : {}),
    ...(authHeaderName ? { authHeaderName } : {}),
  };

  const admin = await assertMembership(user.id, workspace.id);

  const { data: agent, error } = await admin
    .from("agents")
    .insert({
      workspace_id: workspace.id,
      name,
      kind: "http",
      config,
      attested_by: user.id,
      attested_at: new Date().toISOString(),
      attestation_text: `${user.email} confirmed on ${new Date().toISOString().slice(0, 10)} that this agent is owned by their organisation or tested with permission.`,
    })
    .select("id")
    .single();

  if (error) return { error: `Could not save the agent: ${error.message}` };

  if (authValue && authHeaderName) {
    await storeSecret({
      client: admin,
      workspaceId: workspace.id,
      scope: "agent_auth",
      plaintext: authValue,
      agentId: agent.id as string,
    });
  }

  // Prove the connection before anyone is invited to trust a suite run against it.
  await probeAgent({ client: admin, workspaceId: workspace.id, agentId: agent.id as string, config });

  revalidatePath("/dashboard");
  redirect(`/agents/${agent.id}`);
}

/** Freezes a new immutable policy version for an agent. */
export async function savePolicyVersion(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");
  const body = String(form.get("body") ?? "").trim();

  if (!body) return { error: "A policy version cannot be empty." };

  const admin = await assertMembership(user.id, workspace.id);

  const { data: latest } = await admin
    .from("policies")
    .select("version")
    .eq("agent_id", agentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.from("policies").insert({
    workspace_id: workspace.id,
    agent_id: agentId,
    version: (latest?.version ?? 0) + 1,
    body,
    created_by: user.id,
  });

  if (error) return { error: `Could not save the policy: ${error.message}` };

  revalidatePath(`/agents/${agentId}`);
  return { notice: `Saved as version ${(latest?.version ?? 0) + 1}.` };
}

/** Re-probes an existing agent and stores a fresh receipt. */
export async function reprobeAgent(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);

  const { data: agent, error } = await admin
    .from("agents").select("config").eq("id", agentId).eq("workspace_id", workspace.id).single();
  if (error || !agent) return { error: "That agent could not be found." };

  const result = await probeAgent({
    client: admin, workspaceId: workspace.id, agentId, config: agent.config as AgentConfig,
  });

  revalidatePath(`/agents/${agentId}`);
  return result.ok
    ? { notice: "The agent answered. Receipt saved." }
    : { error: `No answer: ${result.error}` };
}

/** Creates a queued run; execution is started by the run page. */
export async function createRun(formData: FormData): Promise<void> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(formData.get("agentId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);

  const { data: policy } = await admin
    .from("policies").select("id").eq("agent_id", agentId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!policy) throw new Error("Save a policy version before running the suite.");

  // The suite comes from the form, but is re-checked here: a run must never name a
  // suite the workspace is not entitled to read.
  const requestedSuiteId = String(formData.get("suiteId") ?? "").trim();
  const suiteQuery = admin.from("suites").select("id, workspace_id");
  const { data: suite } = requestedSuiteId
    ? await suiteQuery.eq("id", requestedSuiteId).maybeSingle()
    // With no choice made, the newest built-in version: pinning `version 1` here
    // quietly ran a 16-scenario suite for anyone who never opened the dropdown.
    : await suiteQuery.is("workspace_id", null).eq("key", "eu-support")
        .order("version", { ascending: false }).limit(1).maybeSingle();

  if (!suite) throw new Error("That suite could not be found.");
  if (suite.workspace_id !== null && suite.workspace_id !== workspace.id) {
    throw new Error("That suite does not belong to this workspace.");
  }

  const { data: previous } = await admin
    .from("runs").select("id").eq("agent_id", agentId).eq("status", "completed")
    .eq("suite_id", suite.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data: agent } = await admin
    .from("agents").select("attestation_text").eq("id", agentId).single();

  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });
  if (!entitlement.canRun) throw new Error(entitlement.blockedReason ?? "This workspace cannot start a run.");

  // Declared before anything runs, and frozen by the row (migration 0016).
  const declared = await manifestForNewRun({
    client: admin, agentId, policyId: policy.id, suiteId: suite.id,
    judgeSource: entitlement.judgeSource, routes: plannedRoutes(entitlement),
  });

  const { data: run, error } = await admin
    .from("runs")
    .insert({
      id: declared.id,
      workspace_id: workspace.id, agent_id: agentId, policy_id: policy.id,
      suite_id: suite.id, baseline_run_id: previous?.id ?? null, status: "queued",
      judge_source: entitlement.judgeSource, attestation_text: agent?.attestation_text ?? null,
      created_by: user.id,
      manifest: declared.manifest, manifest_hash: declared.manifest_hash,
    })
    .select("id").single();

  if (error) throw new Error(`Could not start the run: ${error.message}`);

  redirect(`/runs/${run.id}`);
}

/**
 * Asks a model why one scenario failed and what policy change would have prevented it.
 *
 * The diagnosis is written against the policy version the run actually used, not the
 * latest one, because it is explaining something that already happened. It is stored
 * as `proposed`: nothing here changes a policy.
 */
export async function requestDiagnosis(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const runCaseId = String(form.get("runCaseId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);

  const { data: runCase, error } = await admin
    .from("run_cases")
    .select("id, run_id, case_id, obligation, severity, input, expected, assertions, response_text, rationale, status")
    .eq("id", runCaseId)
    .eq("workspace_id", workspace.id)
    .single();

  if (error || !runCase) return { error: "That scenario could not be found." };
  if (runCase.status === "pass") return { error: "That scenario passed; there is nothing to diagnose." };

  const { data: run } = await admin
    .from("runs").select("policy_id").eq("id", runCase.run_id).single();
  const { data: policy } = run
    ? await admin.from("policies").select("id, body").eq("id", run.policy_id).single()
    : { data: null };

  if (!policy) return { error: "The policy this run used could not be loaded." };

  const outcome = await diagnoseFailure({
    chat: createRoutedChat({ connections: connectionsFromEnv(), routes: DEFAULT_ROUTES }),
    policyBody: policy.body as string,
    failure: {
      caseId: runCase.case_id as string,
      obligation: runCase.obligation as string,
      severity: runCase.severity as string,
      input: runCase.input as string,
      expected: runCase.expected as string,
      assertions: Array.isArray(runCase.assertions) ? (runCase.assertions as string[]) : [],
      responseText: (runCase.response_text as string | null) ?? null,
      rationale: (runCase.rationale as string | null) ?? null,
    },
  });

  if (!outcome.ok || !outcome.change) {
    // Deliberately not stored. A failed attempt to propose is not a proposal, and a
    // row saying "the model could not help" would only clutter the decision list.
    return { error: outcome.error ?? "No usable proposal came back." };
  }

  const { error: insertError } = await admin.from("diagnoses").insert({
    workspace_id: workspace.id,
    run_case_id: runCase.id,
    analysis: outcome.change.analysis,
    quoted_old: outcome.change.quotedOld,
    proposed_new: outcome.change.proposedNew,
    risks: outcome.change.risks,
    status: "proposed",
  });

  if (insertError) return { error: `Could not save the proposal: ${insertError.message}` };

  revalidatePath(`/runs/${runCase.run_id}`);
  return { notice: `Proposal ready, drafted by ${outcome.servedBy?.connection}/${outcome.servedBy?.model}.` };
}

/**
 * Approves or rejects a proposal. An approval is what creates a policy version.
 *
 * Approving re-checks the quoted text against the *current* policy rather than the
 * one the proposal was written against. If an earlier approval already moved that
 * text, this one is refused outright — applying a stale diff to a shifted target is
 * how an approved change silently becomes a different change.
 */
export async function decideDiagnosis(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const diagnosisId = String(form.get("diagnosisId") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (decision !== "approved" && decision !== "rejected") return { error: "Unknown decision." };

  const admin = await assertMembership(user.id, workspace.id);

  const { data: diagnosis, error } = await admin
    .from("diagnoses")
    .select("id, run_case_id, analysis, quoted_old, proposed_new, risks, status")
    .eq("id", diagnosisId)
    .eq("workspace_id", workspace.id)
    .single();

  if (error || !diagnosis) return { error: "That proposal could not be found." };
  if (diagnosis.status !== "proposed") {
    return { error: `This proposal was already ${diagnosis.status}.` };
  }

  const { data: runCase } = await admin
    .from("run_cases").select("run_id").eq("id", diagnosis.run_case_id).single();
  const { data: run } = runCase
    ? await admin.from("runs").select("agent_id, policy_id").eq("id", runCase.run_id).single()
    : { data: null };
  if (!run) return { error: "The run this proposal belongs to could not be loaded." };

  const decidedAt = new Date().toISOString();

  if (decision === "rejected") {
    const { error: rejectError } = await admin
      .from("diagnoses")
      .update({ status: "rejected", decided_by: user.id, decided_at: decidedAt })
      .eq("id", diagnosis.id);
    if (rejectError) return { error: `Could not record the rejection: ${rejectError.message}` };
    revalidatePath(`/runs/${runCase!.run_id}`);
    return { notice: "Rejected. The policy is unchanged." };
  }

  const { data: latest } = await admin
    .from("policies")
    .select("id, version, body")
    .eq("agent_id", run.agent_id)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (!latest) return { error: "No policy version to apply this to." };

  const nextBody = applyPolicyChange(latest.body as string, {
    analysis: diagnosis.analysis as string,
    quotedOld: (diagnosis.quoted_old as string | null) ?? null,
    proposedNew: diagnosis.proposed_new as string,
    risks: [],
  });

  if (nextBody === null) {
    return {
      error:
        "The text this proposal quotes is no longer in the current policy — another change moved it. Ask for a fresh diagnosis against the latest version.",
    };
  }

  const nextVersion = (latest.version as number) + 1;

  const { data: created, error: policyError } = await admin
    .from("policies")
    .insert({
      workspace_id: workspace.id,
      agent_id: run.agent_id,
      version: nextVersion,
      body: nextBody,
      derived_from: latest.id,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (policyError || !created) {
    return { error: `Could not create the policy version: ${policyError?.message}` };
  }

  const { error: approveError } = await admin
    .from("diagnoses")
    .update({
      status: "approved",
      resulting_policy_id: created.id,
      decided_by: user.id,
      decided_at: decidedAt,
    })
    .eq("id", diagnosis.id);

  if (approveError) return { error: `The policy was saved but the decision was not: ${approveError.message}` };

  revalidatePath(`/runs/${runCase!.run_id}`);
  revalidatePath(`/agents/${run.agent_id}`);
  return { notice: `Approved. Policy version ${nextVersion} created.` };
}

/**
 * Reruns the suite against the latest policy, comparing back to this run.
 *
 * The baseline is the run being rerun from, explicitly, rather than "the most recent
 * completed run" — so the comparison answers the question the operator actually
 * asked: did the change I just approved fix this?
 */
export async function rerunFrom(formData: FormData): Promise<void> {
  const { user, workspace } = await requireWorkspace();
  const baselineRunId = String(formData.get("runId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);

  const { data: baseline } = await admin
    .from("runs")
    .select("agent_id, suite_id, attestation_text")
    .eq("id", baselineRunId)
    .eq("workspace_id", workspace.id)
    .single();
  if (!baseline) throw new Error("That run could not be found.");

  const { data: policy } = await admin
    .from("policies").select("id").eq("agent_id", baseline.agent_id)
    .order("version", { ascending: false }).limit(1).single();
  if (!policy) throw new Error("There is no policy version to run against.");

  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });
  if (!entitlement.canRun) throw new Error(entitlement.blockedReason ?? "This workspace cannot start a run.");

  const declared = await manifestForNewRun({
    client: admin, agentId: baseline.agent_id as string, policyId: policy.id,
    suiteId: baseline.suite_id as string, judgeSource: entitlement.judgeSource,
    routes: plannedRoutes(entitlement),
  });

  const { data: run, error } = await admin
    .from("runs")
    .insert({
      id: declared.id,
      workspace_id: workspace.id,
      agent_id: baseline.agent_id,
      policy_id: policy.id,
      suite_id: baseline.suite_id,
      baseline_run_id: baselineRunId,
      status: "queued",
      judge_source: entitlement.judgeSource,
      attestation_text: baseline.attestation_text,
      created_by: user.id,
      manifest: declared.manifest, manifest_hash: declared.manifest_hash,
    })
    .select("id").single();

  if (error) throw new Error(`Could not start the rerun: ${error.message}`);

  redirect(`/runs/${run.id}`);
}


const JUDGE_PROVIDERS = ["groq", "google", "openrouter", "anthropic"] as const;

/**
 * A pasted key is a credential, not a document. Nothing legitimate is anywhere near
 * this long, and the value is encrypted and stored before anything else looks at it.
 */
const MAX_KEY_LENGTH = 500;
const MAX_MODEL_LENGTH = 120;

/**
 * Stores the workspace's own model key, which is what ends the trial.
 *
 * Three rules, each of which was a defect first:
 *
 * **The key is proved before it is kept.** Saving a key that does not work would move
 * the workspace off the trial allowance and onto a credential that cannot grade
 * anything, turning every subsequent run into a page of errored cases.
 *
 * **The models are kept too.** The form has always asked for one, used it to prove the
 * key, and discarded it — while the run took its route from `DEFAULT_ROUTES`, which
 * names *our* connections. A google, anthropic or openrouter key therefore had no
 * routable candidate at all and errored every case in the run. The model the customer
 * named is the only thing that knows what their key can serve, so it travels with it
 * (migration 0025).
 *
 * **Replacing a key removes the one it replaced.** `storeSecret` inserts and
 * `revealSecret` reads the newest, so a rotated credential used to sit in the table
 * indefinitely — holding a key a customer believes they have retired, which is the one
 * thing rotation is for.
 */
export async function saveJudgeKey(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const provider = String(form.get("provider") ?? "");
  const apiKey = String(form.get("apiKey") ?? "").trim();

  if (!JUDGE_PROVIDERS.includes(provider as (typeof JUDGE_PROVIDERS)[number])) {
    return { error: "Choose which provider this key belongs to." };
  }
  if (!apiKey) return { error: "Paste the key." };
  if (apiKey.length > MAX_KEY_LENGTH) {
    return { error: "That is longer than any API key we know of — check you pasted the key rather than a file." };
  }

  const connection = connectionFor(provider, apiKey);
  if (!connection) return { error: "That provider is not supported yet." };

  const models = [String(form.get("model") ?? ""), String(form.get("secondModel") ?? "")]
    .map((m) => m.trim())
    .filter((m, i, all) => m.length > 0 && all.indexOf(m) === i);

  if (!models.length) return { error: "Name a model this key can use, so we can test it." };
  if (models.some((m) => m.length > MAX_MODEL_LENGTH)) {
    return { error: "That is not a model id." };
  }

  // Every model is proved, not just the first. A second model that cannot be reached
  // would be a route candidate that fails on every case it is asked — visible in the
  // run as a fallback, and pointless when it could be caught in one call here.
  for (const model of models) {
    try {
      await connection.provider.chat(
        {
          model,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          maxTokens: 16,
          temperature: 0,
        },
        apiKey,
      );
    } catch (error) {
      return { error: explainKeyFailure(provider, model, error) };
    }
  }

  const admin = await assertMembership(user.id, workspace.id);

  const { data: superseded } = await admin
    .from("secrets").select("id").eq("workspace_id", workspace.id).eq("scope", "judge_key");

  await storeSecret({
    client: admin,
    workspaceId: workspace.id,
    scope: "judge_key",
    plaintext: apiKey,
    provider,
    models,
  });

  // After the new one is safely stored, never before: a delete-then-insert that failed
  // halfway would leave an unmetered workspace with no credential at all.
  if (superseded?.length) {
    await admin.from("secrets").delete().in("id", superseded.map((row) => row.id));
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");

  const corroboration = models.length > 1
    ? `Verdicts will be corroborated across ${models.length} of your models — recorded as within one vendor, since both are ${provider}.`
    : `One model means one opinion: verdicts will be reported as not corroborated. Naming a second ${provider} model changes that.`;

  return {
    notice: `Saved${superseded?.length ? " and the previous key removed" : ""}. Runs are graded on your ${provider} key from now on, and the trial cap no longer applies. ${corroboration}`,
  };
}

/** Removes the workspace's key, which puts it back on the trial allowance. */
export async function removeJudgeKey(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  if (String(form.get("confirm")) !== "remove") return { error: "Not removed." };

  const admin = await assertMembership(user.id, workspace.id);
  const { error } = await admin
    .from("secrets").delete().eq("workspace_id", workspace.id).eq("scope", "judge_key");

  if (error) return { error: `Could not remove the key: ${error.message}` };

  // What actually happens next, from the stored count rather than a general statement.
  // Every run this workspace has ever made counts against the trial, including the ones
  // its own key paid for — so removing a key after four runs does not restore an
  // allowance, it ends the ability to run at all until another key is connected.
  const after = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return {
    notice: after.canRun
      ? `Removed. ${TRIAL_RUN_LIMIT - after.runsUsed} of the ${TRIAL_RUN_LIMIT} trial runs are left.`
      : `Removed. This workspace has run ${after.runsUsed} suites and the trial covers ${TRIAL_RUN_LIMIT}, so no further run can start until a key is connected.`,
  };
}

/**
 * Records a person's finding on a verdict, beside it — never in place of it.
 *
 * The verdict being reviewed is read from the stored row, not taken from the form: a
 * review that froze whatever status the browser claimed could record "the person
 * agreed with a pass" over a case that had failed. The operator reviewing is often the
 * agency whose agent was tested, which is exactly why the verdict is untouchable and a
 * reason is required (migration 0028).
 */
export async function reviewVerdict(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const runCaseId = String(form.get("runCaseId") ?? "").trim();
  const finding = String(form.get("finding") ?? "");
  const note = String(form.get("note") ?? "").trim();

  if (!runCaseId) return { error: "No scenario was named." };
  if (finding !== "pass" && finding !== "fail") {
    return { error: "Say whether you find this scenario passed or failed." };
  }
  if (note.length < REVIEW_NOTE_MIN) {
    return { error: "Say why, in a sentence. A finding with no reason is an assertion, not evidence." };
  }
  if (note.length > REVIEW_NOTE_MAX) {
    return { error: `Keep the reason under ${REVIEW_NOTE_MAX.toLocaleString("en-GB")} characters.` };
  }

  const admin = await assertMembership(user.id, workspace.id);
  const { data: runCase } = await admin
    .from("run_cases")
    .select("id, run_id, status")
    .eq("id", runCaseId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!runCase) return { error: "That scenario could not be found." };

  const { error } = await admin.from("verdict_reviews").insert({
    workspace_id: workspace.id,
    run_case_id: runCaseId,
    reviewer_id: user.id,
    verdict_status: runCase.status,
    finding,
    note,
  });
  if (error) return { error: `Could not record the review: ${error.message}` };

  revalidatePath(`/runs/${runCase.run_id}`);

  if (runCase.status === "error") {
    return { notice: "Recorded. The scenario still counts as producing no automated result; your finding is shown beside it." };
  }
  return {
    notice: runCase.status === finding
      ? "Recorded — you agree with the verdict."
      : "Recorded — you disagree with the verdict. It stands as graded, and your finding is kept beside it on this run.",
  };
}

/**
 * Re-runs one scenario against the policy as it stands now.
 *
 * Gated on the same entitlement as a run, because it spends the same inference, but
 * it does not consume one of the trial's runs: a retest is not a run, produces no
 * report, and must not be priced as though it were.
 */
export async function retestOneCase(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const runCaseId = String(form.get("runCaseId") ?? "").trim();
  if (!runCaseId) return { error: "No scenario was named." };

  const admin = await assertMembership(user.id, workspace.id);

  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });
  if (!entitlement.canRun) {
    return { error: entitlement.blockedReason ?? "This workspace cannot run scenarios." };
  }

  const { data: runCase } = await admin
    .from("run_cases").select("run_id").eq("id", runCaseId).maybeSingle();

  try {
    const result = await retestCase({
      client: admin, workspaceId: workspace.id, runCaseId, userId: user.id,
    });
    if (runCase) revalidatePath(`/runs/${runCase.run_id}`);
    return {
      notice:
        result.status === "error"
          ? `The retest against policy v${result.policyVersion} produced no verdict.`
          : `Against policy v${result.policyVersion}, this scenario now ${result.status === "pass" ? "passes" : "still fails"}.`,
    };
  } catch (thrown) {
    return { error: thrown instanceof Error ? thrown.message : "The retest could not be run." };
  }
}

const MAX_SUITE_BYTES = 1_000_000;

/**
 * Imports a scenario suite the workspace owns.
 *
 * Two rules, both inherited from what a suite is for:
 *
 *  - **A version is immutable.** Importing over an existing key and version is
 *    refused rather than merged, because reports already issued name that version
 *    and must keep meaning what they meant. Changing a suite means a new version.
 *  - **It is validated whole.** A file with one bad case is rejected entirely. A
 *    partially imported suite silently changes what every future score is out of.
 *
 * The suite is stored against the workspace, never as a shared one, so an import can
 * never alter what another customer is graded on.
 */
export async function importSuite(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a .json or .csv file." };
  if (file.size > MAX_SUITE_BYTES) {
    return { error: `That file is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_SUITE_BYTES / 1000} KB.` };
  }

  const text = await file.text();
  const isCsv = file.name.toLowerCase().endsWith(".csv");

  const formKey = String(form.get("key") ?? "").trim().toLowerCase();
  const formName = String(form.get("name") ?? "").trim();
  const formVersion = Number(String(form.get("version") ?? "").trim());

  let result;
  if (isCsv) {
    if (!formKey || !formName || !Number.isInteger(formVersion) || formVersion < 1) {
      return { error: "A CSV carries no name of its own, so a key, a name and a version are required." };
    }
    result = suiteFromCsv(text, { key: formKey, name: formName, version: formVersion });
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "That file is not valid JSON." };
    }
    const withOverrides =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? {
            ...(parsed as Record<string, unknown>),
            ...(formKey ? { key: formKey } : {}),
            ...(formName ? { name: formName } : {}),
            ...(Number.isInteger(formVersion) && formVersion >= 1 ? { version: formVersion } : {}),
          }
        : parsed;
    result = validateSuite(withOverrides);
  }

  if (!result.ok) {
    const shown = result.errors.slice(0, 6);
    const more = result.errors.length - shown.length;
    return { error: shown.join(" ") + (more > 0 ? ` (and ${more} more)` : "") };
  }

  const suite = result.suite;
  const admin = await assertMembership(user.id, workspace.id);

  // A suite decides what every future score is out of, so where it came from is part of
  // the evidence rather than metadata. The hash is of the bytes as uploaded, so the file
  // on someone's disk can be checked against the suite a report cites.
  const provenance = {
    source_tool: isCsv ? "csv-import" : "json-import",
    source_filename: file.name,
    source_bytes: file.size,
    source_sha256: createHash("sha256").update(text).digest("hex"),
    imported_at: new Date().toISOString(),
    imported_by: user.id,
    case_count: suite.cases.length,
    // Stated rather than assumed: nothing here strips personal data out of a scenario,
    // and a reader should not infer that it did.
    sanitisation: "none — scenarios are stored exactly as supplied",
  };

  const { data: clash } = await admin
    .from("suites").select("id")
    .eq("workspace_id", workspace.id)
    .eq("key", suite.key).eq("version", suite.version)
    .maybeSingle();
  if (clash) {
    return {
      error:
        `This workspace already has ${suite.key} v${suite.version}. A version is immutable because ` +
        "reports already name it — import this as a new version instead.",
    };
  }

  const { error } = await admin.from("suites").insert({
    workspace_id: workspace.id,
    key: suite.key,
    version: suite.version,
    name: suite.name,
    cases: suite.cases,
    provenance,
  });
  if (error) return { error: `The suite could not be saved: ${error.message}` };

  revalidatePath("/dashboard");
  return { notice: `Imported ${suite.name} v${suite.version} — ${suite.cases.length} scenarios.` };
}

/**
 * Points an agent at a read-only endpoint in the customer's own system, so a claimed
 * action can be checked against it.
 *
 * Validated before it is saved, never after. A verification endpoint that does not
 * answer is worse than none: without one, a scenario expecting a change of state
 * reports honestly as unverified; with a broken one it reports as unverified too, but
 * the operator believes it is being checked.
 */
export async function saveVerificationEndpoint(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");
  const url = String(form.get("url") ?? "").trim();
  const authHeaderName = String(form.get("authHeaderName") ?? "").trim();
  const credential = String(form.get("credential") ?? "").trim();

  const admin = await assertMembership(user.id, workspace.id);

  if (!url) {
    // Removing it is a real choice, and it has to be as easy as adding it.
    const { error } = await admin
      .from("agents").update({ verification: null }).eq("id", agentId).eq("workspace_id", workspace.id);
    if (error) return { error: `Could not remove it: ${error.message}` };
    revalidatePath(`/agents/${agentId}`);
    return { notice: "Removed. Scenarios expecting a change of state will report as unverified." };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "That is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    return { error: "Use https. A read-back travels over the public internet and may carry a credential." };
  }
  if (credential && !authHeaderName) {
    return { error: "Name the header the credential goes in." };
  }

  const config = {
    kind: "http_read" as const,
    url: parsed.toString(),
    ...(authHeaderName ? { authHeaderName } : {}),
  };

  // Prove it answers before storing it, exactly as a model key is proved.
  const check = await httpVerificationConnector(config, credential || undefined).validate();
  if (!check.ok) return { error: `That endpoint did not answer: ${check.detail}` };

  if (credential) {
    await storeSecret({
      client: admin,
      workspaceId: workspace.id,
      scope: "verification_auth",
      plaintext: credential,
      agentId,
    });
  }

  const { error } = await admin
    .from("agents").update({ verification: config }).eq("id", agentId).eq("workspace_id", workspace.id);
  if (error) return { error: `Could not save it: ${error.message}` };

  revalidatePath(`/agents/${agentId}`);
  return {
    notice:
      `Saved and checked — it answered. ${check.detail} Scenarios that expect a change of state `
      + "will now be confirmed against this endpoint rather than reported as unverified.",
  };
}

/**
 * Points an agent at a different field in its own response, and re-probes.
 *
 * This exists because "No text found at response path" is where integrations die. The
 * probe has the response in its hands and can say where the reply appears to be; this
 * is the button that acts on it, so the fix is one click rather than a form the
 * operator has to find their way back to.
 *
 * It re-probes immediately, because a path nobody has proved is exactly the state this
 * is meant to end. If the new path is also wrong, the receipt says so and suggests
 * again — the loop is short and it converges.
 */
export async function applyResponsePath(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");
  const path = String(form.get("path") ?? "").trim();
  const field = String(form.get("field") ?? "reply");

  if (!path) return { error: "Choose a path." };
  if (field !== "reply" && field !== "tools") return { error: "Unknown field." };

  const admin = await assertMembership(user.id, workspace.id);

  const { data: agent } = await admin
    .from("agents").select("config").eq("id", agentId).eq("workspace_id", workspace.id).maybeSingle();
  if (!agent) return { error: "That agent could not be found in this workspace." };

  const config = agent.config as HttpAgentConfig;
  if (config.kind !== "http") {
    return { error: "Only an HTTP agent reads its reply out of a response body." };
  }

  const updated: HttpAgentConfig = field === "reply"
    ? { ...config, responsePath: path }
    : { ...config, toolActivityPath: path };

  const { error } = await admin
    .from("agents").update({ config: updated }).eq("id", agentId).eq("workspace_id", workspace.id);
  if (error) return { error: `Could not save it: ${error.message}` };

  const probe = await probeAgent({ client: admin, workspaceId: workspace.id, agentId, config: updated });

  revalidatePath(`/agents/${agentId}`);
  return probe.ok
    ? { notice: `Reading the ${field === "reply" ? "reply" : "tool activity"} from "${path}". The agent answered.` }
    : { error: `Saved "${path}", but the agent still did not answer as expected: ${probe.error}` };
}
