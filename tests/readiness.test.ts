import { test } from "node:test";
import assert from "node:assert/strict";
import { readinessOf } from "../src/lib/report/readiness.ts";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

const BASE: ReportPayload = {
  novera: { format: 13 },
  subject: { client: "Contoso", agent: "Support bot", policy_version: 3, environment: "production", authorisation: "Tested with the customer's authorisation." },
  run: {
    id: "run-1", date: "2026-10-01T10:00:00.000Z", suite: "eu-support v5", graded_by: ["groq/a", "mistral/b"], graded_uniformly: true,
    pass_threshold: 80, duration_ms: 1000, grading_funded_by: "Novera's trial keys", manifest_hash: "abc",
    corroboration: { method: "m", agreed: 4, majority: 0, uncorroborated: 0, unresolved: 0, uncorroborated_passes: 0, independent: 4, single_vendor: 0 },
  },
  grade: { band: "A", score: 100, threshold: 80, basis: "4 of 4.", meets_threshold: true },
  coverage: { planned: 4, graded: 4, passed: 4, failed: 0, errored: 0, not_run: 0, score: 100, basis: "4 of 4." },
  obligations: [], findings: [], comparison: null,
  limitations: "Novera is evidence of testing, not a legal certification.",
};
const NOW = new Date("2026-10-02T00:00:00Z");
const sealed = (payload: ReportPayload, over: Partial<{ expires_at: string; revoked_at: string | null }> = {}) => ({
  payload, content_hash: contentHash(payload as unknown as Json), expires_at: "2026-11-01T00:00:00Z", revoked_at: null, ...over,
});
const stateOf = (payload: ReportPayload, extra: Partial<{ expires_at: string; revoked_at: string | null; undisclosed: number; hash: string }> = {}) =>
  readinessOf({ report: { ...sealed(payload, extra), ...(extra.hash ? { content_hash: extra.hash } : {}) }, undisclosedReviews: extra.undisclosed ?? 0, now: NOW }).state;

test("a complete, intact, corroborated report is ready to share — failures included", () => {
  assert.equal(stateOf(BASE), "READY_TO_SHARE");
  const failing = { ...BASE, grade: { ...BASE.grade!, band: "F" as const, score: 50 }, coverage: { ...BASE.coverage, passed: 2, failed: 2, score: 50 } };
  assert.equal(stateOf(failing), "READY_TO_SHARE", "a report that shows failures is the evidence a client is owed");
});

test("incomplete and withheld stay as the sealed grade says, however the link is used", () => {
  assert.equal(stateOf({ ...BASE, grade: { ...BASE.grade!, band: "INCOMPLETE", score: null }, coverage: { ...BASE.coverage, passed: 3, not_run: 1 } }), "INCOMPLETE");
  assert.equal(stateOf({ ...BASE, grade: { ...BASE.grade!, band: "WITHHELD", score: null }, coverage: { ...BASE.coverage, passed: 3, errored: 1 } }), "WITHHELD");
});

test("a pass one model gave alone, or a review the report does not carry, means review before sharing", () => {
  const lone = { ...BASE, run: { ...BASE.run, corroboration: { ...BASE.run.corroboration!, uncorroborated: 1, uncorroborated_passes: 1 } } };
  assert.equal(stateOf(lone), "READY_FOR_INTERNAL_REVIEW");
  assert.equal(stateOf(BASE, { undisclosed: 2 }), "READY_FOR_INTERNAL_REVIEW");
  assert.equal(stateOf({ ...BASE, subject: { ...BASE.subject, authorisation: "Not recorded." } }), "READY_FOR_INTERNAL_REVIEW");
});

test("a document that does not hold together is blocked", () => {
  assert.equal(stateOf(BASE, { hash: "0".repeat(64) }), "BLOCKED_BY_EVIDENCE");
  assert.equal(stateOf({ ...BASE, limitations: "" }), "BLOCKED_BY_EVIDENCE");
  assert.equal(stateOf({ ...BASE, coverage: { ...BASE.coverage, passed: 2 } }), "BLOCKED_BY_EVIDENCE");
});

test("withdrawn and expired outrank everything", () => {
  assert.equal(stateOf(BASE, { revoked_at: "2026-10-01T12:00:00Z" }), "REVOKED");
  assert.equal(stateOf(BASE, { expires_at: "2026-10-01T00:00:00Z" }), "EXPIRED");
});

test("an older report without the newer fields is judged on what it has, with notes, not gaps", () => {
  const old = { ...BASE, novera: { format: 2 }, run: { ...BASE.run, manifest_hash: undefined, corroboration: { method: "m", agreed: 4, majority: 0, uncorroborated: 0, unresolved: 0 } } };
  const { state, checks } = readinessOf({ report: sealed(old as ReportPayload), undisclosedReviews: 0, now: NOW });
  assert.equal(state, "READY_TO_SHARE");
  assert.equal(checks.find((c) => c.label === "Inputs declared before the run")?.result, "note");
});
