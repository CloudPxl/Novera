import { test } from "node:test";
import assert from "node:assert/strict";
import { engineLine, gradingNote } from "../src/app/(app)/runs/[id]/grading-note.ts";

const vote = (model: string, status: "pass" | "fail" | "error" = "pass") => ({ model, status });

test("a cross-vendor confirmation names the vendor that confirmed it", () => {
  const note = gradingNote("groq/openai/gpt-oss-120b", "agreed", [
    vote("groq/openai/gpt-oss-120b"),
    vote("mistral/ministral-3b-latest"),
  ]);
  assert.match(note, /confirmed by a second model from mistral/);
});

test("a same-vendor confirmation says so instead of claiming a second opinion", () => {
  const note = gradingNote("groq/openai/gpt-oss-120b", "agreed", [
    vote("groq/openai/gpt-oss-120b"),
    vote("groq/openai/gpt-oss-20b"),
  ]);
  assert.match(note, /no other vendor was reachable/);
});

test("a row stored before votes were recorded claims nothing either way", () => {
  const note = gradingNote("google/gemini-3.5-flash", "agreed");
  assert.equal(note, "graded by google/gemini-3.5-flash, confirmed by a second model");
});

test("an unresolved verdict is still not a verdict", () => {
  assert.match(gradingNote("groq/a", "unresolved", [vote("groq/a"), vote("mistral/b", "fail")]), /no verdict/);
});

test("the run's verdict line says how many corroborations stayed within one vendor", () => {
  const base = { agreed: 0, sameVendor: 0, settled: 0, unconfirmed: 0, unresolved: 0, rules: 0, readBack: 0 };
  assert.equal(engineLine({ ...base, agreed: 6 }, null), "6 of 6 verdicts were confirmed by a second model.");
  assert.equal(
    engineLine({ ...base, agreed: 30, sameVendor: 28, settled: 2, unconfirmed: 1 }, null),
    "30 of 33 verdicts were confirmed by a second model (28 by two models from one vendor), 2 needed a third to settle a disagreement, 1 could not be corroborated.",
  );
  assert.equal(engineLine({ ...base, agreed: 4, sameVendor: 4 }, null), "4 of 4 verdicts were confirmed by a second model (all by two models from one vendor).");
  assert.equal(engineLine(base, null), "No verdict was recorded.");
});

test("a verdict settled by a rule or a read-back is a verdict, and the line says how it was reached", () => {
  const base = { agreed: 0, sameVendor: 0, settled: 0, unconfirmed: 0, unresolved: 0, rules: 0, readBack: 0 };
  assert.equal(engineLine({ ...base, rules: 2 }, null), "2 verdicts were settled without a model, by the scenario's own rules.");
  assert.equal(engineLine({ ...base, readBack: 1 }, null), "1 verdict was settled without a model, by reading back the customer's system.");
  assert.equal(
    engineLine({ ...base, agreed: 5, unconfirmed: 1, rules: 3, readBack: 1 }, null),
    "5 of 6 model verdicts were confirmed by a second model, 1 could not be corroborated, and 4 more were settled without a model, 3 by the scenario's own rules and 1 by reading back the customer's system.",
  );
});
