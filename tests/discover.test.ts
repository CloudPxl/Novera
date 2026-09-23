import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverShape, describeShape, suggestPathHint } from "../src/lib/agents/discover.ts";

/**
 * Where an integration dies.
 *
 * The operator is asked for a dot path into a response they have never looked at. If
 * the first guess is wrong and the product says only "not found", they are exactly
 * where they started — before having seen Novera do anything.
 */

test("the conventional shapes are recognised", () => {
  const cases: Array<[unknown, string]> = [
    [{ reply: "Thanks for getting in touch, I can help with that." }, "reply"],
    [{ data: { output: "Thanks for getting in touch, I can help with that." } }, "data.output"],
    [
      { choices: [{ index: 0, message: { role: "assistant", content: "Here is the answer you asked for." } }] },
      "choices.0.message.content",
    ],
    [{ result: { text: "Here is the answer you asked for, in full." } }, "result.text"],
    [{ message: "Here is the answer you asked for, in full detail." }, "message"],
  ];

  for (const [body, expected] of cases) {
    assert.equal(discoverShape(body).replyPaths[0], expected, JSON.stringify(body).slice(0, 60));
  }
});

test("an id, a model name or a token is never mistaken for the reply", () => {
  const body = {
    id: "chatcmpl-9f2a41b7c8d94e1fa0b6",
    model: "some-model-v2",
    created: "2026-09-23T10:00:00Z",
    reply: "Short one.",
  };
  assert.equal(discoverShape(body).replyPaths[0], "reply");
});

test("the longest string does not win on length alone", () => {
  // A trace or a raw prompt echo is often longer than the reply. Key names carry more
  // signal than size, which is why size is a tiebreak and not the ranking.
  const body = {
    debug_trace: "x".repeat(4000),
    reply: "I have cancelled the subscription and sent you a confirmation.",
  };
  assert.equal(discoverShape(body).replyPaths[0], "reply");
});

test("tool activity is found, including when the agent took no action", () => {
  assert.equal(
    discoverShape({ reply: "done", tool_calls: [{ tool: "issue_refund", arguments: {} }] }).toolPaths[0],
    "tool_calls",
  );
  // An empty list at a conventional name is still the right path: this scenario had
  // no action, another will.
  assert.equal(discoverShape({ reply: "done", tool_calls: [] }).toolPaths[0], "tool_calls");
  // An array of strings is not tool activity.
  assert.deepEqual(discoverShape({ reply: "done", tags: ["a", "b"] }).toolPaths, []);
});

test("an unconventional key is still suggested when it is the only prose in the response", () => {
  // No key name to recognise, but there is exactly one piece of text and it reads like
  // an answer. Refusing to guess here would be pedantry: the operator is staring at a
  // response with one string in it.
  const body = { payload: { agent_says: "We cannot action that without verification." } };
  const found = discoverShape(body);
  assert.deepEqual(found.paths.map((p) => p.path), ["payload.agent_says"]);
  assert.equal(found.replyPaths[0], "payload.agent_says");
  assert.match(suggestPathHint(body), /looks like it is at "payload\.agent_says"/);
});

test("a response with only short identifier-shaped values suggests nothing", () => {
  // Better to say "there may be nothing to read here" than to point at a status code
  // and let someone wire a suite to it.
  const found = discoverShape({ status: "ok", request_id: "a1b2c3d4e5f60718" });
  assert.deepEqual(found.replyPaths, []);
});

test("the hint names the best guess, and says when there is nothing to guess from", () => {
  assert.match(suggestPathHint({ data: { reply: "Hello there, how can I help?" } }), /looks like it is at "data\.reply"/);
  assert.match(suggestPathHint({ ok: true, count: 3 }), /carried no text at all/);
});

test("a huge response cannot flood the shape, and a preview says what it truncated", () => {
  const body = { items: Array.from({ length: 200 }, (_, i) => ({ note: `entry ${i} `.repeat(40) })) };
  const paths = describeShape(body);
  assert.ok(paths.length <= 60, `capped, got ${paths.length}`);
  // Only the first few array entries are walked: the operator needs the shape, not
  // the contents, and this is a payload we are about to store.
  assert.ok(paths.length <= 3);
  assert.ok(paths[0].preview.endsWith("…"));
  assert.ok(paths[0].length > paths[0].preview.length);
});

test("blank strings are not offered as candidates", () => {
  assert.deepEqual(discoverShape({ reply: "   ", text: "" }).paths, []);
});
