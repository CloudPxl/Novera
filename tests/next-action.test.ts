import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAction, type NextInput } from "../src/app/(app)/dashboard/next-action.ts";

const base: NextInput = {
  goal: "own_agent", accountMode: "personal", workspaces: 1, hasAgent: true, firstAgentId: "a1", hasPolicy: true, hasRun: true,
  runInFlight: null, topFinding: null, noVerdict: 0, readyRunId: null, blockedReason: null, may: { connect: true, run: true, review: true },
};

test("each stage of a first run has its own next step", () => {
  assert.equal(nextAction({ ...base, hasAgent: false }).href, "/agents/new");
  assert.equal(nextAction({ ...base, hasPolicy: false, hasRun: false }).label, "Write the policy");
  assert.equal(nextAction({ ...base, hasRun: false }).label, "Run the suite");
  assert.equal(nextAction({ ...base, runInFlight: "r9" }).href, "/runs/r9");
  assert.equal(nextAction({ ...base, topFinding: { href: "/runs/r1?case=T15", caseId: "T15", label: "Identity" } }).href, "/runs/r1?case=T15");
  assert.equal(nextAction({ ...base, noVerdict: 3 }).href, "/review?view=incomplete");
  assert.equal(nextAction({ ...base, readyRunId: "r2" }).href, "/runs/r2#report");
  assert.equal(nextAction(base).label, "Run again");
});

test("a person is never offered a step their role cannot take", () => {
  const reviewer = { ...base, may: { connect: false, run: false, review: true } };
  assert.notEqual(nextAction({ ...reviewer, hasAgent: false }).href, "/agents/new");
  assert.notEqual(nextAction({ ...reviewer, hasRun: false }).label, "Run the suite");
  assert.notEqual(nextAction(reviewer).label, "Run again");
});

test("a blocked trial says so instead of offering a run that would be refused", () => {
  assert.equal(nextAction({ ...base, hasRun: false, blockedReason: "The trial covers 3 runs…" }).href, "/settings");
});

test("someone delivering to clients starts with a client workspace", () => {
  assert.equal(nextAction({ ...base, goal: "client_delivery", hasAgent: false }).href, "/workspaces");
  assert.equal(nextAction({ ...base, goal: "client_delivery", hasAgent: false, workspaces: 2 }).href, "/agents/new");
});
