import { cleanDeclared, type Declared } from "../report/manifest.ts";
import { isLocale, type Locale } from "../suites/locale-names.ts";

/**
 * `POST /api/v1/ci/trigger`, the decisions without the database: what the body asks for,
 * whether a commit already has a run, and which runs a new commit supersedes. Pure, so each
 * edge is tested where it is decided (tests/block5-ci.test.ts); the route and
 * `src/lib/ci/server.ts` only read and write rows.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A git object name: SHA-1 (40) or SHA-256 (64) hex, or an abbreviation of at least seven. */
const SHA = /^[0-9a-f]{7,64}$/i;
/** A suite key as the suites table holds them, optionally with `-v<version>`. */
const SUITE_REF = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export interface TriggerRequest {
  agentId: string;
  /** Exactly one of these, or neither (the newest built-in eu-support, as `startRun` decides). */
  suiteId: string | null;
  suiteRef: string | null;
  gitCommitSha: string | null;
  gitBranch: string | null;
  prNumber: number | null;
  cancelSuperseded: boolean;
  /** The language the scenarios are sent in; part of what "the same commit" means. */
  locale: Locale;
  /** Run the workspace's newest extension of the named official suite instead of the suite alone. */
  includeExtensions: boolean;
  /** What the report states as declared: the caller's `release_id`, else the commit. */
  declared: Declared;
}

type Body = Record<string, unknown>;

/** The first of several spellings that is present: the API's snake_case, then camelCase. */
function field(body: Body, ...names: string[]): unknown {
  for (const n of names) if (body[n] !== undefined && body[n] !== null && body[n] !== "") return body[n];
  return undefined;
}

/**
 * Lenient about spelling (snake_case like the rest of /api/v1, or camelCase), strict about
 * values. Unknown fields are ignored, as on `POST /api/v1/runs`.
 */
export function parseTriggerBody(raw: unknown): TriggerRequest | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Send a JSON object: { \"agent_id\": \"…\", \"git_commit_sha\": \"…\" }." };
  }
  const body = raw as Body;

  const agentId = field(body, "agent_id", "agentId");
  if (typeof agentId !== "string" || !UUID.test(agentId)) {
    return { error: "`agent_id` must be an agent id. GET /api/v1/agents lists them." };
  }

  const suiteId = field(body, "suite_id", "suiteId");
  const suiteRef = field(body, "suite", "suite_key", "suiteKey", "suite_slug", "suiteSlug");
  if (suiteId !== undefined && suiteRef !== undefined) {
    return { error: "Name the suite once: `suite_id`, or `suite` as a key such as `eu-support-v5`." };
  }
  if (suiteId !== undefined && (typeof suiteId !== "string" || !UUID.test(suiteId))) {
    return { error: "`suite_id` must be a suite id. GET /api/v1/suites lists them." };
  }
  if (suiteRef !== undefined && (typeof suiteRef !== "string" || !SUITE_REF.test(suiteRef.trim().toLowerCase()))) {
    return { error: "`suite` must be a suite key such as `eu-support` or `eu-support-v5`. GET /api/v1/suites lists them." };
  }

  const sha = field(body, "git_commit_sha", "gitCommitSha", "commit_sha", "sha");
  if (sha !== undefined && (typeof sha !== "string" || !SHA.test(sha.trim()))) {
    return { error: "`git_commit_sha` must be a commit hash: 7 to 64 hexadecimal characters." };
  }

  const branch = field(body, "git_branch", "gitBranch", "branch");
  if (branch !== undefined && (typeof branch !== "string" || !branch.trim() || branch.trim().length > 255 || /[\u0000-\u001f\u007f]/.test(branch))) {
    return { error: "`git_branch` must be a branch name of at most 255 printable characters." };
  }

  const pr = field(body, "pr_number", "prNumber", "pull_request");
  const prNumber = typeof pr === "number" ? pr : typeof pr === "string" && /^\d{1,9}$/.test(pr.trim()) ? Number(pr.trim()) : pr === undefined ? null : NaN;
  if (prNumber !== null && (!Number.isInteger(prNumber) || prNumber < 1 || prNumber > 2_147_483_647)) {
    return { error: "`pr_number` must be a pull request number: a whole number from 1." };
  }

  const cancel = field(body, "cancel_superseded", "cancelSuperseded");
  if (cancel !== undefined && typeof cancel !== "boolean") {
    return { error: "`cancel_superseded` must be true or false." };
  }

  const locale = field(body, "locale");
  if (locale !== undefined && !isLocale(locale)) {
    return { error: "`locale` must be one of en, de, fr, ro." };
  }
  const extensions = field(body, "include_extensions", "includeExtensions");
  if (extensions !== undefined && typeof extensions !== "boolean") {
    return { error: "`include_extensions` must be true or false." };
  }

  const gitCommitSha = typeof sha === "string" ? sha.trim().toLowerCase() : null;
  // The commit is what the report states as declared, unless the caller declared a release.
  const declared = cleanDeclared({
    releaseId: field(body, "release_id", "releaseId") ?? gitCommitSha ?? undefined,
    knowledgeBaseRevision: field(body, "knowledge_base_revision", "knowledgeBaseRevision"),
  });
  if ("error" in declared) return declared;

  return {
    agentId: agentId.toLowerCase(),
    suiteId: typeof suiteId === "string" ? suiteId.toLowerCase() : null,
    suiteRef: typeof suiteRef === "string" ? suiteRef.trim().toLowerCase() : null,
    gitCommitSha,
    gitBranch: typeof branch === "string" ? branch.trim() : null,
    prNumber,
    cancelSuperseded: cancel === undefined ? true : cancel,
    locale: locale === undefined ? "en" : locale,
    includeExtensions: extensions === true,
    declared,
  };
}

/**
 * `eu-support-v5` → key `eu-support`, version 5; `eu-support` → the key at its newest version.
 * Both readings are offered, exact key first, because a key may itself end in `-v<digits>`.
 */
export function suiteRefCandidates(ref: string): Array<{ key: string; version: number | null }> {
  const out: Array<{ key: string; version: number | null }> = [{ key: ref, version: null }];
  const m = /^(.+)-v(\d{1,6})$/.exec(ref);
  if (m) out.push({ key: m[1], version: Number(m[2]) });
  return out;
}

/** What a trigger for a commit that already has a live row should do. */
export type DedupeDecision =
  /** Its run exists and was not aborted: answer with it. */
  | "replay"
  /** Its run was aborted and sealed nothing: retire the row and start a new run. */
  | "retire_and_retry"
  /** No run appeared long after the claim: the request that claimed it died. Remove the claim. */
  | "abandoned"
  /** Another request is starting this commit's run right now: wait and look again. */
  | "wait";

export const CLAIM_ABANDONED_AFTER_MS = 60_000;

export function dedupeDecision(existing: { runStatus: string | null; claimedAt: string }, now = Date.now()): DedupeDecision {
  if (existing.runStatus === "aborted") return "retire_and_retry";
  if (existing.runStatus !== null) return "replay";
  return now - Date.parse(existing.claimedAt) > CLAIM_ABANDONED_AFTER_MS ? "abandoned" : "wait";
}

/**
 * The runs a new commit supersedes: earlier triggers for the same agent and branch, on another
 * commit, whose run has not finished. A run a person started is never in the list (it has no
 * trigger), and neither is a finished one — stopping is only ever for work nobody needs now.
 */
export function supersededRunIds(
  current: { runId: string; agentId: string; gitBranch: string | null; gitCommitSha: string | null },
  triggers: ReadonlyArray<{ runId: string; agentId: string; gitBranch: string | null; gitCommitSha: string | null }>,
  runStatus: ReadonlyMap<string, string>,
): string[] {
  if (!current.gitBranch) return [];
  return triggers
    .filter((t) => t.runId !== current.runId && t.agentId === current.agentId && t.gitBranch === current.gitBranch)
    .filter((t) => t.gitCommitSha === null || t.gitCommitSha !== current.gitCommitSha)
    .filter((t) => {
      const status = runStatus.get(t.runId);
      return status === "queued" || status === "running";
    })
    .map((t) => t.runId);
}

/** Stored on the stopped run and shown on its page. */
export function supersededReason(by: { gitCommitSha: string | null; gitBranch: string; runId: string }): string {
  const commit = by.gitCommitSha ? `commit ${by.gitCommitSha.slice(0, 12)}` : "a newer trigger";
  return `Superseded by ${commit} on ${by.gitBranch} before it finished; run ${by.runId} replaced it. Its graded scenarios are kept; no report was sealed.`;
}
