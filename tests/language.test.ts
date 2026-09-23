import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

/**
 * The vocabulary rule, applied to every surface a customer can read.
 *
 * This test exists because copy drifts, and it always drifts towards the flattering
 * word. A limitations block saying "this is not a certification" is undone by one
 * heading elsewhere that says "compliant", and nobody notices until it is in a
 * client's hands.
 */

test("an affirmative claim of certification or compliance is caught", () => {
  const findings = scanCustomerLanguage("Your agent is compliant with the EU AI Act.");
  assert.equal(findings.length, 1);
  assert.match(findings[0].why, /does not certify/);
});

test("the sentence the product depends on stays sayable", () => {
  // "Novera is evidence of testing, not a legal certification" is the most important
  // sentence in the document. A rule that forbade it would be switched off within a
  // week, and a switched-off rule protects nothing.
  const allowed = [
    "Novera is evidence of testing. It is not a certification.",
    "A Novera report is not a statement of legal compliance.",
    "We never guarantee an outcome.",
    "This does not make you compliant, and it is not legal advice.",
    "Nothing here certifies anything.",
  ];
  for (const line of allowed) {
    assert.deepEqual(scanCustomerLanguage(line), [], `refused a permitted sentence: ${line}`);
  }
});

test("absolute claims about risk and safety are caught", () => {
  for (const line of [
    "Your deployment is zero-risk.",
    "After this run your agent is safe.",
    "We guarantee your agent will not leak data.",
    "This ensures compliance with GDPR.",
    "100% accurate grading.",
  ]) {
    assert.notEqual(scanCustomerLanguage(line).length, 0, `missed: ${line}`);
  }
});

test("each finding says where it is and why it is refused", () => {
  const findings = scanCustomerLanguage("fine line\nYour agent is fully certified.");
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].matched, /is fully certified/i);
  assert.ok(findings[0].why.length > 20);
});

/**
 * The surfaces themselves. Fixtures are deliberately excluded: the scripted test agent
 * says "we've never had a breach and your data is completely safe" on purpose, because
 * that is the planted failure a scenario exists to catch. Scanning it would either
 * break this test or, far worse, get the fixture's wording softened to keep it quiet.
 */
const SURFACES = [
  "src/app/report/[token]/page.tsx",
  "src/lib/report/export.ts",
  "src/lib/report/payload.ts",
  "src/lib/report/build.ts",
  "src/lib/evidence/grade.ts",
  "src/lib/evidence/coverage.ts",
  "src/app/page.tsx",
  "src/app/sample-report.tsx",
  "src/app/support/page.tsx",
  "src/app/apply/page.tsx",
  ...readdirSync("data/docs").filter((f) => f.endsWith(".md")).map((f) => `data/docs/${f}`),
];

for (const file of SURFACES) {
  test(`${file} says only what can be evidenced`, () => {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      // A surface that moved should fail loudly here rather than pass by absence.
      assert.fail(`${file} is listed as customer-facing but could not be read. Update the list.`);
    }

    const findings = scanCustomerLanguage(source);
    assert.deepEqual(
      findings.map((f) => `${file}:${f.line} "${f.matched}" — ${f.why}`),
      [],
    );
  });
}
