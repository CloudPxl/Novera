import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sitemap from "../src/app/sitemap.ts";
import robots from "../src/app/robots.ts";
import { cardText, OG_DEFAULT_BADGE, OG_DEFAULT_TITLE } from "../src/lib/seo/og.ts";
import {
  breadcrumbLd, collectionPageLd, serializeJsonLd, softwareApplicationLd, techArticleLd,
} from "../src/lib/seo/json-ld.ts";
import { pageMetadata, SITE_ORIGIN } from "../src/lib/seo/site.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("root layout sets metadataBase, a title template and cards", () => {
  const src = read("src/app/layout.tsx");
  assert.match(src, /metadataBase: new URL\(SITE_ORIGIN\)/);
  assert.match(src, /template: TITLE_TEMPLATE/);
  assert.match(src, /summary_large_image/);
  assert.equal(SITE_ORIGIN, "https://www.nover.space");
  const site = read("src/lib/seo/site.ts");
  assert.match(site, /TITLE_TEMPLATE = "%s \| Novera — EU AI Act & Agent Evaluation"/);
});

test("pageMetadata gives description, canonical, Open Graph and Twitter image", () => {
  const m = pageMetadata({ title: "Guide", description: "d", path: "/guide" });
  assert.equal(m.description, "d");
  assert.equal(m.alternates?.canonical, "/guide");
  const image = (m.openGraph?.images as Array<{ url: string }>)[0].url;
  assert.equal(image, "/api/og?title=Guide");
  assert.equal((m.twitter as { card: string }).card, "summary_large_image");
});

test("every public page module declares description, canonical and an Open Graph image", () => {
  const pages: Record<string, string> = {
    "src/app/page.tsx": "/",
    "src/app/docs/page.tsx": "/docs",
    "src/app/docs/[slug]/page.tsx": "/docs/",
    "src/app/guide/page.tsx": "/guide",
    "src/app/support/page.tsx": "/support",
    "src/app/apply/page.tsx": "/apply",
    "src/app/status/page.tsx": "/status",
    "src/app/sign-in/page.tsx": "/sign-in",
  };
  for (const [file, path] of Object.entries(pages)) {
    const src = read(file);
    assert.match(src, /pageMetadata\(/, `${file} uses pageMetadata`);
    assert.ok(src.includes(`path: "${path}`) || src.includes(`path: \`${path}`), `${file} names canonical ${path}`);
    assert.match(src, /description/, `${file} has a description`);
  }
});

test("sitemap lists only allowed public routes, absolute, no /legal and no /verify/<hash>", () => {
  const urls = sitemap().map((e) => e.url);
  for (const u of urls) assert.ok(u.startsWith(`${SITE_ORIGIN}/`), u);
  for (const must of ["/", "/docs", "/guide", "/apply", "/support", "/verify", "/solutions/eu-ai-act", "/solutions/black-box-testing", "/solutions/agency", "/solutions/regulatory-mapping", "/status"]) {
    assert.ok(urls.includes(`${SITE_ORIGIN}${must === "/" ? "/" : must}`), must);
  }
  assert.ok(urls.some((u) => u.startsWith(`${SITE_ORIGIN}/docs/`)));
  assert.ok(!urls.some((u) => u.includes("/legal")));
  assert.ok(!urls.some((u) => /\/verify\/./.test(u)));
  const forbidden = /^\/(dashboard|agents|runs|reports?|settings|sign-in|api|auth|invite)(\/|$)/;
  assert.ok(!urls.some((u) => forbidden.test(u.slice(SITE_ORIGIN.length))));
  assert.equal(new Set(urls).size, urls.length);
});

test("robots keeps the private areas out and the discovery files in", () => {
  const r = robots();
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
  const allow = ([] as string[]).concat(rule.allow ?? []);
  const disallow = ([] as string[]).concat(rule.disallow ?? []);
  for (const a of ["/", "/docs", "/solutions", "/verify", "/legal", "/api/og", "/llms.txt", "/api/v1/openapi.json"]) assert.ok(allow.includes(a), a);
  for (const d of ["/api/", "/sign-in", "/settings/", "/runs/", "/report/", "/dashboard"]) assert.ok(disallow.includes(d), d);
  // The longest matching rule wins: every allowed API path is longer than the "/api/" block.
  for (const a of allow.filter((x) => x.startsWith("/api/"))) assert.ok(a.length > "/api/".length);
  assert.equal(r.sitemap, `${SITE_ORIGIN}/sitemap.xml`);
});

test("JSON-LD builders emit valid JSON with context and type, no offers or Organization", () => {
  const items = [
    softwareApplicationLd(),
    breadcrumbLd([{ name: "Novera", path: "/" }, { name: "Docs", path: "/docs" }]),
    techArticleLd({ headline: "x</script><b>", path: "/docs/x", dateModified: null }),
    collectionPageLd({ name: "n", description: "d", path: "/docs" }),
  ];
  for (const item of items) {
    const text = serializeJsonLd(item);
    assert.ok(!text.includes("<"), "no raw < in the serialised block");
    const parsed = JSON.parse(text);
    assert.equal(parsed["@context"], "https://schema.org");
    assert.ok(parsed["@type"]);
    assert.ok(!/"offers"|"Organization"|"price"/.test(text));
  }
  assert.equal(JSON.parse(serializeJsonLd(items[2]))["headline"], "x</script><b>");
  assert.ok(!("dateModified" in items[2]), "no date is invented");
  assert.equal((items[0] as { applicationCategory: string }).applicationCategory, "BusinessApplication");
});

test("the card text is capped, sanitised and falls back on claim wording", () => {
  assert.deepEqual(cardText("Guide", "Testing evidence"), { title: "Guide", badge: "Testing evidence" });
  assert.equal(cardText("x".repeat(500), null).title.length, 90);
  assert.equal(cardText("a<b>\n\tc", null).title, "a b c");
  assert.equal(cardText(null, null).title, OG_DEFAULT_TITLE);
  for (const bad of ["Compliance verified", "Fully certified", "Tamper-proof", "Your agent is compliant", "Guaranteed safe"]) {
    assert.equal(cardText(null, bad).badge, OG_DEFAULT_BADGE, bad);
    assert.equal(cardText(bad, null).title, OG_DEFAULT_TITLE, bad);
  }
  const src = read("src/app/api/og/route.tsx");
  assert.match(src, /ImageResponse/);
  assert.match(src, /cardText\(/);
});
