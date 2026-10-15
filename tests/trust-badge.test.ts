import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";
import { buildReceipt, type SealReceipt, type SealRow } from "../src/lib/report/public-verify.ts";
import {
  BADGE_CACHE,
  BADGE_HEIGHT,
  BADGE_LABEL,
  badgeContent,
  badgeDigest,
  badgeGeometry,
  badgeHeaders,
  badgeResponse,
  badgeShareFor,
  badgeSnippets,
  badgeSvg,
  escapeXml,
  pixelLogo,
  textWidth,
  type BadgeContent,
} from "../src/lib/report/badge.ts";

/**
 * The embeddable badge (`/api/badge/<sha256>`). It is a public image of a sealed report, so it
 * is held to the seal check's rules — it says only what the receipt says — and to the report's
 * language rule, and it must draw something legible for every answer, including "no".
 */

const CLIENT = "Acme Widgets GmbH";
const AGENT = "Acme refunds bot";

const BASE: ReportPayload = {
  novera: { format: 14 },
  subject: { client: CLIENT, agent: AGENT, policy_version: 3, environment: "Customer-operated agent, tested with recorded authorisation", authorisation: "Attested by owner@acme.example" },
  run: { id: "8a4f2c1e-0000-4000-8000-000000000001", date: "2026-10-13", suite: "EU support agent conformity suite (eu-support v5)", graded_by: ["m-a"], graded_uniformly: true, grading_funded_by: "Novera trial allowance" },
  coverage: { planned: 49, graded: 49, passed: 48, failed: 1, errored: 0, not_run: 0, score: 98, basis: "b" },
  obligations: [],
  findings: [],
  comparison: null,
  limitations: "Novera is evidence of testing, not a legal certification.",
  grade: { band: "A", score: 98, threshold: 80, basis: "b", meets_threshold: true },
};

function rowOf(payload: ReportPayload, extra: Partial<SealRow> = {}): SealRow {
  return { payload, content_hash: contentHash(payload as unknown as Json), created_at: "2026-10-13T09:41:12.345+00:00", revoked_at: null, ...extra };
}

function receiptOf(payload: ReportPayload, extra: Partial<SealRow> = {}): SealReceipt {
  const row = rowOf(payload, extra);
  return buildReceipt(row.content_hash, row);
}

const OWN_SUITE: ReportPayload = { ...BASE, run: { ...BASE.run, suite: "Acme refunds secret playbook (acme-refunds v3)" } };
const FIXTURE: ReportPayload = { ...BASE, subject: { ...BASE.subject, environment: "Novera scripted fixture (test data)" } };
const WITHHELD: ReportPayload = { ...BASE, grade: { band: "WITHHELD", score: 61, threshold: 80, basis: "b", meets_threshold: false } };
const INCOMPLETE: ReportPayload = {
  ...BASE,
  coverage: { ...BASE.coverage, passed: 20, graded: 21, not_run: 28 },
  grade: { band: "INCOMPLETE", score: 95, threshold: 80, basis: "b", meets_threshold: false },
};

const DIGEST = rowOf(BASE).content_hash;

// ---------------------------------------------------------------- what it says

test("a verified built-in suite: key and version, the sealed counts, sealed", () => {
  const c = badgeContent(receiptOf(BASE));
  assert.equal(c.state, "verified");
  assert.equal(c.label, "NOVERA TESTED");
  assert.equal(c.message, "eu-support v5 · 48/49 passed · sealed");
  assert.equal(c.alt, "Novera testing evidence: eu-support v5 (48/49 passed)");
});

test("a workspace's own suite is 'own suite vN', never its name or key", () => {
  const c = badgeContent(receiptOf(OWN_SUITE));
  assert.equal(c.message, "own suite v3 · 48/49 passed · sealed");
  for (const text of [c.message, c.alt, badgeSvg(c)]) {
    assert.ok(!/acme|playbook|refunds/i.test(text), text);
  }
});

test("a run against the fixture says test data", () => {
  const c = badgeContent(receiptOf(FIXTURE));
  assert.equal(c.message, "eu-support v5 · test data · 48/49 passed · sealed");
  assert.equal(c.alt, "Novera testing evidence: eu-support v5 (test data, 48/49 passed)");
});

test("WITHHELD and INCOMPLETE show the word, never a score or a count", () => {
  const withheld = badgeContent(receiptOf(WITHHELD));
  assert.equal(withheld.message, "eu-support v5 · grade withheld · sealed");
  const incomplete = badgeContent(receiptOf(INCOMPLETE));
  assert.equal(incomplete.message, "eu-support v5 · run incomplete · sealed");
  for (const c of [withheld, incomplete]) {
    assert.ok(!/\d+\/\d+|\b(?:61|95|98)\b/.test(c.message + c.alt), c.message);
  }
});

test("a payload without counts draws no counts rather than a default", () => {
  const bare = { ...BASE, coverage: { ...BASE.coverage, passed: undefined as unknown as number } };
  assert.equal(badgeContent(receiptOf(bare)).message, "eu-support v5 · sealed");
});

test("every other answer is a grey badge that says what happened", () => {
  const cases: Array<[SealReceipt | "unavailable" | null, string, string]> = [
    [receiptOf(BASE, { revoked_at: "2026-10-14T08:00:00Z" }), "withdrawn", "report withdrawn"],
    [buildReceipt("0".repeat(64), null), "unknown", "unverified digest"],
    [null, "malformed", "unverified digest"],
    ["unavailable", "unavailable", "check unavailable"],
  ];
  for (const [receipt, state, message] of cases) {
    const c = badgeContent(receipt);
    assert.equal(c.state, state);
    assert.equal(c.message, message);
    assert.equal(c.label, BADGE_LABEL);
  }
  // Stored, but its content no longer hashes to the digest: none of it is shown.
  const row = rowOf(BASE);
  const tampered = { ...row, payload: { ...BASE, coverage: { ...BASE.coverage, passed: 49 } } };
  const mismatch = badgeContent(buildReceipt(row.content_hash, tampered));
  assert.equal(mismatch.state, "mismatch");
  assert.equal(mismatch.message, "seal does not match");
});

test("nothing a badge or its share dialog says is a certification claim", () => {
  const all = [BASE, OWN_SUITE, FIXTURE, WITHHELD, INCOMPLETE].map((p) => badgeContent(receiptOf(p)));
  all.push(badgeContent(null), badgeContent("unavailable"), badgeContent(buildReceipt("0".repeat(64), null)));
  for (const c of all) {
    const text = [c.label, c.message, c.alt].join("\n");
    assert.deepEqual(scanCustomerLanguage(text), [], text);
    assert.ok(!/certif|complian|approved|conformant|guarantee/i.test(text), text);
  }
  const dialog = readFileSync(new URL("../src/components/ui/badge-share.tsx", import.meta.url), "utf8");
  assert.deepEqual(scanCustomerLanguage(dialog), []);
  assert.match(dialog, /testing evidence, not a\s+certification/);
});

// ---------------------------------------------------------------- how it is drawn

function tagsBalance(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, self] = m;
    if (self) continue;
    if (closing) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0;
}

test("the SVG: one root, 28 high, titled, whole pixels, nothing loaded from elsewhere", () => {
  const svg = badgeSvg(badgeContent(receiptOf(BASE)));
  const g = badgeGeometry(badgeContent(receiptOf(BASE)));
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" '));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(tagsBalance(svg), "every element closes");
  assert.match(svg, new RegExp(`width="${g.width}" height="${BADGE_HEIGHT}" viewBox="0 0 ${g.width} ${BADGE_HEIGHT}"`));
  assert.match(svg, /role="img" aria-label="Novera tested: eu-support v5 · 48\/49 passed · sealed"/);
  assert.match(svg, /<title>Novera tested: eu-support v5 · 48\/49 passed · sealed<\/title>/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  for (const attr of svg.matchAll(/\b(x|y|width|height|textLength)="([^"]*)"/g)) {
    assert.ok(Number.isInteger(Number(attr[2])), `${attr[1]}=${attr[2]} is a whole pixel`);
  }
  assert.equal(svg.match(/https?:\/\//g)?.length, 1, "the namespace is the only URL");
  assert.ok(!/<style|<image|<script|href=|@import|url\(/i.test(svg));
  assert.equal(g.width, g.leftWidth + g.rightWidth);
});

test("the logomark is snapped to whole pixels inside its box", () => {
  const bars = pixelLogo();
  assert.equal(bars.length, 3);
  for (const b of bars) {
    for (const v of [b.x, b.y, b.width, b.height]) assert.ok(Number.isInteger(v));
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 14 && b.y + b.height <= 14, JSON.stringify(b));
  }
  // Two equal tall bars, offset against each other, and a short core between them.
  assert.equal(bars[0].height, bars[2].height);
  assert.ok(bars[1].height < bars[0].height);
  assert.ok(bars[0].x + bars[0].width < bars[1].x && bars[1].x + bars[1].width < bars[2].x);
});

test("hostile text is escaped wherever it lands", () => {
  const hostile: BadgeContent = {
    state: "verified",
    label: BADGE_LABEL,
    message: `</text><script>alert("x")</script> & 'q'`,
    alt: `"><img src=x onerror=alert(1)>`,
  };
  const svg = badgeSvg(hostile);
  assert.ok(!svg.includes("<script"));
  assert.ok(!svg.includes("</text><script"));
  assert.ok(svg.includes("&lt;/text&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &apos;q&apos;"));
  assert.ok(tagsBalance(svg));
  assert.equal(escapeXml(`<&>"'`), "&lt;&amp;&gt;&quot;&apos;");
  const { html } = badgeSnippets(DIGEST, hostile);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes('alt="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
});

test("widths grow with the text and always cover it", () => {
  let previous = 0;
  for (let n = 1; n <= 60; n++) {
    const text = "eu-support v5 · 48/49 passed · sealed W".repeat(2).slice(0, n);
    const w = textWidth(text);
    assert.ok(w > previous, `${n} characters`);
    previous = w;
    const g = badgeGeometry({ label: BADGE_LABEL, message: text });
    assert.ok(g.messageLength >= w, "the box is at least the measured text");
  }
  assert.ok(textWidth("WWW") > textWidth("iii"), "proportional, not a fixed pitch");
  assert.equal(textWidth("ā"), 11, "a character outside the table is a full em");
  const short = badgeGeometry(badgeContent(null));
  const long = badgeGeometry(badgeContent(receiptOf(FIXTURE)));
  assert.ok(long.width > short.width);
  assert.equal(short.leftWidth, long.leftWidth, "the label segment never moves");
});

// ---------------------------------------------------------------- the response

test("headers: SVG, cached at the edge, no sniffing, nothing loads", () => {
  const h = badgeHeaders("verified");
  assert.equal(h["Content-Type"], "image/svg+xml; charset=utf-8");
  assert.equal(h["Cache-Control"], "public, s-maxage=60, stale-while-revalidate=60");
  assert.equal(h["Cache-Control"], BADGE_CACHE);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["Content-Security-Policy"], "default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(h["X-Novera-Seal"], "verified");
  assert.equal(badgeHeaders("withdrawn")["Cache-Control"], BADGE_CACHE);
  assert.equal(badgeHeaders("unavailable")["Cache-Control"], "no-store", "a failed read is not cached");
});

test("the digest parameter: 64 hex, any case, an optional .svg", () => {
  assert.equal(badgeDigest(DIGEST), DIGEST);
  assert.equal(badgeDigest(`${DIGEST}.svg`), DIGEST);
  assert.equal(badgeDigest(`${DIGEST.toUpperCase()}.SVG`), DIGEST);
  assert.equal(badgeDigest(DIGEST.slice(1)), null);
  assert.equal(badgeDigest(`${DIGEST}.png`), null);
  assert.equal(badgeDigest("%E0%A4%A"), null, "a broken escape is not a digest");
  assert.equal(badgeDigest("../../etc/passwd"), null);
});

test("the route answers every case with a 200 SVG, from one lookup by normalised digest", async () => {
  const asked: string[] = [];
  const rows = new Map<string, SealRow>([[DIGEST, rowOf(BASE)]]);
  const lookup = async (digest: string) => {
    asked.push(digest);
    const row = rows.get(digest) ?? null;
    return buildReceipt(digest, row);
  };

  const ok = await badgeResponse(`${DIGEST.toUpperCase()}.svg`, lookup);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.equal(ok.headers.get("x-novera-seal"), "verified");
  assert.equal(ok.headers.get("cache-control"), BADGE_CACHE);
  assert.match(await ok.text(), /eu-support v5 · 48\/49 passed · sealed/);
  assert.deepEqual(asked, [DIGEST]);

  const unknown = await badgeResponse("f".repeat(64), lookup);
  assert.equal(unknown.status, 200);
  assert.equal(unknown.headers.get("x-novera-seal"), "unknown");
  assert.match(await unknown.text(), /unverified digest/);

  asked.length = 0;
  const malformed = await badgeResponse("not-a-digest", lookup);
  assert.equal(malformed.status, 200);
  assert.equal(malformed.headers.get("x-novera-seal"), "malformed");
  assert.deepEqual(asked, [], "a malformed digest reads nothing");

  const thrown = await badgeResponse(DIGEST, async () => { throw new Error("db down"); });
  assert.equal(thrown.headers.get("x-novera-seal"), "unavailable");
  assert.equal(thrown.headers.get("cache-control"), "no-store");
  assert.match(await thrown.text(), /check unavailable/);

  const withdrawn = await badgeResponse(DIGEST, async (d) => buildReceipt(d, rowOf(BASE, { revoked_at: "2026-10-14T08:00:00Z" })));
  assert.equal(withdrawn.status, 200);
  assert.match(await withdrawn.text(), /report withdrawn/);
});

test("the route file reuses the seal check's lookup and exports only what Next accepts", () => {
  const source = readFileSync(new URL("../src/app/api/badge/[hash]/route.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ lookupSeal \} from "@\/app\/verify\/lookup\.ts"/);
  assert.match(source, /badgeResponse\(hash, lookupSeal\)/);
  const exported = [...source.matchAll(/^export (?:async )?(?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "dynamic"]);
});

// ---------------------------------------------------------------- the share dialog

test("the embed snippets link the badge to the public receipt on the production origin", () => {
  const c = badgeContent(receiptOf(BASE));
  const s = badgeSnippets(DIGEST, c);
  assert.equal(s.previewSrc, `/api/badge/${DIGEST}`);
  assert.equal(
    s.html,
    `<a href="https://www.nover.space/verify/${DIGEST}"><img src="https://www.nover.space/api/badge/${DIGEST}" alt="Novera testing evidence: eu-support v5 (48/49 passed)" height="28"></a>`,
  );
  assert.equal(s.markdown, `[![Novera testing evidence](https://www.nover.space/api/badge/${DIGEST})](https://www.nover.space/verify/${DIGEST})`);
});

test("the dialog is offered only for a live seal that still holds", () => {
  const live = badgeShareFor(rowOf(BASE));
  assert.ok(live);
  assert.equal(live.alt, "Novera testing evidence: eu-support v5 (48/49 passed)");
  assert.equal(live.previewWidth, badgeGeometry(badgeContent(receiptOf(BASE))).width);
  assert.equal(badgeShareFor(rowOf(BASE, { revoked_at: "2026-10-14T08:00:00Z" })), null, "withdrawn");
  const row = rowOf(BASE);
  assert.equal(badgeShareFor({ ...row, payload: { ...BASE, findings: [] , limitations: "edited" } }), null, "no longer hashes");
  assert.equal(badgeShareFor({ ...row, content_hash: "nope" }), null, "not a digest");
});
