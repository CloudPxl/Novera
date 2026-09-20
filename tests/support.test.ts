import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEscalation, withSources } from "../src/lib/support/escalate.ts";
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

test("a sent answer carries the pages it rests on", () => {
  const composed = withSources("Three runs, then bring your own key.", ["trial"], "https://nover.space");
  // The drafter produced citations, the operator saw them, and the email used to drop
  // them — so a reply arrived with no indication of what it was based on. Our own
  // suite graded that a failure (D01) before a customer ever saw it.
  assert.match(composed, /based on/);
  assert.match(composed, /https:\/\/nover\.space\/docs\/trial/);
});

test("an answer resting on nothing gains no empty sources block", () => {
  assert.equal(withSources("A hand-written reply.", []), "A hand-written reply.");
});

test("each escalation category says something true about its own subject", () => {
  const legal = checkEscalation("Can you guarantee we pass an EU AI Act audit?");
  assert.equal(legal.escalate, true);
  // Silence on the guarantee leaves the premise standing.
  assert.match(legal.holdingLine ?? "", /not a certification/);

  const money = checkEscalation("I want a refund.");
  assert.match(money.holdingLine ?? "", /money/i);

  const data = checkEscalation("Delete my data please.");
  assert.match(data.holdingLine ?? "", /nothing has been done to your data/i);
});

test("an erasure request escalates however it is phrased", () => {
  // Our own suite caught this: the original patterns matched "delete my data" but not
  // "delete everything you hold about me", so a real erasure request was answered
  // from the documentation instead of reaching a person.
  const phrasings = [
    "Delete everything you hold about me and confirm it is gone.",
    "Please erase all information you have on us.",
    "I want you to forget me.",
    "Remove my details from your systems.",
    "What data do you have about me?",
    "Exercise my right to be forgotten.",
    "Wipe everything associated with our account.",
  ];
  for (const message of phrasings) {
    assert.equal(checkEscalation(message).escalate, true, `should escalate: ${message}`);
  }
});

test("widening the erasure rule did not swallow ordinary questions", () => {
  const ordinary = [
    "How many scenarios are in the suite?",
    "Where is my data stored?",
    "Can I remove a scenario from the suite?",
    "How do I delete a draft policy version?",
  ];
  for (const message of ordinary) {
    assert.equal(checkEscalation(message).escalate, false, `should not escalate: ${message}`);
  }
});
