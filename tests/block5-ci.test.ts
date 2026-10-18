import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lastUsedLabel, scopeProblem, scopesFromChoices, shouldRecordUse } from "../src/lib/api/keys.ts";
import {
  dedupeDecision, parseTriggerBody, supersededReason, supersededRunIds, suiteRefCandidates, CLAIM_ABANDONED_AFTER_MS,
} from "../src/lib/ci/trigger.ts";
import { baselineComparison, baselineSentence, ciRunExit, previousComparable } from "../src/lib/ci/gate.ts";
import { githubWorkflow, WORKFLOW_PATH } from "../src/lib/ci/workflow.ts";
import { reportToJunit, unsealedRunJunit } from "../src/lib/report/export.ts";
import { scenarioDeltas, type DeltaRun, type ScenarioEvidence } from "../src/lib/evidence/compare.ts";
import { TRANSPORT_HALT_MESSAGE } from "../src/lib/runner/execute.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { abortedReason } from "../src/lib/webhooks/deliver.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

const AGENT = "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const SHA = "4f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39";

// ---- Module 1: scopes and last use ------------------------------------------------------

test("every scope beyond read needs read, probe included; the list stays closed", () => {
  assert.equal(scopeProblem(["read"]), null);
  assert.equal(scopeProblem(["read", "probe"]), null);
  assert.equal(scopeProblem(["read", "run", "write", "responses", "probe"]), null);
  for (const alone of ["probe", "run", "write", "responses"]) {
    assert.match(scopeProblem([alone]) ?? "", new RegExp(`${alone} scope must also have the read scope`), alone);
  }
  assert.match(scopeProblem(["read", "admin"]) ?? "", /There is no admin scope/);
  assert.match(scopeProblem([]) ?? "", /at least one/);
  assert.match(scopeProblem(["read", "read"]) ?? "", /twice/);
  assert.deepEqual(scopesFromChoices({}), ["read"]);
  assert.deepEqual(scopesFromChoices({ probe: true, run: true }), ["read", "run", "probe"]);
});

test("the migration's constraint says the same as the application", () => {
  const sql = readFileSync("supabase/migrations/0070_ci_triggers.sql", "utf8");
  assert.match(sql, /scopes <@ array\['read', 'run', 'write', 'responses', 'probe'\]/);
  assert.match(sql, /not \('probe' = any\(scopes\)\) or 'read' = any\(scopes\)/);
  // The one unique index that makes "one run per commit" race-safe.
  assert.match(sql, /on ci_triggers \(workspace_id, agent_id, suite_id, locale, git_commit_sha\)\s+where git_commit_sha is not null and retired_at is null/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /erasing_workspace\(\)/);
});

test("last use is written at most once a minute and shown in words", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(shouldRecordUse(null, now), true);
  assert.equal(shouldRecordUse("2026-10-16T11:59:30Z", now), false);
  assert.equal(shouldRecordUse("2026-10-16T11:59:00Z", now), true);
  assert.equal(lastUsedLabel(null, now), "Never used");
  assert.equal(lastUsedLabel("2026-10-16T11:59:40Z", now), "Last used within the last minute");
  assert.equal(lastUsedLabel("2026-10-16T11:59:00Z", now), "Last used 1 minute ago");
  assert.equal(lastUsedLabel("2026-10-16T09:00:00Z", now), "Last used 3 hours ago");
  assert.equal(lastUsedLabel("2026-10-15T12:00:00Z", now), "Last used 1 day ago");
  assert.equal(lastUsedLabel("2026-06-01T12:00:00Z", now), "Last used on 2026-06-01");
});

// ---- Module 2: the trigger ---------------------------------------------------------------

test("a trigger body is read in snake_case or camelCase, and answers the same", () => {
  const snake = parseTriggerBody({ agent_id: AGENT, suite: "eu-support-v5", git_commit_sha: SHA.toUpperCase(), git_branch: "feature/refunds", pr_number: 42, cancel_superseded: false, locale: "de", include_extensions: true });
  const camel = parseTriggerBody({ agentId: AGENT, suiteSlug: "eu-support-v5", gitCommitSha: SHA, gitBranch: "feature/refunds", prNumber: "42", cancelSuperseded: false, locale: "de", includeExtensions: true });
  assert.ok(!("error" in snake) && !("error" in camel));
  assert.deepEqual(snake, camel);
  assert.equal(snake.gitCommitSha, SHA, "lower-cased");
  assert.equal(snake.prNumber, 42);
  assert.equal(snake.cancelSuperseded, false);
  assert.equal(snake.suiteRef, "eu-support-v5");
  assert.equal(snake.suiteId, null);
  assert.equal(snake.locale, "de");
  assert.equal(snake.includeExtensions, true);
});

test("a trigger's language defaults to English and is refused outside en, de, fr, ro", () => {
  const plain = parseTriggerBody({ agent_id: AGENT });
  assert.ok(!("error" in plain) && plain.locale === "en" && plain.includeExtensions === false);
  assert.ok("error" in parseTriggerBody({ agent_id: AGENT, locale: "es" }));
  assert.ok("error" in parseTriggerBody({ agent_id: AGENT, include_extensions: "yes" }));
});

test("the commit is the declared release unless one is sent; superseding is on by default", () => {
  const plain = parseTriggerBody({ agent_id: AGENT, git_commit_sha: SHA });
  assert.ok(!("error" in plain));
  assert.equal(plain.declared.releaseId, SHA);
  assert.equal(plain.cancelSuperseded, true);
  assert.equal(plain.suiteRef, null);
  const named = parseTriggerBody({ agent_id: AGENT, git_commit_sha: SHA, release_id: "v2.3.0" });
  assert.ok(!("error" in named));
  assert.equal(named.declared.releaseId, "v2.3.0");
  const none = parseTriggerBody({ agent_id: AGENT });
  assert.ok(!("error" in none));
  assert.equal(none.declared.releaseId, undefined);
  assert.equal(none.gitCommitSha, null);
});

test("malformed fields are refused with a sentence naming the field", () => {
  const cases: Array<[unknown, RegExp]> = [
    [null, /JSON object/],
    [[], /JSON object/],
    [{}, /agent_id/],
    [{ agent_id: "nope" }, /agent_id/],
    [{ agent_id: AGENT, suite_id: "x" }, /suite_id/],
    [{ agent_id: AGENT, suite: "Eu Support!" }, /suite/],
    [{ agent_id: AGENT, suite: "eu-support", suite_id: AGENT }, /Name the suite once/],
    [{ agent_id: AGENT, git_commit_sha: "main" }, /git_commit_sha/],
    [{ agent_id: AGENT, git_commit_sha: "abc12" }, /git_commit_sha/],
    [{ agent_id: AGENT, git_branch: "a\nb" }, /git_branch/],
    [{ agent_id: AGENT, git_branch: "x".repeat(256) }, /git_branch/],
    [{ agent_id: AGENT, pr_number: 0 }, /pr_number/],
    [{ agent_id: AGENT, pr_number: "12a" }, /pr_number/],
    [{ agent_id: AGENT, pr_number: 1.5 }, /pr_number/],
    [{ agent_id: AGENT, cancel_superseded: "yes" }, /cancel_superseded/],
    [{ agent_id: AGENT, release_id: "x".repeat(101) }, /release/],
  ];
  for (const [body, why] of cases) {
    const parsed = parseTriggerBody(body);
    assert.ok("error" in parsed, JSON.stringify(body));
    assert.match(parsed.error, why, JSON.stringify(body));
  }
});

test("a suite key is read exactly first, then as key and version", () => {
  assert.deepEqual(suiteRefCandidates("eu-support-v5"), [{ key: "eu-support-v5", version: null }, { key: "eu-support", version: 5 }]);
  assert.deepEqual(suiteRefCandidates("eu-support"), [{ key: "eu-support", version: null }]);
});

test("the same commit again: replay a live run, start again after an abort, clear a dead claim, else wait", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const fresh = new Date(now - 5_000).toISOString();
  const stale = new Date(now - CLAIM_ABANDONED_AFTER_MS - 1).toISOString();
  for (const status of ["queued", "running", "completed"]) assert.equal(dedupeDecision({ runStatus: status, claimedAt: stale }, now), "replay", status);
  assert.equal(dedupeDecision({ runStatus: "aborted", claimedAt: fresh }, now), "retire_and_retry");
  assert.equal(dedupeDecision({ runStatus: null, claimedAt: fresh }, now), "wait");
  assert.equal(dedupeDecision({ runStatus: null, claimedAt: stale }, now), "abandoned");
});

test("a new commit supersedes only unfinished runs of other commits on its branch, for its agent", () => {
  const current = { runId: "new", agentId: "a", gitBranch: "feature", gitCommitSha: "bbbbbbb" };
  const triggers = [
    { runId: "old-running", agentId: "a", gitBranch: "feature", gitCommitSha: "aaaaaaa" },
    { runId: "old-queued", agentId: "a", gitBranch: "feature", gitCommitSha: "ccccccc" },
    { runId: "old-done", agentId: "a", gitBranch: "feature", gitCommitSha: "ddddddd" },
    { runId: "same-commit", agentId: "a", gitBranch: "feature", gitCommitSha: "bbbbbbb" },
    { runId: "other-branch", agentId: "a", gitBranch: "main", gitCommitSha: "eeeeeee" },
    { runId: "other-agent", agentId: "b", gitBranch: "feature", gitCommitSha: "fffffff" },
    { runId: "no-commit", agentId: "a", gitBranch: "feature", gitCommitSha: null },
    { runId: "new", agentId: "a", gitBranch: "feature", gitCommitSha: "bbbbbbb" },
  ];
  const status = new Map([
    ["old-running", "running"], ["old-queued", "queued"], ["old-done", "completed"], ["same-commit", "running"],
    ["other-branch", "running"], ["other-agent", "running"], ["no-commit", "running"], ["new", "queued"],
  ]);
  assert.deepEqual(supersededRunIds(current, triggers, status), ["old-running", "old-queued", "no-commit"]);
  assert.deepEqual(supersededRunIds({ ...current, gitBranch: null }, triggers, status), [], "no branch, nothing superseded");
  const reason = supersededReason({ gitCommitSha: SHA, gitBranch: "feature", runId: "new" });
  assert.equal(reason, "Superseded by commit 4f2a9c1d8e7b on feature before it finished; run new replaced it. Its graded scenarios are kept; no report was sealed.");
  assert.match(reason, /no report was sealed/);
  // A webhook says it in a fixed sentence, naming no commit.
  assert.equal(abortedReason({ error: reason, stopped_by: "u1" }), "Superseded by a newer commit on the same branch before it finished.");
});

// ---- Module 2: the exit code ---------------------------------------------------------------

function payload(counts: Partial<ReportPayload["coverage"]>, band = "A"): ReportPayload {
  const coverage = { planned: 4, graded: 4, passed: 4, failed: 0, errored: 0, not_run: 0, score: 100, basis: "x", ...counts };
  return {
    novera: { format: 14 },
    subject: { client: "Contoso & Co", agent: "Support <bot>", policy_version: 3, environment: "production", authorisation: "Authorised." },
    run: { id: "r", date: "2026-10-16T10:00:00.000Z", suite: "eu-support v5", graded_by: [], graded_uniformly: true, pass_threshold: 80, duration_ms: 1000 },
    grade: { band, score: coverage.score, threshold: 80, basis: "x", meets_threshold: true },
    categories: [],
    coverage,
    obligations: [{ code: "transaction_safety", covered: true, planned: coverage.planned, graded: coverage.graded, passed: coverage.passed, failed: coverage.failed, errored: coverage.errored, not_run: coverage.not_run }],
    findings: coverage.failed
      ? [{ case: "T07", obligation: "transaction_safety", severity: "high", expected: "Refuses \"refunds\" & <escalates>", observed: "Issued it.", outcome: "fail" }]
      : [],
    comparison: null,
    limitations: "Novera is evidence of testing, not a legal certification.",
  } as unknown as ReportPayload;
}

test("exit codes keep the published contract, 0 to 4, with no code while the run is unfinished", () => {
  const sealed = (p: ReportPayload) => ({ status: "completed", error: null, report: { payload: p, revoked: false } });
  assert.equal(ciRunExit(sealed(payload({}))).code, 0);
  assert.equal(ciRunExit(sealed(payload({ passed: 3, failed: 1 }))).code, 1);
  assert.equal(ciRunExit(sealed(payload({ passed: 3, errored: 1 }))).code, 2);
  assert.equal(ciRunExit(sealed(payload({}, "WITHHELD"))).code, 2);
  for (const status of ["queued", "running"]) {
    const e = ciRunExit({ status, error: null, report: null });
    assert.equal(e.code, null, status);
    assert.match(e.reason, new RegExp(status));
  }
  const unreachable = ciRunExit({ status: "aborted", error: TRANSPORT_HALT_MESSAGE, report: null });
  assert.equal(unreachable.code, 4);
  assert.match(unreachable.reason, /not a finding about the agent/);
  const stopped = ciRunExit({ status: "aborted", error: "Stopped by someone@example.test before it finished. Its graded scenarios are kept; no report was sealed.", report: null });
  assert.equal(stopped.code, 2);
  assert.doesNotMatch(stopped.reason, /@/, "a stopper's address never reaches a CI artifact");
  const superseded = ciRunExit({ status: "aborted", error: supersededReason({ gitCommitSha: SHA, gitBranch: "feature", runId: "n" }), report: null });
  assert.equal(superseded.code, 2);
  assert.equal(superseded.reason, "The run ended before it finished (it was superseded by commit 4f2a9c1d8e7b on feature), so no report was sealed and there is no evidence to gate on.");
  assert.equal(ciRunExit({ status: "aborted", error: "Could not save case T01", report: null }).code, 2);
  assert.equal(ciRunExit({ status: "completed", error: null, report: null }).code, 2);
  assert.equal(ciRunExit({ status: "completed", error: null, report: { payload: payload({}), revoked: true } }).code, 3);
});

test("the comparison sentence is exact, singular for one", () => {
  assert.equal(baselineSentence(0), "No previously passing scenario failed");
  assert.equal(baselineSentence(1), "1 previously passing scenario now fails");
  assert.equal(baselineSentence(3), "3 previously passing scenarios now fail");
});

function ev(status: ScenarioEvidence["status"], reply: string): ScenarioEvidence {
  return { status, replied: true, rawSha: null, contentSha: reply, conversation: false, observation: null };
}
function deltaRun(id: string, cases: Record<string, ScenarioEvidence>): DeltaRun {
  return {
    runId: id, agentId: "a", suite: { key: "eu-support", version: 5, owner: null },
    scenarios: Object.keys(cases).map((c) => ({ id: c, digest: `d-${c}`, severity: "high" })),
    cases: new Map(Object.entries(cases)),
  };
}

test("graders moving on an identical reply is never fixed or newly broken", () => {
  const base = deltaRun("base", { T1: ev("pass", "r1"), T2: ev("pass", "same"), T3: ev("fail", "r3"), T4: ev("pass", "r4") });
  const target = deltaRun("target", { T1: ev("fail", "r1-changed"), T2: ev("fail", "same"), T3: ev("pass", "r3-changed"), T4: ev("pass", "r4") });
  const deltas = scenarioDeltas(base, target);
  assert.ok(deltas.ok);
  const b = baselineComparison(deltas, "base", "target", "https://app.example");
  assert.deepEqual(b.newly_broken, ["T1"]);
  assert.deepEqual(b.fixed, ["T3"]);
  assert.deepEqual(b.graders_moved, ["T2"]);
  assert.equal(b.summary, "1 previously passing scenario now fails");
  assert.equal(b.compare_url, "https://app.example/runs/compare?base=base&target=target");
});

test("the baseline is the newest comparable run created before this one", () => {
  const runs = [
    { id: "later", createdAt: "2026-10-16T12:00:00Z" },
    { id: "older", createdAt: "2026-10-10T12:00:00Z" },
    { id: "newest-before", createdAt: "2026-10-15T12:00:00Z" },
  ];
  assert.equal(previousComparable(runs, { id: "this", createdAt: "2026-10-16T00:00:00Z" })?.id, "newest-before");
  assert.equal(previousComparable(runs, { id: "this", createdAt: "2026-10-01T00:00:00Z" }), null);
});

// ---- Module 2: JUnit -----------------------------------------------------------------------

/** Well-formed XML, checked by hand: balanced tags, quoted attributes, no raw `&` or `<` in text. */
function assertWellFormed(xml: string) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  const body = xml.slice(xml.indexOf("?>") + 2);
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w.:-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(body)) !== null) {
    const text = body.slice(last, m.index);
    assert.doesNotMatch(text, /<|&(?!(?:amp|lt|gt|quot|apos);)/, `raw markup in text: ${text.slice(0, 80)}`);
    for (const value of m[3].matchAll(/="([^"]*)"/g)) assert.doesNotMatch(value[1], /&(?!(?:amp|lt|gt|quot|apos);)/);
    if (m[1]) assert.equal(stack.pop(), m[2], `closing ${m[2]}`);
    else if (!m[4]) stack.push(m[2]);
    last = m.index + m[0].length;
  }
  assert.equal(body.slice(last).trim(), "");
  assert.deepEqual(stack, [], "every element is closed");
}

test("a sealed report's JUnit carries the gate's properties beside its own, escaped", () => {
  const xml = reportToJunit(payload({ passed: 3, failed: 1 }), "c".repeat(64), "https://app.example/report/abcdefghijklmnop", {
    properties: [["novera.suite_digest", "d".repeat(64)], ["novera.compare_url", "https://app.example/runs/compare?base=1&target=2"], ["novera.report_seal", "c".repeat(64)]],
  });
  assertWellFormed(xml);
  assert.match(xml, /name="novera.ci_exit_code" value="1"/);
  assert.match(xml, new RegExp(`name="novera.suite_digest" value="${"d".repeat(64)}"`));
  assert.match(xml, /name="novera.compare_url" value="https:\/\/app.example\/runs\/compare\?base=1&amp;target=2"/);
  assert.match(xml, /name="novera.report_seal"/);
  assert.match(xml, /Support &lt;bot&gt;/);
  assert.doesNotMatch(xml, /abcdefghijklmnop/, "the report's token is cut");
  // Without extras, the document is exactly what it was.
  assert.equal(reportToJunit(payload({}), "c".repeat(64), "https://x/report/abcd"), reportToJunit(payload({}), "c".repeat(64), "https://x/report/abcd", {}));
});

test("a run with no sealed report still gets valid JUnit: skipped while running, an error once over", () => {
  const running = unsealedRunJunit({ id: "r1", status: "running", suite: "eu-support v5", exitCode: null, reason: "The run is running. Call execute until it is done, then read this again." });
  assertWellFormed(running);
  assert.match(running, /<skipped message="The run is running/);
  assert.match(running, /name="novera.ci_exit_code" value="none yet"/);
  assert.doesNotMatch(running, /<error|<failure/);

  const halted = ciRunExit({ status: "aborted", error: TRANSPORT_HALT_MESSAGE, report: null });
  const aborted = unsealedRunJunit({ id: "r2", status: "aborted", suite: null, exitCode: halted.code, reason: `${halted.reason} <&> "quoted"`, properties: [["novera.suite_digest", "x&y"]] });
  assertWellFormed(aborted);
  assert.match(aborted, /<error message="No sealed report exists for this run" type="exit 4">/);
  assert.match(aborted, /name="novera.ci_exit_code" value="4"/);
  assert.match(aborted, /name="novera.run_status" value="aborted"/);
  assert.match(aborted, /value="x&amp;y"/);
  assert.match(aborted, /&lt;&amp;&gt; &quot;quoted&quot;/);
  assert.doesNotMatch(aborted, /<failure/, "no evidence is never a failure of the agent");
});

// ---- The workflow ------------------------------------------------------------------------

test("the workflow is generated once: triggers, secret, pinned suite, bounded loop, exit code from Novera", () => {
  const yml = githubWorkflow({ agentId: AGENT, suite: "eu-support-v5", origin: "https://app.example/" });
  assert.equal(WORKFLOW_PATH, ".github/workflows/novera-gate.yml");
  assert.match(yml, /^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]/m);
  assert.match(yml, /NOVERA_API_KEY: \$\{\{ secrets.NOVERA_API_KEY \}\}/);
  assert.match(yml, new RegExp(`NOVERA_AGENT_ID: ${AGENT}`));
  assert.match(yml, /NOVERA_SUITE: eu-support-v5/);
  assert.match(yml, /NOVERA_API: https:\/\/app.example\/api\/v1\n/);
  assert.match(yml, /"\$NOVERA_API\/ci\/trigger"/);
  assert.match(yml, /for i in \$\(seq 1 150\); do/);
  assert.match(yml, /\/runs\/\$NOVERA_RUN_ID\/execute/);
  assert.match(yml, /ci\/runs\/\$NOVERA_RUN_ID\?format=junit/);
  assert.match(yml, /exit "\$code"/);
  assert.match(yml, /verify_url/);
  assert.doesNotMatch(yml, /\.report\.url/, "the report's link grants access; only the seal check is printed");
  assert.doesNotMatch(yml, /\t/);
  // Values a pull request's author controls reach the script only through the environment.
  const scripts = yml.split("\n").filter((l) => /^ {10}/.test(l)).join("\n");
  assert.doesNotMatch(scripts, /\$\{\{/, "no expression is pasted into a run script");
  // The only action is GitHub's own.
  assert.deepEqual([...yml.matchAll(/uses: (\S+)/g)].map((m) => m[1]), ["actions/upload-artifact@v4"]);
  assert.throws(() => githubWorkflow({ agentId: "x; rm -rf /", suite: "eu-support-v5" }), /agent id/);
  assert.throws(() => githubWorkflow({ agentId: AGENT, suite: "a b" }), /suite/);
});

test("the documentation shows exactly the generated workflow", () => {
  const doc = readFileSync("data/docs/integration-github-actions.md", "utf8");
  const block = /```yaml\n([\s\S]*?)```/.exec(doc)?.[1];
  assert.equal(block, githubWorkflow({ agentId: "your-agent-id", suite: "eu-support-v7" }));
  assert.match(doc, /\.github\/workflows\/novera-gate\.yml/);
});

test("nothing generated here claims more than the evidence: the language rule", () => {
  const texts = [
    githubWorkflow({ agentId: AGENT, suite: "eu-support-v5" }),
    readFileSync("data/docs/integration-github-actions.md", "utf8"),
    readFileSync("data/docs/api.md", "utf8"),
    supersededReason({ gitCommitSha: SHA, gitBranch: "main", runId: "r" }),
    ...[0, 1, 5].map(baselineSentence),
    ...[
      { status: "queued", error: null, report: null },
      { status: "aborted", error: TRANSPORT_HALT_MESSAGE, report: null },
      { status: "aborted", error: "Stopped by x before it finished.", report: null },
      { status: "completed", error: null, report: null },
      { status: "completed", error: null, report: { payload: payload({}), revoked: true } },
      { status: "completed", error: null, report: { payload: payload({}), revoked: false } },
    ].map((r) => ciRunExit(r).reason),
    unsealedRunJunit({ id: "r", status: "running", suite: null, exitCode: null, reason: "x" }),
  ];
  for (const t of texts) assert.deepEqual(scanCustomerLanguage(t), [], t.slice(0, 80));
});

// ---- Audit 2026-10-17 (track 5): a suite id that is not this workspace's ------------------

/** A chainable stand-in for the Supabase client: every query answers from `rows[table]`, inserts are recorded. */
function fakeDb(rows: Record<string, unknown>) {
  const inserts: string[] = [];
  const query = (table: string): unknown => {
    const answer = { data: rows[table] ?? null, error: null };
    const chain: Record<string, unknown> = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(answer);
        if (prop === "maybeSingle" || prop === "single") return async () => answer;
        if (prop === "insert") return () => { inserts.push(table); return chain; };
        return () => chain;
      },
    });
    return chain;
  };
  return { db: { from: query } as never, inserts };
}

test("a trigger naming another workspace's suite id is a 404 before any claim, never a 500", async () => {
  const { triggerCiRun } = await import("../src/lib/ci/server.ts");
  const request = parseTriggerBody({ agent_id: AGENT, suite_id: "11111111-2222-4333-8444-555555555555", git_commit_sha: SHA });
  assert.ok(!("error" in request));
  // The suites query is scoped to this workspace and built-ins, so a foreign id finds nothing.
  const { db, inserts } = fakeDb({ suites: null, agents: { id: AGENT } });
  const outcome = await triggerCiRun({ db, workspaceId: "w1", keyId: "k1", request });
  assert.equal(outcome.kind, "not_found");
  assert.match((outcome as { error: string }).error, /could not be found/);
  assert.deepEqual(inserts, [], "no ci_triggers claim is written");
});

test("startRun refuses another workspace's suite in the words it uses for an unknown one", async () => {
  const { startRun, RunRefusal } = await import("../src/lib/workflow/start-run.ts");
  const run = (suite: unknown) => startRun({
    client: fakeDb({ agents: { attestation_text: "x", archived_at: null }, policies: { id: "p1" }, suites: suite }).db,
    workspaceId: "w1", userId: null, agentId: AGENT, suiteId: "11111111-2222-4333-8444-555555555555",
  });
  const refusal = async (suite: unknown) => {
    try { await run(suite); } catch (e) { assert.ok(e instanceof RunRefusal); return (e as Error).message; }
    assert.fail("not refused");
  };
  const unknown = await refusal(null);
  const foreign = await refusal({ id: "s1", workspace_id: "w2", approval: "customer_supplied", cases: [] });
  assert.equal(foreign, unknown);
  assert.equal(unknown, "That suite could not be found.");
});
