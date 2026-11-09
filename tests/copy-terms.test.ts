/**
 * The copy check (`npm run lint:copy`): words a reader would take as a claim Novera does not
 * make, or as a dead end with nothing to do. Scans what people read — pages, components,
 * user-facing library strings and the published docs — and skips code comments, the scripted
 * test agent (its planted failures say exactly these things on purpose) and the filters that
 * exist to refuse these words. docs/TERMINOLOGY.md is the canonical vocabulary.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app", "src/components", "src/lib", "data/docs", "docs/setup/email-templates"];
const SKIP = [
  /^src\/app\/api\/test-agent\//, // the scripted fixture: planted failures
  /^src\/lib\/fixture\//, // the same, per suite
  /^src\/lib\/seo\/og\.ts$/, // the filter that refuses these words on share images
  /^src\/lib\/assistant\/memory\.ts$/, // refusal patterns
];

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bwho (graded|decided it|judged (the|each|it)|reviewed (it|the))\b/i, "graders are AI models: say which AI graders"],
  [/\bsomething went wrong\b/i, "say what failed and whose side it is on"],
  [/\btry again later\b/i, "say when, or what to do instead"],
  [/\b(an )?unknown error( occurred)?\b/i, "name the failure, or say it was not classified"],
  [/\ban error (has )?occurred\b/i, "say what failed"],
  [/\bcheck your settings\b/i, "name the setting"],
  [/\bguarantee[sd]? (?:(?:eu|gdpr|ai act|full|your) )*(compliance|conformity|safety)\b/i, "Novera is testing evidence, not a guarantee"],
  [/\b(certified|fully) compliant\b|\bcompliance certificate\b|\bcertificate of compliance\b/i, "never a certification"],
  [/\bguaranteed safe\b|\bproof of (absolute )?safety\b/i, "a seal proves integrity, not safety"],
  [/\b(our|a) human (reviewer|auditor|expert)s? (graded|reviewed|checked|audited)\b/i, "no person grades a verdict"],
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(tsx?|md|html)$/.test(name)) out.push(path);
  }
  return out;
}

/** The text a reader can see: comment lines and comment blocks removed. */
function readable(path: string, text: string): string[] {
  if (path.endsWith(".md") || path.endsWith(".html")) return text.split("\n");
  let inBlock = false;
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (inBlock) { if (t.includes("*/")) inBlock = false; return ""; }
    if (t.startsWith("/*") || t.startsWith("{/*")) { if (!t.includes("*/")) inBlock = true; return ""; }
    if (t.startsWith("//") || t.startsWith("*")) return "";
    return line;
  });
}

test("no page, component, message or doc uses a forbidden phrase", () => {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const path of files(root)) {
      if (SKIP.some((s) => s.test(path))) continue;
      readable(path, readFileSync(path, "utf8")).forEach((line, i) => {
        for (const [re, why] of FORBIDDEN) if (re.test(line)) hits.push(`${path}:${i + 1} — ${why}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
  assert.deepEqual(hits, [], `\n${hits.join("\n")}`);
});

test("the check itself catches each phrase it names, and ignores comments", () => {
  for (const sample of ["You will see who graded them.", "Something went wrong.", "Please try again later.", "An unknown error occurred.",
    "Guarantees EU AI Act compliance", "a compliance certificate", "guaranteed safe", "our human reviewers checked"]) {
    assert.ok(FORBIDDEN.some(([re]) => re.test(sample)), sample);
  }
  assert.deepEqual(readable("x.ts", "// Something went wrong\nconst a = 1;").filter(Boolean), ["const a = 1;"]);
  for (const fine of ["which AI graders decided it", "Novera is not a certification", "The agent did not answer within 30 s."]) {
    assert.ok(!FORBIDDEN.some(([re]) => re.test(fine)), fine);
  }
});
