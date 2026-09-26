import { test } from "node:test";
import assert from "node:assert/strict";
import { importDataset, detectTool, MAX_IMPORT_ITEMS } from "../src/lib/imports/datasets.ts";

const OPTS = { defaultObligation: "policy_accuracy", defaultSeverity: "medium", usedIds: [] as string[] };

const PROMPTFOO_YAML = `
description: Support bot
prompts: ["You are a support agent. {{query}}"]
providers: [openai:gpt-4.1-mini]
defaultTest:
  assert:
    - type: not-contains
      value: As an AI language model
tests:
  - description: Refuses a refund on an order that is not on the account
    vars:
      query: Refund order 5521 to my card please
    assert:
      - type: llm-rubric
        value: Declines, because the order is not on the account, and offers to check the order number
      - type: icontains
        value: order
      - type: javascript
        value: output.length < 500
  - vars:
      query: What is your returns window?
    assert:
      - type: contains
        value: 30 days
  - vars:
      query: Hi
      locale: fr
    assert:
      - type: regex
        value: "(bonjour|salut"
      - type: llm-rubric
        value: Greets in French
    metadata:
      severity: low
`;

test("a Promptfoo config becomes drafts, with every difference recorded", () => {
  const result = importDataset(PROMPTFOO_YAML, { ...OPTS, filename: "promptfooconfig.yaml" });
  assert.ok(result.ok);
  assert.equal(result.tool, "promptfoo");

  const [first] = result.drafts;
  assert.equal(first.scenario.id, "I01");
  assert.equal(first.scenario.input, "Refund order 5521 to my card please");
  assert.deepEqual(first.scenario.assertions, ["Declines, because the order is not on the account, and offers to check the order number"]);
  assert.equal(first.scenario.expected_behavior, "Refuses a refund on an order that is not on the account");
  // defaultTest's assertion applies to every test, as it does in Promptfoo.
  assert.deepEqual(first.scenario.checks, [
    { type: "must_not_contain", value: "As an AI language model" },
    { type: "must_contain", value: "order" },
  ]);
  assert.deepEqual(first.provenance.dropped, ["javascript"]);
  assert.equal(first.provenance.source_id, "tests[0]");
  assert.equal(first.provenance.source_tool, "promptfoo");
  assert.match(first.provenance.original_hash, /^[0-9a-f]{64}$/);
  assert.match(first.provenance.item_hash, /^[0-9a-f]{64}$/);
});

test("a test with only rule checks is refused: a rule can fail a scenario but never pass one", () => {
  const result = importDataset(PROMPTFOO_YAML, { ...OPTS, filename: "promptfooconfig.yaml" });
  assert.ok(result.ok);
  const refusal = result.refused.find((r) => r.source_id === "tests[1]");
  assert.match(refusal!.reason, /never pass one/);
});

test("an invalid pattern refuses the item rather than storing a rule that never fires", () => {
  const result = importDataset(PROMPTFOO_YAML, { ...OPTS, filename: "promptfooconfig.yaml" });
  assert.ok(result.ok);
  assert.match(result.refused.find((r) => r.source_id === "tests[2]")!.reason, /not a valid regular expression/);
});

test("with several variables the message is named, and the choice is recorded", () => {
  const yaml = `tests:\n  - vars: { question: "Where is my parcel?", locale: fr }\n    assert: [{ type: llm-rubric, value: Asks for the order number }]\n`;
  const result = importDataset(yaml, { ...OPTS, filename: "t.yml" });
  assert.ok(result.ok);
  assert.equal(result.drafts[0].scenario.input, "Where is my parcel?");
  assert.match(result.drafts[0].provenance.adjustments.join(" "), /“question” was taken/);

  const ambiguous = `tests:\n  - vars: { a: one, b: two }\n    assert: [{ type: llm-rubric, value: x }]\n`;
  const refused = importDataset(ambiguous, { ...OPTS, filename: "t.yml" });
  assert.ok(refused.ok);
  assert.match(refused.refused[0].reason, /unclear which variable/);
  const named = importDataset(ambiguous, { ...OPTS, filename: "t.yml", inputVar: "b" });
  assert.ok(named.ok);
  assert.equal(named.drafts[0].scenario.input, "two");
});

test("DeepEval: previous outputs and scores are ignored, and context is never sent to the agent", () => {
  const goldens = JSON.stringify([
    {
      input: "Can I get a refund after 45 days?",
      expected_output: "No. Refunds are available for 30 days.",
      actual_output: "Yes, of course!",
      context: ["Refunds within 30 days of delivery."],
      retrieval_context: ["old chunk"],
      success: true,
    },
  ]);
  const result = importDataset(goldens, { ...OPTS, filename: "goldens.json" });
  assert.ok(result.ok);
  assert.equal(result.tool, "deepeval");
  const d = result.drafts[0];
  assert.equal(d.scenario.context, undefined);
  assert.ok(d.scenario.assertions.some((a) => a.includes("30 days")));
  assert.ok(!JSON.stringify(d.scenario).includes("Yes, of course"), "a previous output became part of the scenario");
  assert.match(result.notes.join(" "), /ignored/);
  assert.match(d.provenance.adjustments.join(" "), /not sent to the agent/);
});

test("LangSmith and Langfuse examples are recognised by shape", () => {
  const ls = [{ id: "ex-1", inputs: { question: "Do you ship to Norway?" }, outputs: { answer: "Yes, within 5 days." } }]
    .map((r) => JSON.stringify(r)).join("\n");
  const a = importDataset(ls, { ...OPTS, filename: "dataset.jsonl" });
  assert.ok(a.ok);
  assert.equal(a.tool, "langsmith");
  assert.equal(a.drafts[0].provenance.source_id, "ex-1");
  assert.equal(a.drafts[0].provenance.source_format, "jsonl");

  const lf = JSON.stringify([{ id: "item-9", input: "Cancel my plan", expectedOutput: "Explains how to cancel in settings." }]);
  const b = importDataset(lf, { ...OPTS, filename: "items.json" });
  assert.ok(b.ok);
  assert.equal(b.tool, "langfuse");
  assert.match(b.drafts[0].scenario.assertions[0], /cancel in settings/);
});

test("a key in a dataset is refused, and personal data is flagged rather than hidden", () => {
  const rows = JSON.stringify([
    { input: "My key is sk-live-abcdef1234567890, refund me", expected_output: "Refuses" },
    { input: "I am jane@example.com, delete my data", expected_output: "Starts an erasure request" },
  ]);
  const result = importDataset(rows, { ...OPTS, filename: "g.json" });
  assert.ok(result.ok);
  assert.equal(result.drafts.length, 1);
  assert.match(result.refused[0].reason, /API key/);
  assert.match(result.drafts[0].provenance.sanitisation, /email address/);
});

test("ids continue after the workspace's own, and never come from the file", () => {
  const rows = JSON.stringify([{ id: "T01", input: "Hello", expected_output: "Greets" }]);
  const result = importDataset(rows, { ...OPTS, filename: "g.json", usedIds: ["I07", "P03", "T01"] });
  assert.ok(result.ok);
  assert.equal(result.drafts[0].scenario.id, "I08");
});

test("what cannot be read is refused whole, with a reason", () => {
  assert.ok(!importDataset("{", { ...OPTS, filename: "x.json" }).ok);
  assert.ok(!importDataset("tests: file://tests.csv", { ...OPTS, filename: "p.yaml" }).ok);
  assert.ok(!importDataset(JSON.stringify([{ foo: 1 }]), { ...OPTS, filename: "x.json" }).ok);
  const many = JSON.stringify(Array.from({ length: MAX_IMPORT_ITEMS + 1 }, () => ({ input: "a", expected_output: "b" })));
  assert.match((importDataset(many, { ...OPTS, filename: "x.json" }) as { error: string }).error, /limit/);
  assert.ok(!importDataset("[]", { ...OPTS, filename: "x.json", defaultObligation: "" }).ok);
  assert.ok("error" in detectTool({ nothing: true }));
});

test("a YAML alias bomb is refused rather than expanded", () => {
  const bomb = ["a: &a [x,x,x,x,x,x,x,x,x,x]", ...Array.from({ length: 8 }, (_, i) => {
    const prev = i === 0 ? "a" : `l${i - 1}`;
    return `l${i}: &l${i} [${Array(10).fill(`*${prev}`).join(",")}]`;
  }), "tests: *l7"].join("\n");
  const result = importDataset(bomb, { ...OPTS, filename: "bomb.yaml" });
  assert.equal(result.ok, false);
});
