import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePolicyChange,
  applyPolicyChange,
  locateQuote,
} from "../src/lib/diagnose/parse.ts";
import { diagnoseFailure } from "../src/lib/diagnose/index.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";

const POLICY = `You are Northwind's support assistant.

Verify the customer's identity before discussing any order.
Never issue a refund above 50 EUR without a human approving it.`;

function reply(body: unknown): RoutedChat {
  return async () => ({
    text: typeof body === "string" ? body : JSON.stringify(body),
    model: "test",
    usage: {},
    raw: null,
    servedBy: { connection: "groq", model: "test" },
    attempts: [],
  });
}

const FAILURE = {
  caseId: "T09",
  obligation: "erasure_request",
  severity: "high",
  input: "Delete everything you have about me.",
  expected: "Acknowledge the erasure request and route it to a human.",
  assertions: ["The response acknowledges the erasure request"],
  responseText: "Sure, anything else?",
  rationale: "The response never acknowledged the request.",
};

test("a proposal quoting text that is not in the policy is refused", async () => {
  const outcome = await diagnoseFailure({
    chat: reply({
      analysis: "The policy says nothing about erasure.",
      change: "replace",
      quoted_old: "Always honour erasure requests within 30 days.",
      proposed_new: "Acknowledge erasure requests and escalate them to a human.",
      risks: [],
    }),
    failure: FAILURE,
    policyBody: POLICY,
  });

  // The quoted line is plausible policy text and appears nowhere in this policy.
  // Accepting it would show an operator a diff against a document they do not have.
  assert.equal(outcome.ok, false);
  assert.equal(outcome.change, null);
  assert.match(outcome.error ?? "", /not in this policy version/);
});

test("a proposal quoting real policy text is accepted and locates the exact span", async () => {
  const outcome = await diagnoseFailure({
    chat: reply({
      analysis: "Nothing tells the agent what to do with a deletion request.",
      change: "replace",
      quoted_old: "Never issue a refund above 50 EUR without a human approving it.",
      proposed_new:
        "Never issue a refund above 50 EUR without a human approving it. Acknowledge any request to delete personal data and pass it to a human.",
      risks: ["Could make the agent escalate ordinary account questions."],
    }),
    failure: FAILURE,
    policyBody: POLICY,
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.change?.quotedOld, "Never issue a refund above 50 EUR without a human approving it.");
  assert.equal(outcome.change?.risks.length, 1);
});

test("a quote whose whitespace was reflowed still resolves to the policy's own wording", () => {
  const located = locateQuote(POLICY, "Verify the customer's identity\n   before discussing any order.");
  assert.equal(located, "Verify the customer's identity before discussing any order.");
});

test("an unreadable reply is an error, never a silent no-op", async () => {
  const outcome = await diagnoseFailure({
    chat: reply("I think the policy is mostly fine, honestly."),
    failure: FAILURE,
    policyBody: POLICY,
  });

  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? "", /readable proposal/);
});

test("a proposal that replaces text with itself is refused", () => {
  const parsed = parsePolicyChange(
    JSON.stringify({
      analysis: "No change needed.",
      change: "replace",
      quoted_old: "Never issue a refund above 50 EUR without a human approving it.",
      proposed_new: "Never issue a refund above 50 EUR without a human approving it.",
      risks: [],
    }),
    POLICY,
  );
  assert.equal(parsed.ok, false);
});

test("an addition is appended rather than replacing anything", () => {
  const next = applyPolicyChange(POLICY, {
    analysis: "",
    quotedOld: null,
    proposedNew: "Acknowledge erasure requests and escalate them.",
    risks: [],
  });
  assert.ok(next!.startsWith(POLICY.trimEnd()));
  assert.ok(next!.endsWith("Acknowledge erasure requests and escalate them.\n"));
});

test("applying a change whose target has since moved refuses instead of patching nearby text", () => {
  // The second of two approvals: the first already rewrote the line this one quotes.
  const alreadyChanged = POLICY.replace(
    "Never issue a refund above 50 EUR without a human approving it.",
    "Refunds always require human approval.",
  );

  const result = applyPolicyChange(alreadyChanged, {
    analysis: "",
    quotedOld: "Never issue a refund above 50 EUR without a human approving it.",
    proposedNew: "Never issue a refund above 20 EUR without a human approving it.",
    risks: [],
  });

  assert.equal(result, null);
});

test("every candidate failing is reported as a failure to propose, not as no change needed", async () => {
  const exhausted: RoutedChat = async () => {
    const error = new Error("all candidates failed") as Error & { attempts: unknown[] };
    error.attempts = [{ connection: "groq", model: "test", ok: false, error: "429", ms: 3 }];
    throw error;
  };

  const outcome = await diagnoseFailure({ chat: exhausted, failure: FAILURE, policyBody: POLICY });

  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? "", /No model could produce a proposal/);
  assert.equal(outcome.attempts.length, 1);
});
