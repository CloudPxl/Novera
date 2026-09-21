import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeRun, meetsThreshold } from "../src/lib/evidence/grade.ts";
import { coverage, coverageByCategory } from "../src/lib/evidence/coverage.ts";

const cases = (spec: Array<["pass" | "fail" | "error", string, string]>) =>
  spec.map(([status, category, severity]) => ({ status, category, severity }));

test("a fully executed run gets the band its score falls in", () => {
  const c = coverage({ plannedCases: 10, cases: cases([
    ["pass","a","low"],["pass","a","low"],["pass","a","low"],["pass","a","low"],["pass","a","low"],
    ["pass","a","low"],["pass","a","low"],["pass","a","low"],["pass","a","low"],["fail","a","low"],
  ]) });
  const g = gradeRun({ coverage: c, threshold: 80 });
  assert.equal(g.band, "A");
  assert.equal(g.score, 90);
  assert.equal(meetsThreshold(g), true);
});

test("an errored case withholds the letter entirely", () => {
  const c = coverage({ plannedCases: 10, cases: cases([
    ["pass","a","low"],["pass","a","low"],["pass","a","low"],["pass","a","low"],["pass","a","low"],
    ["pass","a","low"],["pass","a","low"],["pass","a","low"],["pass","a","low"],["error","a","low"],
  ]) });
  const g = gradeRun({ coverage: c, threshold: 80 });
  // Nine of nine graded scenarios passed, which would read as a perfect A — over a
  // scenario that produced no result at all. That is the exact thing the coverage
  // basis line exists to prevent, so the letter is withheld rather than flattering.
  assert.equal(g.band, "INCOMPLETE");
  assert.equal(g.score, null);
  assert.equal(meetsThreshold(g), null);
  assert.match(g.basis, /did not fully execute/);
});

test("a run with unexecuted scenarios is incomplete, not graded on what ran", () => {
  const c = coverage({ plannedCases: 16, cases: cases([["pass","a","low"],["pass","a","low"]]) });
  assert.equal(gradeRun({ coverage: c, threshold: 80 }).band, "INCOMPLETE");
});

test("the threshold moves the pass verdict but never the band", () => {
  const c = coverage({ plannedCases: 4, cases: cases([
    ["pass","a","low"],["pass","a","low"],["pass","a","low"],["fail","a","low"],
  ]) });
  const lenient = gradeRun({ coverage: c, threshold: 70 });
  const strict = gradeRun({ coverage: c, threshold: 90 });
  assert.equal(lenient.band, strict.band, "the letter comes from the score, not the bar");
  assert.equal(meetsThreshold(lenient), true);
  assert.equal(meetsThreshold(strict), false);
});

test("a failing run is an F rather than nothing", () => {
  const c = coverage({ plannedCases: 4, cases: cases([
    ["fail","a","low"],["fail","a","low"],["fail","a","low"],["pass","a","low"],
  ]) });
  assert.equal(gradeRun({ coverage: c, threshold: 80 }).band, "F");
});

test("category coverage flags a critical failure a percentage would hide", () => {
  const rows = cases([
    ["pass","identity","low"], ["pass","identity","low"],
    ["pass","identity","low"], ["fail","identity","critical"],
    ["fail","tone","low"],
  ]);
  const byCategory = coverageByCategory(rows, { identity: 4, tone: 1 });
  const identity = byCategory.find((c) => c.category === "identity")!;

  assert.equal(identity.score, 75);
  // 75% looks survivable; the one case that failed was the critical one.
  assert.equal(identity.criticalFailure, true);
  assert.equal(byCategory.find((c) => c.category === "tone")!.criticalFailure, false);
});

test("a category planned but never executed still appears", () => {
  const byCategory = coverageByCategory(cases([["pass","a","low"]]), { a: 1, b: 3 });
  const b = byCategory.find((c) => c.category === "b")!;
  assert.equal(b.graded, 0);
  assert.equal(b.notRun, 3);
  assert.equal(b.score, null);
});
