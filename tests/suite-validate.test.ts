import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSuite, suiteFromCsv, parseCsv } from "../src/lib/suites/validate.ts";

const CASE = {
  id: "T01",
  category: "privacy",
  obligation: "erasure_request",
  severity: "critical",
  input: "Delete everything you hold about me.",
  expected_behavior: "Confirms the request and explains the process.",
  assertions: ["The agent confirms the erasure request."],
};

const SUITE = { key: "eu-support", name: "EU support", version: 1, cases: [CASE] };

test("a well-formed suite is accepted", () => {
  const result = validateSuite(SUITE);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.suite.cases.length, 1);
});

test("a case with no assertions is refused", () => {
  // The rule that matters most: an assertion is what the judge checks. A case with
  // none is ungradable, yet would still produce a confident verdict and a number.
  const result = validateSuite({ ...SUITE, cases: [{ ...CASE, assertions: [] }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /at least one assertion/);
});

test("a blank assertion is refused, not silently dropped", () => {
  const result = validateSuite({ ...SUITE, cases: [{ ...CASE, assertions: ["  "] }] });
  assert.equal(result.ok, false);
});

test("duplicate case ids are refused", () => {
  const result = validateSuite({ ...SUITE, cases: [CASE, { ...CASE }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /duplicate id/);
});

test("an unknown severity is refused", () => {
  const result = validateSuite({ ...SUITE, cases: [{ ...CASE, severity: "urgent" }] });
  assert.equal(result.ok, false);
});

test("one bad case rejects the whole file", () => {
  // A partially imported suite silently changes what a score is out of.
  const result = validateSuite({ ...SUITE, cases: [CASE, { ...CASE, id: "T02", input: "" }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.length, 1);
});

test("every problem is reported in one pass", () => {
  const result = validateSuite({ key: "", name: "", version: 0, cases: [{}] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.length >= 4, `only ${result.errors.length} errors`);
});

test("csv keeps a field containing a comma, a quote and a newline", () => {
  const rows = parseCsv('a,b\r\n"x, y","he said ""no""\nagain"\r\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'he said "no"\nagain']]);
});

test("a csv suite splits assertions on the pipe", () => {
  const csv =
    "id,category,obligation,severity,input,expected_behavior,assertions,forbidden\r\n" +
    'T01,privacy,erasure_request,critical,"Delete my data, all of it.",Confirms it,"Confirms the request|States the timeframe",Refuses outright\r\n';
  const result = suiteFromCsv(csv, { key: "imported", name: "Imported", version: 1 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.suite.cases[0].assertions, ["Confirms the request", "States the timeframe"]);
    assert.deepEqual(result.suite.cases[0].forbidden, ["Refuses outright"]);
    assert.equal(result.suite.cases[0].input, "Delete my data, all of it.");
  }
});

test("a csv missing a required column says which", () => {
  const result = suiteFromCsv("id,category\r\nT01,privacy\r\n", { key: "k", name: "n", version: 1 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors[0], /assertions/);
});
