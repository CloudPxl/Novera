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
import { workspaceEntitlement } from "@/lib/auth/entitlement.ts";
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
    : await suiteQuery.is("workspace_id", null).eq("key", "eu-support").eq("version", 1).maybeSingle();

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

  const { data: run, error } = await admin
    .from("runs")
    .insert({
      workspace_id: workspace.id, agent_id: agentId, policy_id: policy.id,
      suite_id: suite.id, baseline_run_id: previous?.id ?? null, status: "queued",
      judge_source: entitlement.judgeSource, attestation_text: agent?.attestation_text ?? null,
      created_by: user.id,
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

  const { data: run, error } = await admin
    .from("runs")
    .insert({
      workspace_id: workspace.id,
      agent_id: baseline.agent_id,
      policy_id: policy.id,
      suite_id: baseline.suite_id,
      baseline_run_id: baselineRunId,
      status: "queued",
      judge_source: entitlement.judgeSource,
      attestation_text: baseline.attestation_text,
      created_by: user.id,
    })
    .select("id").single();

  if (error) throw new Error(`Could not start the rerun: ${error.message}`);

  redirect(`/runs/${run.id}`);
}


const JUDGE_PROVIDERS = ["groq", "google", "openrouter", "anthropic"] as const;

/**
 * Stores the workspace's own model key, which is what ends the trial.
 *
 * The key is proved before it is kept. Saving a key that does not work would move the
 * workspace off the trial allowance and onto a credential that cannot grade anything,
 * turning every subsequent run into a page of errored cases.
 */
export async function saveJudgeKey(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const provider = String(form.get("provider") ?? "");
  const apiKey = String(form.get("apiKey") ?? "").trim();

  if (!JUDGE_PROVIDERS.includes(provider as (typeof JUDGE_PROVIDERS)[number])) {
    return { error: "Choose which provider this key belongs to." };
  }
  if (!apiKey) return { error: "Paste the key." };

  const connection = connectionFor(provider, apiKey);
  if (!connection) return { error: "That provider is not supported yet." };

  const probeModel = String(form.get("model") ?? "").trim();
  if (!probeModel) return { error: "Name a model this key can use, so we can test it." };

  try {
    await connection.provider.chat(
      {
        model: probeModel,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        maxTokens: 16,
        temperature: 0,
      },
      apiKey,
    );
  } catch (error) {
    return {
      error: `That key did not work: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const admin = await assertMembership(user.id, workspace.id);

  await storeSecret({
    client: admin,
    workspaceId: workspace.id,
    scope: "judge_key",
    plaintext: apiKey,
    provider,
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { notice: `Saved. Runs are graded on your ${provider} key from now on, and the trial cap no longer applies.` };
}

/** Removes the workspace's key, which puts it back on the trial allowance. */
export async function removeJudgeKey(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  if (String(form.get("confirm")) !== "remove") return { error: "Not removed." };

  const admin = await assertMembership(user.id, workspace.id);
  const { error } = await admin
    .from("secrets").delete().eq("workspace_id", workspace.id).eq("scope", "judge_key");

  if (error) return { error: `Could not remove the key: ${error.message}` };

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { notice: "Removed. Runs go back to the trial allowance, which is capped." };
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
