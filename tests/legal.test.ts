import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGAL_DOCUMENTS, legalDocument, DRAFT_BANNER } from "../data/legal/index.ts";
import { SOURCES, sourceById } from "../data/legal/sources.ts";
import { SUBPROCESSORS } from "../data/legal/subprocessors.ts";
import { STORAGE } from "../data/legal/cookies.ts";
import { parseLegalBody, placeholdersIn, splitPlaceholders, headingId } from "../src/lib/legal/document.ts";

/**
 * The legal pages are drafts for counsel. What these tests hold is that a draft cannot
 * quietly become a claim: no compliance or certification wording, every missing fact a
 * visible placeholder, every source dated, and no inactive vendor listed as active.
 */

const SLUGS = ["privacy", "terms", "dpa", "subprocessors", "imprint", "cookies", "acceptable-use", "security", "ai-testing-scope", "refunds"];

test("every required document exists once, as a draft with a review date and sources", () => {
  assert.deepEqual([...LEGAL_DOCUMENTS.map((d) => d.slug)].sort(), [...SLUGS].sort());
  for (const doc of LEGAL_DOCUMENTS) {
    assert.equal(doc.status, "draft", doc.slug);
    assert.match(doc.lastReviewed, /^\d{4}-\d{2}-\d{2}$/, doc.slug);
    assert.ok(doc.sources.length > 0, `${doc.slug} names no source`);
    for (const id of doc.sources) assert.ok(sourceById(id), `${doc.slug}: ${id}`);
  }
  assert.equal(legalDocument("nope"), null);
  assert.equal(DRAFT_BANNER, "Draft — requires legal review and completion of company details");
});

test("every source has an official https address and the date it was read", () => {
  for (const s of SOURCES) {
    assert.match(s.url, /^https:\/\//, s.id);
    assert.match(s.fetched, /^\d{4}-\d{2}-\d{2}$/, s.id);
    assert.ok(s.note.length > 20, s.id);
  }
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
});

test("no document claims compliance, certification, EU-only processing or readiness", () => {
  const forbidden = [
    /\bGDPR[- ]compliant\b/i,
    /\bAI Act[- ]compliant\b/i,
    /\bfully compliant\b/i,
    /\bcompliant with\b/i,
    /\bcertified\b/i,
    /\bEU[- ]only\b/i,
    /\benterprise[- ]ready\b/i,
    /\bguarantee[sd]? (?:of )?compliance\b/i,
    /\blegally sufficient\b/i,
    /\bISO ?27001\b/i,
    /\bSOC ?2\b/i,
  ];
  for (const doc of LEGAL_DOCUMENTS) {
    for (const pattern of forbidden) assert.doesNotMatch(doc.body, pattern, `${doc.slug} matches ${pattern}`);
  }
});

test("company facts are placeholders, never invented", () => {
  const imprint = legalDocument("imprint")!;
  for (const field of ["[LEGAL ENTITY NAME]", "[REGISTERED ADDRESS]", "[TAX REGISTRATION CODE]", "[CONTACT EMAIL]"]) {
    assert.ok(imprint.body.includes(field), field);
  }
  for (const slug of ["privacy", "terms", "dpa"]) {
    assert.ok(legalDocument(slug)!.body.includes("[LEGAL ENTITY NAME]"), slug);
  }
  // Nothing that looks like a real Romanian company identifier.
  for (const doc of LEGAL_DOCUMENTS) {
    assert.doesNotMatch(doc.body, /\bJ\d{2}\/\d+\/\d{4}\b/, doc.slug);
    assert.doesNotMatch(doc.body, /\bRO\d{6,10}\b/, doc.slug);
  }
});

test("every bracketed capital phrase is read as a placeholder, and nothing else is", () => {
  assert.deepEqual(splitPlaceholders("By [LEGAL ENTITY NAME], at [a link]."), [
    { text: "By ", placeholder: false },
    { text: "[LEGAL ENTITY NAME]", placeholder: true },
    { text: ", at [a link].", placeholder: false },
  ]);
  assert.deepEqual(placeholdersIn("x [VAT ID] y [TO VERIFY WITH SUPABASE]"), ["[VAT ID]", "[TO VERIFY WITH SUPABASE]"]);
  for (const doc of LEGAL_DOCUMENTS.filter((d) => d.slug !== "security")) {
    assert.ok(placeholdersIn(doc.body).length > 0, `${doc.slug} has no open item at all`);
  }
});

test("every body parses; tables keep their columns; headings get anchors", () => {
  for (const doc of LEGAL_DOCUMENTS) {
    const blocks = parseLegalBody(doc.body);
    assert.ok(blocks.length > 0, doc.slug);
    for (const b of blocks) {
      if (b.kind === "table") for (const row of b.rows) assert.equal(row.length, b.head.length, doc.slug);
      // A pipe table that failed to parse would print as a paragraph of pipes.
      if (b.kind === "paragraph") assert.ok(!b.spans.map((s) => s.text).join("").trim().startsWith("|"), `${doc.slug}: unparsed table`);
    }
  }
  const tables = parseLegalBody(legalDocument("subprocessors")!.body).filter((b) => b.kind === "table");
  assert.ok(tables.length >= 2);
  assert.equal(headingId([{ kind: "text", text: "Who is responsible?" }]), "who-is-responsible");
});

test("markup in a body is text, never HTML", () => {
  const blocks = parseLegalBody("A <script>alert(1)</script> here.\n\n| A | B |\n| --- | --- |\n| <b>x</b> | y |");
  assert.equal(blocks[0].kind, "paragraph");
  const table = blocks[1];
  assert.equal(table.kind, "table");
  if (table.kind === "table") assert.equal(table.rows[0][0][0].text, "<b>x</b>");
});

test("only active vendors are listed as active sub-processors", () => {
  const active = SUBPROCESSORS.map((p) => p.provider.toLowerCase()).join(" ");
  for (const inactive of ["stripe", "sentry", "posthog", "datadog", "openai", "anthropic", "plausible"]) {
    assert.ok(!active.includes(inactive), inactive);
  }
  const supabase = SUBPROCESSORS.find((p) => p.provider === "Supabase")!;
  assert.match(supabase.location, /eu-central-1/);
  const vercel = SUBPROCESSORS.find((p) => p.provider === "Vercel")!;
  assert.match(vercel.location, /fra1/);
  assert.match(vercel.location, /worldwide/);
  // A location not verified in the repository is a placeholder, not a guess.
  for (const p of SUBPROCESSORS.filter((p) => !["Supabase", "Vercel"].includes(p.provider))) {
    assert.match(p.location, /\[TO VERIFY/, p.provider);
  }
  for (const p of SUBPROCESSORS) assert.match(p.transfer, /\[/, p.provider);
});

test("the cookie list names what the code sets, and nothing for analytics", () => {
  const names = STORAGE.map((s) => s.name).join(" ");
  for (const n of ["nv_ws", "nv_invite", "nv_recovery", "auth-token", "novera.motion"]) assert.ok(names.includes(n), n);
  assert.ok(STORAGE.every((s) => s.category === "strictly necessary" || s.category === "preference"));
});
