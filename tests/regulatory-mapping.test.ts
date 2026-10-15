import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  FRAMEWORKS, LAYERS, SUITE, SUITE_FILE_VERSION, applyFilters, buildMatrix, filterHref, matrixTotals, readFilters, unplacedRefs,
} from "../src/app/solutions/regulatory-mapping/matrix.ts";
import { solution, solutionMetadata } from "../src/app/solutions/_components/content.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import sitemap from "../src/app/sitemap.ts";
import { SITE_ORIGIN } from "../src/lib/seo/site.ts";

/**
 * /solutions/regulatory-mapping: a matrix of the references the suite carries. Every row, every
 * scenario under it and every count is recomputed here from the JSON on disk, independently of
 * the page's own module, so the matrix cannot state a mapping the suite does not make.
 */

interface RawCase {
  id: string;
  severity: string;
  assertions: string[];
  checks?: unknown[];
  turn_checks?: unknown[];
  effect?: { evidence: string };
  duty_refs?: string[];
}

const newest = readdirSync("data/suites")
  .map((f) => /^eu-support-v(\d+)\.json$/.exec(f))
  .filter((m): m is RegExpExecArray => m !== null)
  .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
const CASES = (JSON.parse(readFileSync(`data/suites/${newest[0]}`, "utf8")) as { cases: RawCase[] }).cases;
const PAGE = readFileSync("src/app/solutions/regulatory-mapping/page.tsx", "utf8");
const MATRIX_SRC = readFileSync("src/app/solutions/regulatory-mapping/matrix.ts", "utf8");
const rows = buildMatrix();

test("the matrix reads the newest eu-support suite", () => {
  assert.equal(SUITE_FILE_VERSION, Number(newest[1]), "a new eu-support version shipped: point matrix.ts at it");
  assert.equal(SUITE.version, SUITE_FILE_VERSION);
});

test("every reference shown is one the suite carries, and every one the suite carries is shown", () => {
  const inSuite = new Set(CASES.flatMap((c) => c.duty_refs ?? []));
  for (const r of rows) assert.ok(inSuite.has(r.ref), `${r.ref} is not in the suite`);
  const shown = new Set([...rows.map((r) => r.ref), ...unplacedRefs()]);
  assert.deepEqual([...shown].sort(), [...inSuite].sort());
  assert.equal(new Set(rows.map((r) => r.anchor)).size, rows.length, "anchors are unique");
});

test("every row's scenarios are exactly those carrying the reference, in suite order, with their severity", () => {
  for (const r of rows) {
    const expected = CASES.filter((c) => (c.duty_refs ?? []).includes(r.ref));
    assert.deepEqual(r.scenarios.map((s) => s.id), expected.map((c) => c.id), r.ref);
    for (const s of r.scenarios) assert.equal(s.severity, expected.find((c) => c.id === s.id)!.severity, `${r.ref} ${s.id}`);
  }
});

test("how a scenario is checked is read off its own fields, never assumed", () => {
  for (const r of rows) for (const s of r.scenarios) {
    const c = CASES.find((x) => x.id === s.id)!;
    assert.equal(s.layers.includes("rules"), (c.checks?.length ?? 0) + (c.turn_checks?.length ?? 0) > 0, `${s.id} rules`);
    assert.equal(s.layers.includes("tool-record"), c.effect?.evidence === "tool_invoked", `${s.id} tool record`);
    assert.equal(s.layers.includes("read-back"), c.effect?.evidence === "state_confirmed", `${s.id} read-back`);
    assert.equal(s.layers.includes("graders"), c.assertions.length > 0, `${s.id} graders`);
  }
});

test("every headline figure equals a recount from the suite JSON", () => {
  const t = matrixTotals();
  const refs = new Set(CASES.flatMap((c) => c.duty_refs ?? []));
  const ai = [...refs].filter((r) => r.startsWith("EU AI Act Art. "));
  const gdpr = [...refs].filter((r) => r.startsWith("GDPR Art. "));
  assert.equal(t.scenarios, CASES.length);
  assert.equal(t.refs, ai.length + gdpr.length);
  assert.equal(t.aiActRefs, ai.length);
  assert.equal(t.gdprRefs, gdpr.length);
  assert.equal(t.aiActScenarios, CASES.filter((c) => (c.duty_refs ?? []).some((r) => r.startsWith("EU AI Act"))).length);
  assert.equal(t.gdprScenarios, CASES.filter((c) => (c.duty_refs ?? []).some((r) => r.startsWith("GDPR"))).length);
  assert.equal(t.mapped, CASES.filter((c) => (c.duty_refs ?? []).some((r) => r.startsWith("EU AI Act") || r.startsWith("GDPR"))).length);
  assert.equal(t.byLayer.rules, CASES.filter((c) => (c.checks?.length ?? 0) + (c.turn_checks?.length ?? 0) > 0).length);
  assert.equal(t.byLayer["read-back"], CASES.filter((c) => c.effect?.evidence === "state_confirmed").length);
  assert.equal(t.byLayer["tool-record"], CASES.filter((c) => c.effect?.evidence === "tool_invoked").length);
  assert.equal(t.byLayer.graders, CASES.filter((c) => c.assertions.length > 0).length);
  for (const r of rows) {
    assert.equal(r.scenarios.length, CASES.filter((c) => (c.duty_refs ?? []).includes(r.ref)).length, r.ref);
  }
  // The page states figures only through these computed values: no digit typed beside "scenario".
  assert.doesNotMatch(PAGE, /\b\d+ (?:of \d+ )?scenarios?\b/);
});

test("no scenario is mapped to AI Act Article 12, and the page says why it has no row", () => {
  assert.ok(!CASES.some((c) => (c.duty_refs ?? []).some((r) => /^EU AI Act Art\. 12\b/.test(r))), "the suite now carries AI Act Art. 12: revisit the records section");
  assert.ok(!rows.some((r) => r.framework === "ai-act" && r.articleNumber === "12"));
  assert.match(PAGE, /What Novera records about each test/);
  assert.match(PAGE, /not the record-keeping Article 12\s+of the AI Act asks a high-risk AI system itself to provide/);
  // GDPR Art. 12(6) is a different provision and stays, as the suite files it.
  assert.ok(rows.some((r) => r.ref === "GDPR Art. 12(6)") === CASES.some((c) => (c.duty_refs ?? []).includes("GDPR Art. 12(6)")));
});

test("the not-a-conformity-assessment callout sits near the top, before the matrix", () => {
  const notice = PAGE.indexOf("<MappingNotice>");
  const matrix = PAGE.indexOf('id="matrix"');
  assert.ok(notice > 0 && notice < matrix, "the callout comes before the matrix");
  const callout = PAGE.slice(notice, PAGE.indexOf("</MappingNotice>"));
  assert.match(callout, /maps technical testing evidence to duties you may already have/);
  assert.match(callout, /not a\s+statutory conformity assessment, not a legal opinion, and not a finding that any duty\s+applies to you or that any duty is met/);
  assert.match(PAGE, /<NotCertification\b/);
});

test("filters: known values only, links that keep each other, and an unknown value is ignored", () => {
  const f = readFilters({ framework: "gdpr", article: "17", layer: "graders" }, rows);
  assert.deepEqual(f, { framework: "gdpr", article: "17", layer: "graders" });
  assert.deepEqual(applyFilters(rows, f).map((r) => r.ref), ["GDPR Art. 17"]);

  assert.deepEqual(readFilters({ framework: "<script>", article: "999", layer: "vibes" }, rows), { framework: null, article: null, layer: null });
  // An article the chosen framework does not carry is dropped, not shown as an empty matrix.
  assert.equal(readFilters({ framework: "ai-act", article: "17" }, rows).article, null);
  assert.deepEqual(readFilters({ framework: ["gdpr", "ai-act"] }, rows).framework, null);

  const gdprOnly = applyFilters(rows, { framework: "gdpr", article: null, layer: null });
  assert.ok(gdprOnly.length > 0 && gdprOnly.every((r) => r.framework === "gdpr"));
  const fiveGdpr = applyFilters(rows, { framework: "gdpr", article: "5", layer: null }).map((r) => r.ref);
  assert.deepEqual(fiveGdpr, rows.filter((r) => r.ref.startsWith("GDPR Art. 5(")).map((r) => r.ref));

  for (const l of LAYERS) {
    const kept = applyFilters(rows, { framework: null, article: null, layer: l.id });
    for (const r of kept) assert.ok(r.shown.length > 0 && r.shown.every((s) => s.layers.includes(l.id)));
  }

  assert.equal(filterHref({}), "/solutions/regulatory-mapping#matrix");
  assert.equal(filterHref({ framework: "ai-act", article: "50", layer: "rules" }), "/solutions/regulatory-mapping?framework=ai-act&article=50&layer=rules#matrix");
  assert.deepEqual(FRAMEWORKS.map((f) => f.id), ["ai-act", "gdpr"]);
});

test("metadata: its own title, description, canonical and card", () => {
  const s = solution("regulatory-mapping");
  const m = solutionMetadata("regulatory-mapping");
  assert.match(PAGE, /export const metadata: Metadata = solutionMetadata\("regulatory-mapping"\)/);
  assert.equal(m.alternates?.canonical, "/solutions/regulatory-mapping");
  assert.equal(m.title, s.title);
  const images = m.openGraph?.images;
  const first = (Array.isArray(images) ? images[0] : images) as { url: string } | undefined;
  assert.equal(first?.url, `/api/og?title=${encodeURIComponent(s.title)}`);
  // Structured data: a breadcrumb (from the frame) and a Dataset; no Organization, no offer.
  assert.match(PAGE, /"@type": "Dataset"/);
  assert.doesNotMatch(PAGE, /Organization|offers|priceCurrency/);
});

test("the page and its data module pass the language rule and name no price", () => {
  for (const [name, src] of [["page.tsx", PAGE], ["matrix.ts", MATRIX_SRC]] as const) {
    assert.deepEqual(scanCustomerLanguage(src), [], name);
    assert.doesNotMatch(src, /€|\bEUR\b|\$\d|per month|\/month/i, name);
    assert.doesNotMatch(src, /\b(?:compliance|conformity) (?:with|to) the (?:EU )?AI Act\b/i, name);
  }
});

test("the sitemap, the solutions footer and the home footer link the page", () => {
  assert.ok(sitemap().some((e) => e.url === `${SITE_ORIGIN}/solutions/regulatory-mapping`));
  assert.match(readFileSync("src/app/page.tsx", "utf8"), /\["Regulatory mapping", "\/solutions\/regulatory-mapping"\]/);
  assert.match(readFileSync("src/app/solutions/_components/solution-ui.tsx", "utf8"), /SOLUTIONS\.map\(\(s\): \[string, string\] => \[s\.name, s\.path\]\)/);
});
