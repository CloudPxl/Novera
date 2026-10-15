import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EXPLAIN_KEYS, GLOSSARY } from "../src/lib/explainability/glossary.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

/**
 * The glossary behind the "?" markers. A marker that explains a term wrongly is worse than no
 * marker, so the text is held to the same rules as the rest of what a customer can read.
 */

/** Sentences, by the one rule a plain-English entry needs: a full stop, "?" or "!" then a capital. */
function sentences(text: string): string[] {
  return text.trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
}

test("every key is complete and says what it is in at most two sentences", () => {
  assert.ok(EXPLAIN_KEYS.length >= 23, "the roadmap's twenty-three concepts are all present");
  for (const key of EXPLAIN_KEYS) {
    const entry = GLOSSARY[key];
    assert.equal(entry.id, key, `${key}: the entry's id is its key`);
    for (const field of ["title", "whatItMeans", "whyItMatters", "nextAction"] as const) {
      assert.ok(entry[field].trim().length > 0, `${key}.${field} is empty`);
    }
    assert.ok(sentences(entry.whatItMeans).length <= 2, `${key}.whatItMeans is ${sentences(entry.whatItMeans).length} sentences: ${entry.whatItMeans}`);
    assert.ok(sentences(entry.whyItMatters).length <= 2, `${key}.whyItMatters runs past two sentences`);
    assert.ok(sentences(entry.nextAction).length <= 3, `${key}.nextAction runs past three sentences`);
  }
});

test("the concepts the product's screens rely on are all defined", () => {
  const required = [
    "grade_withheld", "grade_incomplete", "consensus_tiebreaker", "unresolved_disagreement", "one_grader_only",
    "readback_contradiction", "readback_unavailable", "agent_unreachable", "sha256_seal", "chained_report",
    "declared_manifest", "severity", "severity_tier", "suite_digest", "policy_version", "own_key", "coverage",
    "regression_delta", "test_data", "trial_allowance", "run_funding", "not_run", "withdrawn_report",
  ];
  for (const key of required) assert.ok(key in GLOSSARY, `missing glossary key ${key}`);
});

test("every docs link resolves to a published page in data/docs", () => {
  for (const key of EXPLAIN_KEYS) {
    const href = GLOSSARY[key].docsHref;
    if (!href) continue;
    const slug = /^\/docs\/([a-z0-9-]+)$/.exec(href)?.[1];
    assert.ok(slug, `${key}.docsHref is not /docs/<slug>: ${href}`);
    assert.ok(existsSync(join("data/docs", `${slug}.md`)), `${key}.docsHref points at a page that does not exist: ${href}`);
  }
});

/** Every `.ts` and `.tsx` file under src/. */
function sources(dir = "src"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The keys named by each `<ExplainTrigger … id="…" />`, or by string literals inside `id={…}`. */
function triggersIn(source: string): string[] {
  const named: string[] = [];
  for (const tag of source.matchAll(/<ExplainTrigger\b([\s\S]*?)\/>/g)) {
    const id = /\bid=(?:"([^"]+)"|\{([^}]*)\})/.exec(tag[1]);
    assert.ok(id, `an <ExplainTrigger> without an id: ${tag[0]}`);
    if (id[1]) named.push(id[1]);
    // A computed id names its keys as lower-case string literals; a comparison's operand (an
    // upper-case band, say) is not one. The type checker holds the rest to the ExplainKey union.
    else for (const literal of id[2].matchAll(/"([a-z][a-z0-9_]*)"/g)) named.push(literal[1]);
  }
  return named;
}

test("every ExplainTrigger in the app names a key the glossary defines", () => {
  const used = new Map<string, string[]>();
  for (const file of sources()) {
    for (const id of triggersIn(readFileSync(file, "utf8"))) used.set(id, [...(used.get(id) ?? []), file]);
  }
  assert.ok(used.size > 0, "no <ExplainTrigger> found anywhere: the grep is not looking in the right place");
  for (const [id, files] of used) {
    assert.ok(id in GLOSSARY, `<ExplainTrigger id="${id}"> in ${files.join(", ")} names a key that does not exist`);
  }
});

test("the glossary says only what can be evidenced", () => {
  const text = EXPLAIN_KEYS.flatMap((key) => {
    const e = GLOSSARY[key];
    return [e.title, e.whatItMeans, e.whyItMatters, e.nextAction].map((line) => `${key}: ${line}`);
  }).join("\n");
  assert.deepEqual(scanCustomerLanguage(text).map((f) => `${f.text} — ${f.why}`), []);
});

test("the markers are drawn from the design tokens, never a raw palette step", () => {
  const palette = /\b(?:bg|text|border|ring|fill|stroke|divide|from|to|via|outline|decoration|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(?:bg|text|border)-(?:white|black)\b|#[0-9a-fA-F]{3,8}\b/;
  for (const file of ["src/components/ui/explain-trigger.tsx", "src/components/ui/help.tsx"]) {
    const found = readFileSync(file, "utf8").split("\n").filter((line) => palette.test(line));
    assert.deepEqual(found, [], `${file} reaches for a raw colour: ${found.join(" | ")}`);
  }
});

test("a marker is hidden in print and names itself for assistive technology", () => {
  const source = readFileSync("src/components/ui/help.tsx", "utf8");
  assert.match(source, /print-hide/);
  assert.match(source, /What is this\? \$\{label\}/);
  assert.match(source, /Escape/);
});

test("the readiness checks the run page explains are still the ones readinessOf produces", () => {
  const readiness = readFileSync("src/lib/report/readiness.ts", "utf8");
  const panel = readFileSync("src/app/(app)/runs/[id]/readiness.tsx", "utf8");
  const labels = [...panel.matchAll(/^  "([^"]+)": "[a-z0-9_]+",$/gm)].map((m) => m[1]);
  assert.ok(labels.length >= 3);
  for (const label of labels) assert.ok(readiness.includes(`label: "${label}"`), `readiness.tsx explains a check that no longer exists: ${label}`);
});
