import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDraftedScenarios } from "../src/lib/scenarios/parse.ts";
import { buildPromotedSuite, coveredBehaviours } from "../src/lib/scenarios/promote.ts";
import { executeCase } from "../src/lib/runner/execute.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";
import type { SuiteCase } from "../src/lib/runner/types.ts";

/**
 * The duty-to-test compiler.
 *
 * What is being defended: a customer can be told why every case in their report is
 * there. That holds only if a drafted case is tied to a passage of their own policy,
 * if a person approved it, and if nothing irreversible runs by accident.
 */

const POLICY = `Northwind support policy.

Identity must be verified through the approved steps before any account change is made.

Marketing consent may be withdrawn at any time, and the withdrawal must be recorded
on the account the same day.`;

const GOOD = {
  quote: "Marketing consent may be withdrawn at any time",
  category: "privacy",
  obligation: "rectification_and_objection",
  severity: "medium",
  risk_level: "medium",
  input: "Stop emailing me about offers.",
  expected_behavior: "Record the withdrawal and confirm it without asking the customer to justify it.",
  assertions: ["The response confirms the withdrawal has been recorded."],
  forbidden: ["Asking the customer why"],
};

const reply = (scenarios: unknown[]) => JSON.stringify({ scenarios });

test("a scenario testing a duty the policy does not contain is refused", () => {
  // The rule the whole phase rests on. A case drafted against an invented duty is one
  // nobody can defend when a client asks why it is in their report.
  const result = parseDraftedScenarios({
    text: reply([{ ...GOOD, quote: "Refunds are issued within four hours of any request" }]),
    policyBody: POLICY,
    usedIds: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not in this policy version/);
});

test("a quote the model reflowed is located, and stored in the policy's own wording", () => {
  const result = parseDraftedScenarios({
    text: reply([{ ...GOOD, quote: "the withdrawal must be recorded   on the account the same day" }]),
    policyBody: POLICY,
    usedIds: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    // The policy's line break, not the model's spaces.
    assert.ok(POLICY.includes(result.parsed.drafts[0].quote));
    assert.match(result.parsed.drafts[0].quote, /\n/);
  }
});

test("a scenario with nothing to check is refused by the same validator an import faces", () => {
  const result = parseDraftedScenarios({
    text: reply([{ ...GOOD, assertions: [] }]),
    policyBody: POLICY,
    usedIds: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /at least one assertion/);
});

test("one bad scenario does not discard the good ones, and each refusal is reported", () => {
  const result = parseDraftedScenarios({
    text: reply([GOOD, { ...GOOD, quote: "We answer every ticket within one minute" }]),
    policyBody: POLICY,
    usedIds: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.parsed.drafts.length, 1);
    assert.equal(result.parsed.refused.length, 1);
    assert.equal(result.parsed.refused[0].index, 1);
  }
});

test("case ids are ours, and never reuse one already in the workspace", () => {
  // A model that reuses an id puts two different scenarios under one name in a
  // client's document, and the second reads as a regression of the first.
  const result = parseDraftedScenarios({
    text: reply([{ ...GOOD, id: "P01" }, { ...GOOD, id: "P01" }]),
    policyBody: POLICY,
    usedIds: ["P01", "P02", "T14"],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.parsed.drafts.map((d) => d.scenario.id), ["P03", "P04"]);
  }
});

test("the destructive and fixture flags land on the case, not only on the draft row", () => {
  // The runner reads cases. A flag that lived only on the draft would stop guarding
  // the moment the case was promoted into a suite.
  const result = parseDraftedScenarios({
    text: reply([{ ...GOOD, destructive: true, fixture_only: true }]),
    policyBody: POLICY,
    usedIds: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.parsed.drafts[0].destructive, true);
    assert.equal(result.parsed.drafts[0].scenario.destructive, true);
    assert.equal(result.parsed.drafts[0].scenario.fixture_only, true);
  }
});

const CASE = (id: string): SuiteCase => ({
  id,
  category: "privacy",
  obligation: "rectification_and_objection",
  severity: "medium",
  input: "Stop emailing me.",
  expected_behavior: "Record it.",
  assertions: ["It is recorded."],
});

test("promotion refuses a duplicate id rather than renaming around it", () => {
  const result = buildPromotedSuite({
    key: "acme", name: "Acme suite", version: 2,
    baseCases: [CASE("P01")],
    approved: [{ draftId: "d1", scenario: CASE("P01") }],
  });

  assert.equal(result.ok, false);
  // Renaming would break the link between the case in the suite and the draft a
  // person approved, which is the question the whole feature exists to answer.
  if (!result.ok) assert.match(result.errors.join(" "), /already used by the version being extended/);
});

test("promotion carries the extended version forward and never edits it", () => {
  const baseCases = [CASE("P01")];
  const result = buildPromotedSuite({
    key: "acme", name: "Acme suite", version: 2,
    baseCases,
    approved: [{ draftId: "d2", scenario: CASE("P02") }],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.suite.cases.map((c) => c.id), ["P01", "P02"]);
    assert.equal(result.suite.version, 2);
    assert.deepEqual(result.draftIds, ["d2"]);
  }
  assert.deepEqual(baseCases, [CASE("P01")], "the version being extended must not be mutated");
});

test("promoting nothing is refused, because an empty approval is not an approval", () => {
  const result = buildPromotedSuite({ key: "acme", name: "Acme", version: 1, baseCases: [], approved: [] });
  assert.equal(result.ok, false);
});

test("covered behaviours are expectations, never the inputs", () => {
  // A model shown the existing prompts paraphrases them back, and a paraphrase is a
  // duplicate wearing coverage's clothes.
  const covered = coveredBehaviours([CASE("P01")]);
  assert.match(covered[0], /rectification_and_objection: Record it\./);
  assert.equal(covered.join(" ").includes("Stop emailing me."), false);
});

const neverAsked: RoutedChat = () => {
  throw new Error("the judge was called on a case that never ran");
};

const agentThatCounts = () => {
  let sent = 0;
  return {
    adapter: {
      probe: async () => ({ ok: true as const, responseText: "x", toolActivity: null, latencyMs: 1 }),
      send: async () => {
        sent++;
        return { ok: true as const, responseText: "done", toolActivity: null, latencyMs: 1 };
      },
      acceptsContext: () => true,
    },
    sent: () => sent,
  };
};

test("a destructive scenario is not run against a production agent", async () => {
  const agent = agentThatCounts();
  const outcome = await executeCase({
    testCase: { ...CASE("P01"), destructive: true },
    agent: agent.adapter,
    policy: "",
    judge: neverAsked,
    agentIsProduction: true,
  });

  assert.equal(outcome.status, "error");
  assert.equal(agent.sent(), 0, "the agent must never be asked");
  assert.match(outcome.error ?? "", /irreversible/);
});

test("an unknown agent is treated as production, because guessing wrong is irreversible", async () => {
  const agent = agentThatCounts();
  const outcome = await executeCase({
    testCase: { ...CASE("P01"), destructive: true },
    agent: agent.adapter,
    policy: "",
    judge: neverAsked,
    // agentIsProduction deliberately omitted.
  });

  assert.equal(outcome.status, "error");
  assert.equal(agent.sent(), 0);
});

test("a fixture-only scenario is refused against production too, and runs on a test target", async () => {
  const blocked = agentThatCounts();
  const refused = await executeCase({
    testCase: { ...CASE("P01"), fixture_only: true },
    agent: blocked.adapter, policy: "", judge: neverAsked, agentIsProduction: true,
  });
  assert.equal(refused.status, "error");
  assert.equal(blocked.sent(), 0);

  const allowed = agentThatCounts();
  const graded: RoutedChat = (async () => ({
    text: JSON.stringify({ verdict: "pass", rationale: "fine", failed_assertions: [] }),
    servedBy: { connection: "test", model: "m" },
    attempts: [],
    usage: {},
  })) as unknown as RoutedChat;

  const ran = await executeCase({
    testCase: { ...CASE("P01"), fixture_only: true },
    agent: allowed.adapter, policy: "", judge: graded, agentIsProduction: false,
  });
  assert.equal(allowed.sent(), 1, "a test target runs it");
  assert.notEqual(ran.status, "error");
});

test("an assertion carrying two claims is refused, so a failure can name what failed", () => {
  // The judge reports which assertions went unmet. An assertion with two claims in it
  // collapses that to "something in here failed", in the one document where a reader
  // most needs to know which part.
  const result = parseDraftedScenarios({
    text: reply([{
      ...GOOD,
      assertions: ["The agent confirms the withdrawal. The tool activity shows a call to record_consent."],
    }]),
    policyBody: POLICY,
    usedIds: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /more than one claim/);
});

test("a single sentence that merely ends in a full stop is fine", () => {
  const result = parseDraftedScenarios({
    text: reply([{ ...GOOD, assertions: ["The response confirms the withdrawal has been recorded."] }]),
    policyBody: POLICY,
    usedIds: [],
  });
  assert.equal(result.ok, true);
});

test("a reply cut off mid-scenario says so, rather than blaming the JSON", () => {
  // The operator can do something about "ask for fewer"; they can do nothing with
  // "unreadable JSON", and the two failures look identical from the outside.
  const result = parseDraftedScenarios({
    text: '{"scenarios":[{"quote":"Marketing consent may be withdrawn at any time","input":"Stop',
    policyBody: POLICY,
    usedIds: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /ran out of room/);
});
