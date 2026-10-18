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
  assert.equal(nextAction({ ...base, readyRunId: "r2" }).href, "/runs/r2");
  assert.equal(nextAction(base).label, "Run again");
});

test("a person is never offered a step their role cannot take", () => {
  const reviewer = { ...base, may: { connect: false, run: false, review: true } };
  assert.notEqual(nextAction({ ...reviewer, hasAgent: false }).href, "/agents/new");
  assert.notEqual(nextAction({ ...reviewer, hasRun: false }).label, "Run the suite");
  assert.notEqual(nextAction(reviewer).label, "Run again");
});

test("a blocked trial says so instead of offering a run that would be refused", () => {
  // No remedy offered: the person is not owner or admin. Under D3 a model key would not help,
  // so they are told who can resolve it, never sent to connect a key.
  const blocked = nextAction({ ...base, hasRun: false, blockedReason: "The trial covers 3 runs…" });
  assert.deepEqual([blocked.href, blocked.label], ["/settings/members", "See who can"]);
  assert.match(blocked.body, /An owner or admin of this workspace can resolve it\.$/);
});

test("someone delivering to clients starts with a client workspace", () => {
  assert.equal(nextAction({ ...base, goal: "client_delivery", hasAgent: false }).href, "/workspaces");
  assert.equal(nextAction({ ...base, goal: "client_delivery", hasAgent: false, workspaces: 2 }).href, "/agents/new");
});

test("a run blocked on payment points at Billing, not at Settings", () => {
  const reason = "The trial covers 3 runs and they have been used. Recurring testing needs a plan…";
  const billing = nextAction({ ...base, hasRun: false, blockedReason: reason, blockedRemedy: { href: "/billing", label: "Choose a plan" } });
  assert.deepEqual([billing.href, billing.label, billing.title], ["/billing", "Choose a plan", "Choose a plan to keep testing"]);
  const key = nextAction({ ...base, hasRun: false, blockedReason: reason, blockedRemedy: { href: "/settings", label: "Connect a model key" } });
  assert.equal(key.href, "/settings");
});

test("after earlier runs, a blocked workspace is not told to run again", () => {
  const blocked = nextAction({ ...base, blockedReason: "The trial covers 3 runs…", blockedRemedy: { href: "/billing", label: "Choose a plan" } });
  assert.equal(blocked.href, "/billing");
  assert.equal(nextAction(base).label, "Run again");
});

import { onboardingRail } from "../src/app/(app)/dashboard/next-action.ts";

test("the rail's current step is the header's step, in every state a person can act on", () => {
  const may = { connect: true, run: true, review: true };
  for (const [hasAgent, hasPolicy, expected] of [[false, false, 0], [true, false, 1], [true, true, 2]] as const) {
    const input = { ...base, hasAgent, hasPolicy, hasRun: false, firstAgentId: hasAgent ? "a1" : null, runInFlight: null, blockedReason: null, may };
    const rail = onboardingRail(input);
    assert.deepEqual(rail.map((s) => s.state), [0, 1, 2].map((i) => (i < expected ? "done" : i === expected ? "current" : "pending")));
    assert.equal(rail[expected].href, nextAction(input).href);
    // Pending steps are never links.
    for (const s of rail.slice(expected + 1)) assert.equal(s.href, null);
  }
});

test("a step the role cannot take names who can, and does not link", () => {
  const rail = onboardingRail({ hasAgent: true, firstAgentId: "a1", hasPolicy: true, hasRun: false, may: { connect: false, run: false, review: true } });
  assert.equal(rail[2].state, "current");
  assert.equal(rail[2].href, null);
  assert.match(rail[2].note, /operator, admin or owner/);
});

test("someone delivering to clients is first asked for a client workspace, in the header and in the rail", () => {
  const input = { ...base, goal: "client_delivery" as const, workspaces: 1, hasAgent: false, firstAgentId: null, hasPolicy: false, hasRun: false };
  const header = nextAction(input);
  assert.equal(header.label, "Add a client workspace");
  const rail = onboardingRail(input);
  assert.deepEqual(rail.map((s) => s.key), ["client", "connect", "policy", "run"]);
  assert.deepEqual(rail.map((s) => s.state), ["current", "pending", "pending", "pending"]);
  assert.equal(rail[0].label, header.label);
  assert.equal(rail[0].href, header.href);
  for (const s of rail.slice(1)) assert.equal(s.href, null);
});

test("once a client workspace exists, the header and the rail both say Connect your agent", () => {
  const input = { ...base, goal: "client_delivery" as const, workspaces: 2, hasAgent: false, firstAgentId: null, hasPolicy: false, hasRun: false };
  const header = nextAction(input);
  const rail = onboardingRail(input);
  assert.deepEqual(rail.map((s) => s.key), ["connect", "policy", "run"]);
  assert.equal(header.title, "Connect your agent");
  const current = rail.find((s) => s.state === "current")!;
  assert.equal(current.label, "Connect your agent");
  assert.equal(current.href, header.href);
});

test("the rail's current step is the header's, for every goal, workspace count and stage", () => {
  const may = { connect: true, run: true, review: true };
  for (const goal of ["own_agent", "client_delivery", "governance", null] as const) {
    for (const workspaces of [1, 2]) {
      for (const [hasAgent, hasPolicy] of [[false, false], [true, false], [true, true]] as const) {
        const input = { ...base, goal, workspaces, hasAgent, hasPolicy, hasRun: false, firstAgentId: hasAgent ? "a1" : null, runInFlight: null, blockedReason: null, may };
        const rail = onboardingRail(input);
        const current = rail.filter((s) => s.state === "current");
        assert.equal(current.length, 1, `exactly one current step for ${JSON.stringify({ goal, workspaces, hasAgent, hasPolicy })}`);
        assert.equal(current[0].href, nextAction(input).href, `header and rail disagree for ${JSON.stringify({ goal, workspaces, hasAgent, hasPolicy })}`);
        // A step is only ever done in order: nothing pending sits before the current one.
        assert.deepEqual(rail.map((s) => s.state).filter((s) => s !== "done"), rail.map((s) => s.state).slice(rail.findIndex((s) => s.state === "current")));
      }
    }
  }
});
