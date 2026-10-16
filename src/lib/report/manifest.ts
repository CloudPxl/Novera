import { DATA_POLICY_VERSION } from "../privacy/data-class.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { contentHash, type Json } from "./hash.ts";
import type { ReportPayload } from "./payload.ts";
import { JUDGE_SYSTEM } from "../judge/index.ts";
import { DEFAULT_ROUTES, type RouteTable } from "../router/routes.ts";
import { suiteDigest } from "../suites/digest.ts";
import { extensionDigestsOf, readExtension } from "../suites/extension.ts";
import { LOCALE_NAMES, isVariantLocale, localise, type Locale } from "../suites/locales.ts";
import type { SuiteCase } from "../runner/types.ts";

/**
 * Bumped by hand when the way a run is executed changes in a way that could change a
 * verdict — slicing, concurrency, the consensus rule, the effect rule. Not the package
 * version, which moves for reasons that have nothing to do with grading.
 */
export const RUNNER_VERSION = "1.0.0";

/**
 * What the run declared about itself **before it ran**.
 *
 * The hash on a finished report proves the document was not edited afterwards. It
 * cannot prove the inputs were fixed beforehand — which is the claim that actually
 * survives a hostile reading. "You chose the suite after seeing the answers" is a
 * question a sealed report alone has no answer to.
 *
 * So a run writes this at the moment it is created, before a single case executes,
 * and the row refuses to let it change (migration 0016). The report then carries the
 * digest, and a reader can recompute it from the manifest stored with the run.
 *
 * Nothing here is secret. Deliberately: the agent's endpoint appears as a **host
 * only**, never a full URL, because a URL can carry a token in its path or query and
 * this object is quoted in a client-facing document.
 */
export interface RunManifest {
  novera_manifest: 1;
  run_id: string;
  created_at: string;
  agent: {
    id: string;
    endpoint_host: string | null;
    /**
     * A digest of how Novera talks to the agent — endpoint, method, request template,
     * response paths, the *names* of any fixed headers — never a credential or a header
     * value. Two runs with the same digest sent the same shape of request to the same
     * place. Absent on runs declared before 2026-09-29.
     */
    config_hash?: string;
  };
  /**
   * What the customer said they were testing, as they said it: an agent release, a
   * knowledge-base revision. Declared, not observed — Novera cannot see inside the
   * customer's deployment, and the report labels these accordingly. Absent when nothing
   * was declared.
   */
  declared?: { release_id?: string; knowledge_base_revision?: string };
  policy: { id: string; version: number };
  suite: { id: string; key: string; version: number; case_ids: string[] };
  /**
   * SHA-256 of the suite row the run executes — key, version, name and every scenario in
   * order, in canonical form (`src/lib/suites/digest.ts`). The case ids say which scenarios
   * ran; this says what each of them was, so a sealed report (through `manifest_hash`) commits
   * to the exact suite content. Absent on runs declared before 2026-10-15.
   */
  suite_digest?: string;
  /**
   * Present only on a run of a suite extension (`src/lib/suites/extension.ts`): the official
   * suite version it extends, the digest of its scenarios as the run carries them — equal to
   * that suite's own digest when they ran unchanged — and the digest of the workspace scenarios
   * added after them. `suite_digest` stays the digest of everything that ran. Absent on every
   * other run, and on every run declared before 2026-10-16.
   */
  base_suite?: { key: string; version: number; scenarios: number };
  base_suite_digest?: string;
  extension_digest?: string;
  /** The workspace scenarios the extension adds, in order. Present with `extension_digest`. */
  extension_case_ids?: string[];
  /**
   * Present only on a run sent in a language other than English: the locale, the scenarios
   * sent in it (the rest went in English) and the digest of exactly the variant entries used
   * (`src/lib/suites/locales.ts`). Absent on English runs and on every run declared before
   * 2026-10-16, which were all in English.
   */
  locale?: Exclude<Locale, "en">;
  locale_digest?: string;
  localised_case_ids?: string[];
  /** The models this run intended to grade with, in the order it meant to ask them. */
  judge_plan: Array<{ connection: string; model: string; task: string }>;
  judge_source: "trial_free" | "workspace_key" | "plan_managed";
  /**
   * A digest of the grading instructions themselves. Two runs graded under different
   * rubrics are not comparable, and the rubric is a string in this repository that
   * changes without any version number being bumped — so it versions itself.
   */
  rubric_hash: string;
  runner_version: string;
  pass_threshold: number;
  /**
   * The rule deciding which grading provider may read which data, and so which of them
   * read personal data only as placeholders (`src/lib/privacy/data-class.ts`). Absent on
   * runs declared before 2026-09-29, which sent every grader the reply as written.
   */
  data_policy?: number;
}

/** Twelve hex characters is plenty to notice a change; the full digest is noise here. */
export function rubricHash(): string {
  return createHash("sha256").update(JUDGE_SYSTEM, "utf8").digest("hex").slice(0, 12);
}

/** Host only. A full URL can carry a credential, and this is quoted to a client. */
export function endpointHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** The fields a customer may declare about what a run tests, bounded and trimmed. */
export interface Declared { releaseId?: string; knowledgeBaseRevision?: string }

export const DECLARED_MAX = 100;

/** A declaration as stored, or a sentence saying why it cannot be. */
export function cleanDeclared(raw: { releaseId?: unknown; knowledgeBaseRevision?: unknown }): Declared | { error: string } {
  const out: Declared = {};
  for (const [key, label] of [["releaseId", "release"], ["knowledgeBaseRevision", "knowledge-base revision"]] as const) {
    const v = raw[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || !v.trim()) return { error: `The ${label} must be text.` };
    const t = v.trim();
    // Printable and short: this is quoted on a document someone else will read.
    if (t.length > DECLARED_MAX || /[\u0000-\u001f\u007f]/.test(t)) {
      return { error: `The ${label} must be at most ${DECLARED_MAX} printable characters.` };
    }
    out[key] = t;
  }
  return out;
}

/** The request's shape, digested. Credentials and header values never enter it. */
export function agentConfigHash(config: unknown): string | null {
  const c = (config ?? null) as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return null;
  const shape = {
    kind: c.kind ?? null,
    url: c.url ?? null,
    method: c.method ?? "POST",
    body_template: c.bodyTemplate ?? null,
    response_path: c.responsePath ?? null,
    tool_activity_path: c.toolActivityPath ?? null,
    header_names: c.headers && typeof c.headers === "object" ? Object.keys(c.headers as object).sort() : [],
    auth_header_name: c.authHeaderName ?? null,
    model: c.model ?? null,
    provider: c.provider ?? null,
    system_prompt_sha256: typeof c.systemPrompt === "string" ? createHash("sha256").update(c.systemPrompt, "utf8").digest("hex") : null,
  };
  return contentHash(shape as unknown as Json);
}

export function buildRunManifest(args: {
  runId: string;
  createdAt?: string;
  agentId: string;
  agentUrl?: string | null;
  policyId: string;
  policyVersion: number;
  suiteId: string;
  suiteKey: string;
  suiteVersion: number;
  caseIds: string[];
  /** `suiteDigest` of the suite row being run. Omitted only by callers that predate it. */
  suiteDigest?: string | null;
  /** Set only for a suite extension: what it extends and the two digests, from the row. */
  extension?: { key: string; version: number; scenarios: number; baseSuiteDigest: string; extensionDigest: string; extensionCaseIds: string[] } | null;
  /** Set only for a run in another language, and only when at least one scenario has a variant. */
  locale?: { code: Exclude<Locale, "en">; digest: string; caseIds: string[] } | null;
  judgeSource: "trial_free" | "workspace_key" | "plan_managed";
  /**
   * The route this run will actually grade on. It is an argument rather than a read of
   * `DEFAULT_ROUTES` because a workspace on its own key grades on a route built from
   * that key — and a manifest that declared our panel over a run graded by someone
   * else's single model would be a false declaration in the one document whose whole
   * purpose is that the inputs were declared before anything ran.
   */
  routes?: RouteTable;
  passThreshold: number;
  runnerVersion: string;
  agentConfig?: unknown;
  declared?: Declared;
}): { manifest: RunManifest; hash: string } {
  const routes = args.routes ?? DEFAULT_ROUTES;
  const manifest: RunManifest = {
    novera_manifest: 1,
    run_id: args.runId,
    created_at: args.createdAt ?? new Date().toISOString(),
    agent: {
      id: args.agentId,
      endpoint_host: endpointHost(args.agentUrl),
      ...(() => { const h = args.agentConfig === undefined ? null : agentConfigHash(args.agentConfig); return h ? { config_hash: h } : {}; })(),
    },
    ...(args.declared && (args.declared.releaseId || args.declared.knowledgeBaseRevision)
      ? {
          declared: {
            ...(args.declared.releaseId ? { release_id: args.declared.releaseId } : {}),
            ...(args.declared.knowledgeBaseRevision ? { knowledge_base_revision: args.declared.knowledgeBaseRevision } : {}),
          },
        }
      : {}),
    policy: { id: args.policyId, version: args.policyVersion },
    suite: {
      id: args.suiteId,
      key: args.suiteKey,
      version: args.suiteVersion,
      // In suite order, not sorted: the order is part of what was declared, and a
      // reader comparing two manifests should see a reordering as a difference.
      case_ids: args.caseIds,
    },
    ...(args.suiteDigest ? { suite_digest: args.suiteDigest } : {}),
    ...(args.extension
      ? {
          base_suite: { key: args.extension.key, version: args.extension.version, scenarios: args.extension.scenarios },
          base_suite_digest: args.extension.baseSuiteDigest,
          extension_digest: args.extension.extensionDigest,
          extension_case_ids: args.extension.extensionCaseIds,
        }
      : {}),
    ...(args.locale
      ? { locale: args.locale.code, locale_digest: args.locale.digest, localised_case_ids: args.locale.caseIds }
      : {}),
    judge_plan: (["judge", "judge_critical"] as const).flatMap((task) =>
      routes[task].map((c) => ({ connection: c.connection, model: c.model, task })),
    ),
    judge_source: args.judgeSource,
    rubric_hash: rubricHash(),
    runner_version: args.runnerVersion,
    pass_threshold: args.passThreshold,
    data_policy: DATA_POLICY_VERSION,
  };

  return { manifest, hash: contentHash(manifest as unknown as Json) };
}

/**
 * Builds the manifest for a run that is about to be inserted, reading what it needs
 * rather than making every caller thread it through.
 *
 * It returns the run's `id` too: the manifest names the run, so the id has to exist
 * before the row does. Generating it here is what makes "declared before execution"
 * literally true rather than approximately true.
 *
 * A manifest is best-effort at the edges — if the policy version or the suite cannot
 * be read, the run still starts without one, because refusing to test someone's agent
 * over a missing metadata row would be the wrong trade. The report then says the run
 * has no manifest instead of implying it has a verified one.
 */
export async function manifestForNewRun(args: {
  /**
   * The real client's type, rather than a hand-written structural stand-in. A
   * structural one type-checked but made the three call sites instantiate a type deep
   * enough for the compiler to give up on (TS2589) — and the `any` it replaced was
   * worse still, because a renamed column would have produced a manifest with a
   * missing field and no complaint from anyone.
   */
  client: SupabaseClient;
  agentId: string;
  policyId: string;
  suiteId: string;
  judgeSource: "trial_free" | "workspace_key" | "plan_managed";
  /** The route the run will grade on; the default panel when the caller has none. */
  routes?: RouteTable;
  passThreshold?: number;
  runnerVersion?: string;
  declared?: Declared;
  /** The id the run will have, when the caller chose it first (an Idempotency-Key claim). */
  runId?: string;
  /** The language the scenarios are sent in; English when omitted. */
  locale?: Locale;
}): Promise<{ id: string; manifest: RunManifest | null; manifest_hash: string | null }> {
  const id = args.runId ?? randomUUID();

  try {
    const [{ data: agent }, { data: policy }, { data: suite }] = await Promise.all([
      args.client.from("agents").select("config").eq("id", args.agentId).maybeSingle(),
      args.client.from("policies").select("version").eq("id", args.policyId).maybeSingle(),
      args.client.from("suites").select("key, version, name, cases, provenance").eq("id", args.suiteId).maybeSingle(),
    ]);

    if (!policy || !suite) return { id, manifest: null, manifest_hash: null };

    const cases = Array.isArray(suite.cases) ? (suite.cases as Array<{ id?: unknown }>) : [];
    // An extension's digests are recomputed from the row the runner will execute, never copied
    // from its record, which only says where the base ends. 0071 refuses a row whose record
    // does not match the official suite it names.
    const ext = readExtension(suite.provenance);
    const extDigests = ext ? extensionDigestsOf({ cases: cases as unknown as SuiteCase[] }, ext) : null;
    // The variants this run will send, fixed now: the runner refuses to send any other.
    const localised = args.locale && args.locale !== "en" ? localise(cases as unknown as SuiteCase[], args.locale) : null;
    const { manifest, hash } = buildRunManifest({
      runId: id,
      agentId: args.agentId,
      agentUrl: (agent?.config as { url?: string } | null)?.url ?? null,
      policyId: args.policyId,
      policyVersion: Number(policy.version),
      suiteId: args.suiteId,
      suiteKey: String(suite.key),
      suiteVersion: Number(suite.version),
      caseIds: cases.map((c) => String(c.id)),
      // Of the row as stored, which is what the runner will execute.
      suiteDigest: suiteDigest({
        key: String(suite.key), version: Number(suite.version), name: String(suite.name),
        cases: cases as unknown as Parameters<typeof suiteDigest>[0]["cases"],
      }),
      judgeSource: args.judgeSource,
      routes: args.routes,
      passThreshold: args.passThreshold ?? 80,
      runnerVersion: args.runnerVersion ?? RUNNER_VERSION,
      agentConfig: agent?.config ?? null,
      declared: args.declared,
      extension: ext && extDigests
        ? { key: ext.key, version: ext.version, scenarios: ext.base_scenarios, ...extDigests }
        : null,
      locale: localised?.digest && args.locale && args.locale !== "en"
        ? { code: args.locale, digest: localised.digest, caseIds: localised.localisedIds }
        : null,
    });

    return { id, manifest, manifest_hash: hash };
  } catch {
    return { id, manifest: null, manifest_hash: null };
  }
}

/**
 * What a report states about what was tested, from the manifest the run declared
 * before it started. Null for a run with no manifest, or one whose manifest predates
 * the configuration digest: a report does not guess what an older run would have said.
 */
export function fingerprintFromManifest(manifest: unknown): NonNullable<ReportPayload["run"]["fingerprint"]> | null {
  const m = manifest as Partial<RunManifest> | null;
  if (!m?.agent?.config_hash) return null;
  const declared = (value: string | undefined) =>
    value ? { value, provenance: "declared" as const } : { value: null, provenance: "not_supplied" as const };
  return [
    { field: "agent_endpoint", value: m.agent.endpoint_host ?? null, provenance: m.agent.endpoint_host ? "recorded" : "not_supplied" },
    { field: "request_configuration", value: m.agent.config_hash, provenance: "recorded" },
    { field: "agent_release", ...declared(m.declared?.release_id) },
    { field: "knowledge_base_revision", ...declared(m.declared?.knowledge_base_revision) },
  ];
}

/**
 * What a report states about how its suite was composed and which language it was sent in,
 * from the manifest the run declared before it started (format 15). Each part is null when the
 * manifest does not declare it: a run of an ordinary suite, an English run, or a run from before
 * either existed. A report never infers an extension or a language the run did not declare.
 */
export function compositionFromManifest(manifest: unknown): {
  extension: NonNullable<ReportPayload["run"]["extension"]> | null;
  locale: NonNullable<ReportPayload["run"]["locale"]> | null;
} {
  const m = (manifest ?? null) as Partial<RunManifest> | null;
  const total = Array.isArray(m?.suite?.case_ids) ? m!.suite!.case_ids.length : null;
  const extension = m?.base_suite && m.base_suite_digest && m.extension_digest && Array.isArray(m.extension_case_ids)
    ? {
        base_suite: `${m.base_suite.key} v${m.base_suite.version}`,
        base_suite_digest: m.base_suite_digest,
        scenarios: m.extension_case_ids.length,
        extension_digest: m.extension_digest,
      }
    : null;
  const locale = m?.locale && isVariantLocale(m.locale) && m.locale_digest && Array.isArray(m.localised_case_ids) && total !== null
    ? { code: m.locale, name: LOCALE_NAMES[m.locale], localised: m.localised_case_ids.length, of: total, locale_digest: m.locale_digest }
    : null;
  return { extension, locale };
}
