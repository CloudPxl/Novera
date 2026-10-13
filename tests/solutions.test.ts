import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  AI_ACT_REFS, AI_ACT_SCENARIOS, GDPR_SCENARIOS, SOLUTIONS, SOLUTIONS_INDEX, SUITE,
  solutionMetadata, solutionsIndexMetadata,
} from "../src/app/solutions/_components/content.ts";
import { REPORT_NOTICE_SHORT } from "../src/lib/legal/notices.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

/**
 * The public solution pages (/solutions/*). Each one is a promise to a stranger, so each is
 * held to the same rules as the home page: its metadata is its own, it ends in the sign-up
 * action and the not-a-certification notice, and every figure it states is re-counted from
 * the suite a new run uses.
 */

const SLUGS = ["eu-ai-act", "black-box-testing", "agency"] as const;
const pageSource = (slug: string) => readFileSync(`src/app/solutions/${slug}/page.tsx`, "utf8");
const UI = readFileSync("src/app/solutions/_components/solution-ui.tsx", "utf8");

test("there are exactly the three solution pages, each with a page file", () => {
  assert.deepEqual(SOLUTIONS.map((s) => s.slug), [...SLUGS]);
  const dirs = readdirSync("src/app/solutions", { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();
  assert.deepEqual(dirs, [...SLUGS].sort());
});

for (const slug of SLUGS) {
  test(`/solutions/${slug} exports its own metadata: title, description, canonical, card`, () => {
    const source = pageSource(slug);
    assert.match(source, new RegExp(`export const metadata: Metadata = solutionMetadata\\("${slug}"\\)`));

    const m = solutionMetadata(slug);
    const s = SOLUTIONS.find((x) => x.slug === slug)!;
    assert.equal(m.title, s.title);
    assert.ok(typeof m.title === "string" && m.title.length >= 20 && m.title.length <= 70, `title length ${String(m.title).length}`);
    assert.ok(m.description && m.description.length >= 80 && m.description.length <= 170, `description length ${m.description?.length}`);
    assert.equal(m.alternates?.canonical, `/solutions/${slug}`);
    const images = m.openGraph?.images;
    const first = (Array.isArray(images) ? images[0] : images) as { url: string } | undefined;
    assert.equal(first?.url, `/api/og?title=${encodeURIComponent(s.title)}`);
  });

  test(`/solutions/${slug} carries the sign-up action and the not-a-certification notice`, () => {
    const source = pageSource(slug);
    assert.ok(source.includes(`href: "/sign-in?mode=signup"`), "hero action goes to sign-up");
    assert.match(source, /<ClosingCta\b/);
    assert.match(source, /<NotCertification\b/);
    assert.match(source, /<SolutionFrame\b[^>]*current="[^"]+"/);
  });
}

test("the shared parts render the sign-up link and the report's own notice, word for word", () => {
  assert.match(UI, /export const SIGNUP_HREF = "\/sign-in\?mode=signup";/);
  assert.match(UI, /import \{[^}]*REPORT_NOTICE_SHORT[^}]*\} from "@\/lib\/legal\/notices\.ts"/);
  assert.match(UI, /const NOTICE_BODY = REPORT_NOTICE_SHORT\.replace\(/);
  assert.match(UI, /\{NOTICE_BODY\}/);
  assert.ok(REPORT_NOTICE_SHORT.startsWith("Testing evidence, not certification: "), "the prefix the notice block strips is still there");
  assert.match(UI, /<SiteHeader\b/);
  assert.match(UI, /<main id="main">/);
});

test("the index page has its own metadata and lists every solution", () => {
  const source = readFileSync("src/app/solutions/page.tsx", "utf8");
  assert.match(source, /export const metadata: Metadata = solutionsIndexMetadata\(\)/);
  const m = solutionsIndexMetadata();
  assert.equal(m.alternates?.canonical, SOLUTIONS_INDEX.path);
  assert.ok(m.description && m.description.length <= 170);
  assert.match(source, /SOLUTIONS\.map/);
  assert.ok(source.includes(`href: "/sign-in?mode=signup"`));
});

test("no solution page names a price, a customer or a testimonial", () => {
  for (const file of [...SLUGS.map((s) => `src/app/solutions/${s}/page.tsx`), "src/app/solutions/page.tsx", "src/app/solutions/_components/solution-ui.tsx", "src/app/solutions/_components/content.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /€|\bEUR\b|\$\d|per month|\/month|testimonial|trusted by/i, file);
  }
});

// The figures the AI Act page states, re-counted from the newest eu-support suite: a new run
// uses it, and a v6 must not leave the page describing v5.
test("the AI Act page's figures are the newest suite's own", () => {
  const newest = readdirSync("data/suites")
    .map((f) => /^eu-support-v(\d+)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  assert.equal(Number(newest[1]), SUITE.version, "a new eu-support version shipped: recount the solution pages");
  assert.equal(SUITE.name, `eu-support v${SUITE.version}`);

  const cases = (JSON.parse(readFileSync(`data/suites/${newest[0]}`, "utf8")) as { cases: Array<{ duty_refs?: string[] }> }).cases;
  assert.equal(cases.length, SUITE.scenarios);

  const counted: Record<string, number> = {};
  for (const c of cases) for (const r of c.duty_refs ?? []) if (r.startsWith("EU AI Act")) counted[r] = (counted[r] ?? 0) + 1;
  assert.deepEqual(counted, { ...AI_ACT_REFS }, "every AI Act reference the suite uses, and only those, with its count");
  assert.equal(cases.filter((c) => (c.duty_refs ?? []).some((r) => r.startsWith("EU AI Act"))).length, AI_ACT_SCENARIOS);
  assert.equal(cases.filter((c) => (c.duty_refs ?? []).some((r) => r.startsWith("GDPR"))).length, GDPR_SCENARIOS);

  // The GDPR articles the page lists in words: 5, 12, 15 to 22, 25, 32 and 33.
  const articles = new Set<number>();
  for (const c of cases) for (const r of c.duty_refs ?? []) {
    const m = /^GDPR Art\. (\d+)/.exec(r);
    if (m) articles.add(Number(m[1]));
  }
  assert.deepEqual([...articles].sort((a, b) => a - b), [5, 12, 15, 16, 17, 18, 19, 20, 21, 22, 25, 32, 33]);
  assert.match(pageSource("eu-ai-act"), /Articles 5, 12, 15 to 22,\s+25, 32 and 33/);
});

test("the AI Act page never says a duty applies or is met", () => {
  const source = pageSource("eu-ai-act");
  assert.match(source, /not a\s+finding that the duty applies to your organisation, or that it is met/);
  assert.doesNotMatch(source, /\b(?:conformity|compliance) (?:with|to) the (?:EU )?AI Act\b/i);
  assert.deepEqual(scanCustomerLanguage(source), []);
});
