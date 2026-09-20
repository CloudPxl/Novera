import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEscalation } from "../src/lib/support/escalate.ts";
import { draftAnswer, type DocPage } from "../src/lib/support/answer.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";

const PAGES: DocPage[] = [
  { slug: "what-novera-does", title: "What Novera does", body: "Novera runs a versioned scenario suite against an AI support agent you operate and produces a dated report." },
  { slug: "trial", title: "The trial", body: "A new workspace gets three runs graded on Novera's own key. Connecting your own model key removes the cap." },
];

function reply(body: unknown): RoutedChat {
  return async () => ({
    text: typeof body === "string" ? body : JSON.stringify(body),
    model: "m", usage: {}, raw: null,
    servedBy: { connection: "groq", model: "m" }, attempts: [],
  });
}

function exploding(): RoutedChat {
  return async () => {
    throw new Error("the model should never have been called");
  };
}

test("a refund question never reaches the model at all", async () => {
  const drafted = await draftAnswer({
    chat: exploding(),
    question: "Can I get a refund for last month?",
    pages: PAGES,
  });
  // The ordering matters: escalation is decided before the model is asked, so there
  // is never a plausible-looking draft for someone to approve in a hurry.
  assert.equal(drafted.answered, false);
  assert.match(drafted.reason ?? "", /refunds/i);
});

test("an erasure request escalates rather than being answered", () => {
  const check = checkEscalation("Please delete my data and confirm when it is done.");
  assert.equal(check.escalate, true);
  assert.match(check.reason ?? "", /Personal data/);
});

test("an ordinary product question does not escalate", () => {
  assert.equal(checkEscalation("How many scenarios are in the suite?").escalate, false);
});

test("an answer citing a page that does not exist is discarded", async () => {
  const drafted = await draftAnswer({
    chat: reply({
      answered: true,
      answer: "Novera supports SOC 2 out of the box.",
      citations: ["security-certifications"],
    }),
    question: "Do you support SSO?",
    pages: PAGES,
  });
  // A fabricated source is worse than no answer: it looks checkable and is not.
  assert.equal(drafted.answered, false);
  assert.match(drafted.reason ?? "", /do not exist/);
  assert.equal(drafted.body, null);
});

test("an answer resting on no documentation is not a draft", async () => {
  const drafted = await draftAnswer({
    chat: reply({ answered: true, answer: "Probably yes.", citations: [] }),
    question: "How many scenarios are in the suite?",
    pages: PAGES,
  });
  assert.equal(drafted.answered, false);
  assert.match(drafted.reason ?? "", /cited no documentation/);
});

test("a grounded answer keeps only the slugs that exist", async () => {
  const drafted = await draftAnswer({
    chat: reply({
      answered: true,
      answer: "A new workspace gets three runs on our key.",
      citations: ["trial", "trial"],
    }),
    question: "How many free runs do I get?",
    pages: PAGES,
  });
  assert.equal(drafted.answered, true);
  assert.deepEqual(drafted.citations, ["trial"]);
  assert.equal(drafted.model, "groq/m");
});

test("the model saying it cannot answer is respected, not overridden", async () => {
  const drafted = await draftAnswer({
    chat: reply({ answered: false, missing: "The docs say nothing about on-premise hosting." }),
    question: "Can I self-host?",
    pages: PAGES,
  });
  assert.equal(drafted.answered, false);
  assert.match(drafted.reason ?? "", /on-premise/);
});

test("no published documentation means no draft, not a guess", async () => {
  const drafted = await draftAnswer({ chat: exploding(), question: "What is this?", pages: [] });
  assert.equal(drafted.answered, false);
  assert.match(drafted.reason ?? "", /no published documentation/i);
});
