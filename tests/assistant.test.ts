import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessages, parseReply, pickDocs, type AssistantSnapshot } from "../src/lib/assistant/core.ts";

const SNAPSHOT: AssistantSnapshot = {
  workspace: "Acme",
  funding: "trial allowance: 2 of 3 runs left",
  canRun: true,
  blockedReason: null,
  agents: [
    { id: "agent-1", name: "Support bot", host: "bot.acme.test", policyVersion: 2, lastProbe: "ok" },
    { id: "agent-2", name: "No policy yet", host: "x.acme.test", policyVersion: null, lastProbe: "never" },
  ],
  runs: [{ id: "run-1", agent: "Support bot", status: "completed", date: "2026-09-26 10:00", passed: 30, failed: 5, noResult: 1 }],
  reports: 1,
};
const DOCS = [
  { slug: "how-a-run-works", title: "How a run works", body: "A run names three things. Scenarios errored count separately." },
  { slug: "billing", title: "Billing", body: "Trial allowance and your own key." },
];

test("a link survives only if it is one of this workspace's own paths", () => {
  const reply = parseReply({
    reply: "Here you go.",
    actions: [
      { type: "navigate", href: "/runs/run-1", label: "Open the run" },
      { type: "navigate", href: "https://evil.test/login", label: "Sign in again" },
      { type: "navigate", href: "/runs/someone-elses-run", label: "Their run" },
      { type: "navigate", href: "/docs/how-a-run-works" },
    ],
  }, SNAPSHOT, DOCS)!;
  assert.deepEqual(reply.actions.map((a) => a.type === "navigate" && a.href), ["/runs/run-1", "/docs/how-a-run-works"]);
});

test("a run can be offered only for an own agent with a policy, only when a run can start, under our label", () => {
  const offered = parseReply({
    reply: "Run it.",
    actions: [
      { type: "start_run", agentId: "agent-1", label: "Free run, no cost!" },
      { type: "start_run", agentId: "agent-2" },
      { type: "start_run", agentId: "someone-elses-agent" },
    ],
  }, SNAPSHOT, DOCS)!;
  assert.deepEqual(offered.actions, [{ type: "start_run", agentId: "agent-1", label: "Run the suite on Support bot" }]);

  const blocked = parseReply(
    { reply: "Run it.", actions: [{ type: "start_run", agentId: "agent-1" }] },
    { ...SNAPSHOT, canRun: false },
    DOCS,
  )!;
  assert.deepEqual(blocked.actions, []);
});

test("an invented citation is dropped; an empty or missing reply is refused", () => {
  const reply = parseReply({ reply: "See the docs.", citations: ["how-a-run-works", "made-up-page"] }, SNAPSHOT, DOCS)!;
  assert.deepEqual(reply.citations, ["how-a-run-works"]);
  assert.equal(parseReply({ reply: "   " }, SNAPSHOT, DOCS), null);
  assert.equal(parseReply(null, SNAPSHOT, DOCS), null);
});

test("the pages sent are the ones the question is about", () => {
  assert.equal(pickDocs("why was my scenario errored in the run", DOCS, 1)[0].slug, "how-a-run-works");
  assert.equal(pickDocs("how does billing and the trial allowance work", DOCS, 1)[0].slug, "billing");
});

test("history is capped and the snapshot carries no secret-shaped field", () => {
  const long = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn ${i}` }));
  const messages = buildMessages({ snapshot: SNAPSHOT, docs: DOCS, allDocs: DOCS, history: long, message: "hi" });
  assert.equal(messages.length, 2 + 6 + 1);
  assert.doesNotMatch(messages[0].content, /key_ciphertext|api_key|sk-|policy_body/i);
});

test("markdown emphasis is removed from a plain-text reply, and nothing else is", () => {
  const reply = parseReply({ reply: "Your run on *Support bot* had **5** failures; see snake_case_id and 2*3." }, SNAPSHOT, DOCS)!;
  assert.equal(reply.reply, "Your run on Support bot had 5 failures; see snake_case_id and 2*3.");
});

test("key-shaped text is recognised before it can be sent to a model", async () => {
  const { looksLikeSecret } = await import("../src/lib/assistant/core.ts");
  for (const s of ["change it to sk-test-123abc", "gsk_ABCDEFGHIJ", "sk-or-v1-abcdef123", "AIzaSyA1234567890abcdef", "Bearer abcdefghijklmnop"]) {
    assert.ok(looksLikeSecret(s), s);
  }
  for (const s of ["What is a scenario?", "My run on skeleton-bot failed", "desk-top agent"]) {
    assert.ok(!looksLikeSecret(s), s);
  }
});

test("the assistant can point at the Suite Builder and can do nothing there", () => {
  const reply = parseReply({
    reply: "Open the builder to decide.",
    actions: [
      { type: "navigate", href: "/builder", label: "Suite Builder" },
      { type: "approve", draftId: "d-1", label: "Approve it for you" },
      { type: "publish", buildId: "b-1" },
      { type: "answer_question", obligationId: "o-1", answer: "yes" },
      { type: "navigate", href: "/builder/b-someone-else", label: "Their build" },
    ],
  }, SNAPSHOT, DOCS)!;
  assert.deepEqual(reply.actions, [{ type: "navigate", href: "/builder", label: "Suite Builder" }]);
});

test("a question and its answer are stored as rows with the same columns (PostgREST fills a missing one with NULL)", async () => {
  const { messageRows } = await import("../src/lib/assistant/rows.ts");
  const [q, a] = messageRows("t", "What failed?", { reply: "Two scenarios.", citations: ["how-a-run-works"], fundedBy: "the Novera trial allowance", model: "m" });
  assert.deepEqual(Object.keys(q).sort(), Object.keys(a).sort());
  assert.deepEqual(q.citations, [], "citations is NOT NULL: the question row carries an empty list");
  assert.equal(q.role, "user"); assert.equal(a.role, "assistant");
});
