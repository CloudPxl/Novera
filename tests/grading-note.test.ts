import { test } from "node:test";
import assert from "node:assert/strict";
import { gradingNote } from "../src/app/(app)/runs/[id]/grading-note.ts";

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
