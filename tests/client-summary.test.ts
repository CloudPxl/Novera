import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientSummary, comparisonClientSummary, CLIENT_SUMMARY_NOTICE } from "../src/lib/report/client-summary.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

const HASH = "a".repeat(64);
const payload = (extra: Partial<ReportPayload> = {}) => ({
  novera: { format: 15 },
  subject: { client: "Acme", agent: "Support bot", policy_version: 3, environment: "x", authorisation: "x" },
  run: { id: "r", date: "2026-10-19T09:30:12Z", suite: "eu-support v7", graded_by: [], graded_uniformly: true, grading_funded_by: "trial",
    locale: { code: "de", name: "German", localised: 49, of: 49, locale_digest: "d" } },
  grade: { band: "B", score: 84, threshold: 80, basis: "", meets_threshold: true },
  coverage: { planned: 49, graded: 46, passed: 41, failed: 5, errored: 2, not_run: 1, score: 84, basis: "", effect_confirmed: 3, effect_contradicted: 1 },
  obligations: [], findings: [],
  comparison: { baseline_run: "b", baseline_policy_version: 2, fixed: ["T01", "T02"], persistent_failures: [], new_failures: ["T07"], now_errored: [], error_resolved: [], partial: false, note: "" },
  ...extra,
}) as unknown as ReportPayload;

test("the run summary carries the sealed counts, the seal, the verify link and the notice", () => {
  const text = clientSummary({ payload: payload(), contentHash: HASH, origin: "https://www.nover.space", reportPath: "/report/tok" });
  assert.match(text, /^Novera evaluation — Support bot$/m);
  assert.match(text, /Suite: eu-support v7 · language: German \(49 of 49 scenarios\)/);
  assert.match(text, /Grade: B \(84%, pass mark 80%\)/);
  assert.match(text, /Scenarios: 49 planned · 41 passed · 5 failed · 3 without a result/);
  assert.match(text, /3 confirmed · 1 contradicted/);
  assert.match(text, /1 previously passing scenario now fails · 2 resolved/);
  assert.match(text, new RegExp(`Seal \\(SHA-256\\): ${HASH}`));
  assert.match(text, new RegExp(`https://www\\.nover\\.space/verify/${HASH}`));
  assert.match(text, /Report: https:\/\/www\.nover\.space\/report\/tok/);
  assert.equal(text.split("\n").at(-1), CLIENT_SUMMARY_NOTICE);
  assert.deepEqual(scanCustomerLanguage(text), []);
});

test("an older report without grade, locale, read-back or comparison leaves those lines out rather than guessing", () => {
  const old = payload({ grade: undefined, comparison: null as never });
  const p = old as unknown as { run: { locale?: unknown }; coverage: Record<string, unknown> };
  delete p.run.locale; delete p.coverage.effect_confirmed; delete p.coverage.effect_contradicted;
  const text = clientSummary({ payload: old, contentHash: HASH, origin: "https://www.nover.space" });
  assert.doesNotMatch(text, /Grade:|Claimed actions|Compared with|Report:/);
  assert.match(text, /language: English/);
});

test("the comparison summary names the verdict, both seals and never a withdrawn one", () => {
  const text = comparisonClientSummary({ agent: "Support bot", suite: "EU support (eu-support v7)", base: { date: "2026-10-18T09:00:00Z", seal: HASH }, target: { date: "2026-10-19T09:00:00Z", seal: null }, regressed: 0, fixed: 3, origin: "https://www.nover.space" });
  assert.match(text, /no previously passing scenario failed · 3 resolved/);
  assert.match(text, /Earlier run seal \(SHA-256\): a{64} — https:\/\/www\.nover\.space\/verify\/a{64}/);
  assert.match(text, /Later run: no sealed report\./);
  assert.equal(text.split("\n").at(-1), CLIENT_SUMMARY_NOTICE);
  const page = readFileSync("src/app/(app)/runs/compare/page.tsx", "utf8");
  assert.match(page, /seal: target\.seal && !target\.seal\.revokedAt \? target\.seal\.contentHash : null/, "a withdrawn seal is not handed on");
});

test("the single-scenario check says, before it is pressed, that it spends no run", async () => {
  const src = readFileSync("src/components/ui/try-scenario-alone.tsx", "utf8");
  assert.match(src, /Free single-scenario check — does not use a run from your allowance\./);
  assert.match(src, /\{SINGLE_CHECK_ALLOWANCE_NOTE\}/);
});

test("a summary of a run against Novera's scripted fixture says it is test data", () => {
  const fixture = payload({ subject: { client: "x", agent: "Sample support agent (Novera test fixture)", policy_version: 1, environment: "Novera scripted test fixture — not a customer system", authorisation: "x" } } as never);
  const text = clientSummary({ payload: fixture, contentHash: HASH, origin: "https://www.nover.space" });
  assert.equal(text.split("\n")[1], "TEST DATA: run against Novera's scripted test fixture, not a real agent.");
  assert.doesNotMatch(clientSummary({ payload: payload(), contentHash: HASH, origin: "https://www.nover.space" }), /TEST DATA/);
});
