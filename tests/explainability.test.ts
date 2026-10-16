import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EXPLAIN_KEYS, GLOSSARY } from "../src/lib/explainability/glossary.ts";
import { CLIENT_EXPLAINS, explainEntries } from "../src/lib/explainability/entries.ts";
import { AI_ACT_FRAMINGS, aiActFramingFor } from "../src/lib/legal/ai-act-framing.ts";
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
  for (const tag of source.matchAll(/<(?:ExplainTrigger|Explained)\b([\s\S]*?)\/>/g)) {
    const id = /\bid=(?:"([^"]+)"|\{([^}]*)\})/.exec(tag[1]);
    assert.ok(id, `an <ExplainTrigger>/<Explained> without an id: ${tag[0]}`);
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
  for (const file of ["src/components/ui/explain-card.tsx", "src/components/ui/explain-trigger.tsx", "src/components/ui/explain-context.tsx", "src/components/ui/help.tsx"]) {
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

// ---------------------------------------------------------------- the glossary stays off the client

/**
 * Client files that still import the server-side `ExplainTrigger`, and so carry the glossary. Each is
 * a file another module owns, named here so the list can only shrink; the fix is one line: render
 * `<Explained id=… />` inside an `<ExplainProvider>` its server parent fills with `explainEntries`.
 */
const CLIENT_GLOSSARY_EXCEPTIONS = new Set<string>([]);

const isClientFile = (source: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(source);

test("no client component imports the glossary, its trigger or the entries helper", () => {
  const offenders: string[] = [];
  let clientFiles = 0;
  for (const file of sources()) {
    const source = readFileSync(file, "utf8");
    if (!isClientFile(source)) continue;
    clientFiles += 1;
    // `import type` is erased at build, so a client file may name the key type.
    const imports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    const bad = imports.filter((spec) => /explainability\/(?:glossary|entries)\.ts$|explain-trigger\.tsx$/.test(spec));
    if (bad.length && !CLIENT_GLOSSARY_EXCEPTIONS.has(file.split("\\").join("/"))) offenders.push(`${file} imports ${bad.join(", ")}`);
  }
  assert.ok(clientFiles > 10, "the scan found almost no client components: it is not looking in the right place");
  assert.deepEqual(offenders, []);
  for (const file of CLIENT_GLOSSARY_EXCEPTIONS) {
    assert.ok(existsSync(file) && /explain-trigger\.tsx/.test(readFileSync(file, "utf8")), `${file} no longer needs its exception: remove it from the list`);
  }
});

test("a server-side glossary import never lands in a file the browser also loads", () => {
  // The glossary itself must not be a client module either.
  assert.ok(!isClientFile(readFileSync("src/lib/explainability/glossary.ts", "utf8")));
  assert.ok(!isClientFile(readFileSync("src/components/ui/explain-trigger.tsx", "utf8")));
  assert.ok(!/glossary\.ts"/.test(readFileSync("src/components/ui/explain-card.tsx", "utf8").replace(/import type [^\n]*\n/g, "")));
  assert.ok(!/glossary\.ts"/.test(readFileSync("src/components/ui/explain-context.tsx", "utf8").replace(/import type [^\n]*\n/g, "")));
});

/** A glossary key that is also an unrelated string in a file (a severity word in the sample report's data). */
const HOMONYMS: Partial<Record<keyof typeof CLIENT_EXPLAINS, string[]>> = { sampleReport: ["severity"] };

test("each client component lists every glossary key it can render, and its page resolves that list", () => {
  const files: Record<keyof typeof CLIENT_EXPLAINS, string> = {
    sampleReport: "src/app/sample-report.tsx",
    sealInspector: "src/components/ui/seal-inspector.tsx",
    readiness: "src/app/(app)/runs/[id]/readiness.tsx",
    caseTable: "src/app/(app)/runs/[id]/case-table.tsx",
    fileCheck: "src/app/verify/file-check.tsx",
    receiptDetails: "src/app/verify/receipt-details.tsx",
  };
  // Rendered by a server page and inside a client component, so it is not itself a client file.
  const shared = new Set(["receiptDetails"]);
  for (const [name, file] of Object.entries(files) as Array<[keyof typeof CLIENT_EXPLAINS, string]>) {
    const source = readFileSync(file, "utf8");
    if (!shared.has(name)) assert.ok(isClientFile(source), `${file} is expected to be a client component`);
    const listed = new Set<string>(CLIENT_EXPLAINS[name]);
    // Any glossary key written as a string literal in the file, whichever way it reaches <Explained>.
    const mentioned = EXPLAIN_KEYS.filter((k) => new RegExp(`"${k}"`).test(source) && !HOMONYMS[name]?.includes(k));
    assert.ok(mentioned.length > 0, `${file} renders no marker: remove it from CLIENT_EXPLAINS`);
    for (const key of mentioned) assert.ok(listed.has(key), `${file} can render "${key}" but CLIENT_EXPLAINS.${name} does not resolve it`);
    for (const key of listed) assert.ok((mentioned as string[]).includes(key), `CLIENT_EXPLAINS.${name} resolves "${key}", which ${file} never uses`);
    const resolved = explainEntries(CLIENT_EXPLAINS[name]);
    assert.deepEqual(Object.keys(resolved).sort(), [...listed].sort());
  }
});

test("a resolved entry crosses to the client as its strings alone", () => {
  const resolved = explainEntries(["sha256_seal"]);
  assert.deepEqual(Object.keys(resolved.sha256_seal ?? {}).sort(), ["docsHref", "id", "nextAction", "title", "whatItMeans", "whyItMatters"].filter((k) => k in (resolved.sha256_seal ?? {})).sort());
  assert.equal(JSON.stringify(resolved).includes("ai_act_references"), false, "only the asked-for entries are passed");
});

// ---------------------------------------------------------------- AI Act references

test("the AI Act entry frames Article 50 as transparency and 12-15 as high-risk benchmarks, not duties", () => {
  const e = GLOSSARY.ai_act_references;
  const text = `${e.whatItMeans} ${e.whyItMatters} ${e.nextAction}`;
  assert.match(text, /Article 50/);
  assert.match(text, /interact directly with people/);
  assert.match(text, /high-risk/);
  assert.match(text, /engineering benchmarks/);
  assert.match(text, /not as duties the operator necessarily has/);
  assert.match(text, /legal determination for the operator and counsel/);
  assert.deepEqual(scanCustomerLanguage(text), []);
  // No application date is stated: none is held in src/lib/legal/framework.ts.
  assert.doesNotMatch(text, /\b(?:20\d\d|August|January)\b/);
});

test("each AI Act article the suite carries has framing in the language rule's terms", () => {
  for (const f of AI_ACT_FRAMINGS) {
    assert.deepEqual(scanCustomerLanguage(f.sentence), [], f.article);
    assert.equal(f.role === "high-risk", f.article !== "50");
    if (f.role === "high-risk") assert.match(f.sentence, /not as a duty you necessarily have/);
  }
  assert.equal(aiActFramingFor("EU AI Act Art. 50(1)")?.role, "transparency");
  assert.equal(aiActFramingFor("EU AI Act Art. 14")?.role, "high-risk");
  assert.equal(aiActFramingFor("GDPR Art. 15"), null);
  const suite = JSON.parse(readFileSync("data/suites/eu-support-v5.json", "utf8")) as { cases: Array<{ duty_refs?: string[] }> };
  const refs = new Set(suite.cases.flatMap((c) => c.duty_refs ?? []).filter((r) => r.startsWith("EU AI Act")));
  for (const ref of refs) assert.ok(aiActFramingFor(ref), `${ref} has no framing`);
});
