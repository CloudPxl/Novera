import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunManifest, endpointHost, rubricHash } from "../src/lib/report/manifest.ts";

const base = {
  runId: "run-1", createdAt: "2026-09-23T00:00:00.000Z",
  agentId: "agent-1", agentUrl: "https://agent.example.com/hook?token=SECRET123",
  policyId: "pol-1", policyVersion: 3,
  suiteId: "suite-1", suiteKey: "eu-support", suiteVersion: 2,
  caseIds: ["T01", "T02", "T03"],
  judgeSource: "trial_free" as const, passThreshold: 80, runnerVersion: "1.0.0",
};

test("the endpoint appears as a host, never as a URL that could carry a token", () => {
  const { manifest } = buildRunManifest(base);
  assert.equal(manifest.agent.endpoint_host, "agent.example.com");
  assert.ok(!JSON.stringify(manifest).includes("SECRET123"));
});

test("an unparseable endpoint becomes null rather than leaking the raw string", () => {
  assert.equal(endpointHost("not a url"), null);
  assert.equal(endpointHost(null), null);
});

test("the same declared inputs hash the same, every time", () => {
  assert.equal(buildRunManifest(base).hash, buildRunManifest({ ...base }).hash);
});

test("changing the suite version changes the digest", () => {
  assert.notEqual(buildRunManifest(base).hash, buildRunManifest({ ...base, suiteVersion: 3 }).hash);
});

test("reordering the cases changes the digest", () => {
  // Order is part of what was declared. A reader comparing two manifests should see
  // a reordering as a difference rather than have it normalised away.
  assert.notEqual(
    buildRunManifest(base).hash,
    buildRunManifest({ ...base, caseIds: ["T03", "T02", "T01"] }).hash,
  );
});

test("dropping a case from the declared list changes the digest", () => {
  // The case this exists for: choosing the scenarios after seeing the answers.
  assert.notEqual(
    buildRunManifest(base).hash,
    buildRunManifest({ ...base, caseIds: ["T01", "T02"] }).hash,
  );
});

test("the rubric versions itself, so a changed prompt is a changed manifest", () => {
  const hash = rubricHash();
  assert.match(hash, /^[0-9a-f]{12}$/);
  assert.equal(buildRunManifest(base).manifest.rubric_hash, hash);
});

test("the judge plan records which models the run meant to ask", () => {
  const { manifest } = buildRunManifest(base);
  assert.ok(manifest.judge_plan.length > 0);
  assert.ok(manifest.judge_plan.every((c) => c.connection && c.model && c.task));
});
