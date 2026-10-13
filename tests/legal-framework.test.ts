import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { legalDocument, LEGAL_DOCUMENTS } from "../data/legal/index.ts";
import { LEGAL_ENTITY, entityComplete, missingEntityFields } from "../data/legal/entity.ts";
import { PROVIDER_REGISTER, activeHere, registerSnapshot } from "../data/legal/register.ts";
import { SUBPROCESSORS } from "../data/legal/subprocessors.ts";
import { RETENTION_SCHEDULE } from "../data/legal/retention.ts";
import { APPROVED_VERSIONS } from "../data/legal/archive.ts";
import {
  CONTRACT_SLUGS, UNUSUAL_CLAUSES, acceptanceIsCurrent, contractSet, documentDigest, livePublicationProblems,
  readAcceptanceForm, sectionText,
} from "../src/lib/legal/contract.ts";
import { countryName } from "../src/lib/legal/countries.ts";
import { isPublished, publicationProblems } from "../src/lib/legal/publication.ts";
import { billingConfig } from "../src/lib/billing/config.ts";
import { planAction } from "../src/lib/billing/plan-action.ts";

/**
 * The legal framework's infrastructure (legal build brief, 2026-10-13): the contract acceptance
 * ledger and checkout gate, the separate acceptance of unusual clauses, publication controls,
 * the provider register, the retention schedule. Every legal text stays a draft for counsel;
 * what these tests hold is that the machinery cannot make a draft look final, or record an
 * acceptance of a text other than the one shown.
 */

const form = (fields: Record<string, string>) => ({ get: (k: string) => (k in fields ? fields[k] : null) });
const GOOD = {
  legalName: "Example Agency SRL", registeredAddress: "Strada Exemplu 1, Bucharest", country: "ro", vatId: "ro 123 456",
  signerName: "Ana Pop", signerTitle: "Director", accept_terms: "on", accept_unusual: "on", accept_business: "on",
};

test("every unusual clause is a section of the Terms, and the Terms name exactly those sections", () => {
  const terms = legalDocument("terms")!;
  for (const c of UNUSUAL_CLAUSES) {
    assert.ok(sectionText(terms.body, c.heading), c.heading);
    assert.ok(c.heading.startsWith(`${c.section}. `), c.heading);
  }
  const listed = UNUSUAL_CLAUSES.map((c) => c.section);
  assert.ok(terms.body.includes(`Sections ${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}`), "section 19 lists the expressly accepted clauses");
  // Civil Code art. 1203's categories each have a clause: liability, suspension/termination, renewal, law, jurisdiction.
  const covered = UNUSUAL_CLAUSES.map((c) => c.covers).join(" ");
  for (const word of [/liability/, /suspen/, /renewal/, /Romanian law/, /jurisdiction/]) assert.match(covered, word);
});

test("an acceptance names the exact texts: any change to a document or an unusual clause makes it stale", () => {
  const set = contractSet();
  assert.deepEqual(set.documents.map((d) => d.slug), [...CONTRACT_SLUGS]);
  for (const d of set.documents) assert.match(d.sha256, /^[0-9a-f]{64}$/);
  assert.equal(set.allApproved, false, "every document is still a draft");
  const row = { terms_sha256: set.terms.sha256, unusual_terms_sha256: set.unusual.sha256, documents: set.documents };
  assert.equal(acceptanceIsCurrent(row, set), true);

  const changed = (slug: string, body: (b: string) => string) => contractSet((s) => {
    const d = legalDocument(s);
    return d && s === slug ? { ...d, body: body(d.body) } : d;
  });
  assert.equal(acceptanceIsCurrent(row, changed("privacy", (b) => `${b} x`)), false, "a changed privacy notice");
  const liability = changed("terms", (b) => b.replace("three (3) months", "twelve (12) months"));
  assert.notEqual(liability.unusual.sha256, set.unusual.sha256, "the liability clause is in the unusual fingerprint");
  assert.equal(acceptanceIsCurrent(row, liability), false);
  // A change outside the unusual sections changes the Terms, not the unusual fingerprint.
  const elsewhere = changed("terms", (b) => b.replace("## 3. What Novera is", "## 3. What Novera is\n\nAdded."));
  assert.equal(elsewhere.unusual.sha256, set.unusual.sha256);
  assert.notEqual(elsewhere.terms.sha256, set.terms.sha256);
  assert.equal(documentDigest({ slug: "x", version: "1", body: "a" }), documentDigest({ slug: "x", version: "1", body: "a" }));
});

test("the business gate: every field and each declaration separately, nothing implied", () => {
  const set = contractSet().setSha256;
  const ok = readAcceptanceForm(form({ ...GOOD, set }), set);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.country, "RO");
    assert.equal(ok.value.vatId, "RO123456", "normalised, recorded as declared");
  }
  const refused = (change: Record<string, string>, field: string) => {
    const r = readAcceptanceForm(form({ ...GOOD, set, ...change }), set);
    assert.ok(!r.ok, JSON.stringify(change));
    if (!r.ok) assert.equal(r.field, field);
  };
  refused({ set: "stale" }, "set");
  refused({ legalName: "" }, "legalName");
  refused({ registeredAddress: "x" }, "registeredAddress");
  refused({ country: "12" }, "country");
  refused({ vatId: "123" }, "vatId");
  refused({ signerName: "" }, "signerName");
  refused({ signerTitle: "" }, "signerTitle");
  for (const box of ["accept_terms", "accept_unusual", "accept_business"]) refused({ [box]: "" }, box);
  assert.equal(countryName("RO"), "Romania");
  assert.equal(countryName("ro"), null, "upper case only; the reader upper-cases first");
});

test("live billing needs approved documents and complete company details; nothing is invented", () => {
  assert.equal(entityComplete(), false);
  assert.ok(Object.values(LEGAL_ENTITY).every((v) => v === null), "no company fact is filled in by guesswork");
  assert.ok(missingEntityFields().includes("legalName"));
  const problems = livePublicationProblems();
  assert.ok(problems.some((p) => /drafts awaiting counsel/.test(p)));
  assert.ok(problems.some((p) => /company details are incomplete/.test(p)));
  // The checkout and the acceptance action both apply it in live mode, and checkout needs a current acceptance first.
  const actions = readFileSync("src/lib/billing/actions.ts", "utf8");
  const start = actions.slice(actions.indexOf("export async function startCheckout"), actions.indexOf("export async function openBillingPortal"));
  assert.ok(start.indexOf("livePublicationProblems(set)") > 0);
  const gate = start.indexOf("acceptanceIsCurrent(acceptance, set)");
  assert.ok(gate > 0 && gate < start.indexOf("createCustomer"), "the acceptance is checked before any Stripe object exists");
  assert.match(start, /contractAcceptanceId: acceptance\.id/);
  assert.match(readFileSync("src/lib/legal/actions.ts", "utf8"), /livePublicationProblems\(set\)/);
  assert.equal(planAction({ plan: "team_byok", manage: true, config: { active: true, mode: "test" }, sellable: true, hasCustomer: false, subscription: null, termsAccepted: false }).kind, "unavailable");
});

test("a draft is never published; an approved text must be the archived one", () => {
  for (const doc of LEGAL_DOCUMENTS) {
    assert.equal(isPublished(doc), false, doc.slug);
    assert.ok(publicationProblems(doc).includes("draft awaiting counsel"), doc.slug);
  }
  const terms = legalDocument("terms")!;
  const approvedNoArchive = { ...terms, status: "approved" as const, approval: { approvedBy: "x", approvedAt: "2026-11-01", effectiveDate: "2026-11-15" } };
  assert.ok(publicationProblems(approvedNoArchive, true).includes("approved text is not the archived version"));
  for (const a of APPROVED_VERSIONS) {
    const doc = legalDocument(a.slug);
    if (doc?.version === a.version) assert.equal(documentDigest(doc), a.sha256, `${a.slug} ${a.version} was edited after approval`);
  }
  assert.equal(new Set(APPROVED_VERSIONS.map((a) => `${a.slug}@${a.version}`)).size, APPROVED_VERSIONS.length);
  // The legal layout keeps everything out of search; only a published page lifts it.
  assert.match(readFileSync("src/app/legal/layout.tsx", "utf8"), /index: false/);
  assert.match(readFileSync("src/app/legal/[slug]/page.tsx", "utf8"), /isPublished\(doc\)/);
});

test("no public page links to a draft legal document or claims terms were agreed", () => {
  const files = [
    "src/app/page.tsx", "src/app/sign-in/page.tsx", "src/app/apply/page.tsx", "src/app/support/page.tsx",
    ...readdirSync("src/app/_home").map((f) => `src/app/_home/${f}`),
  ].filter((f) => existsSync(f) && f.endsWith(".tsx"));
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, /href=["{`]\/legal/, f);
    assert.doesNotMatch(text, /you agree to (the|our) terms/i, f);
  }
});

test("the register: planned providers are not sub-processors, and in-use is read from configuration only", () => {
  const listed = SUBPROCESSORS.map((p) => p.provider);
  for (const p of PROVIDER_REGISTER.filter((e) => e.status === "planned")) assert.ok(!listed.includes(p.provider), p.provider);
  assert.ok(PROVIDER_REGISTER.some((p) => p.provider === "Stripe" && p.status === "planned"));
  const resend = PROVIDER_REGISTER.find((p) => p.provider === "Resend")!;
  assert.equal(activeHere(resend, {}), false, "an email provider with no key sends nothing");
  assert.equal(activeHere(resend, { RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "a@b" }), true);
  const secret = "re_SUPERSECRET_value";
  const snapshot = JSON.stringify(registerSnapshot({ RESEND_API_KEY: secret, RESEND_FROM_EMAIL: "x@y", STRIPE_SECRET_KEY: "sk_test_123" }));
  assert.ok(!snapshot.includes(secret) && !snapshot.includes("sk_test_123"), "the machine-readable register never carries a value");
  for (const p of PROVIDER_REGISTER) {
    if (!p.regionVerified) assert.match(p.location, /\[TO VERIFY/, p.provider);
    assert.match(p.legalEntity, /\[/, p.provider);
  }
  assert.match(readFileSync("src/app/legal/subprocessors.json/route.ts", "utf8"), /noindex/);
});

test("the retention schedule states only periods the code enforces", () => {
  const migration = (n: string) => readFileSync(`supabase/migrations/${readdirSync("supabase/migrations").find((f) => f.startsWith(n))}`, "utf8");
  const row = (data: RegExp) => RETENTION_SCHEDULE.find((r) => data.test(r.data))!;
  assert.match(row(/Suite Builder/).keptFor, /^180 days/);
  assert.match(migration("0062"), /created_at < now\(\) - interval '180 days'/);
  assert.match(row(/Support messages/).keptFor, /90 days/);
  assert.match(migration("0038"), /interval '90 days'/);
  assert.match(row(/Product events/).keptFor, /^13 months$/);
  assert.match(migration("0062"), /interval '13 months'/);
  assert.match(row(/Scheduled-job/).keptFor, /^30 days$/);
  assert.match(migration("0064"), /interval '30 days'/);
  assert.match(row(/Workspace exports/).keptFor, /15 minutes/);
  assert.match(migration("0061"), /interval '15 minutes'/);
  assert.match(row(/Password-reset/).keptFor, /15 minutes/);
  assert.match(readFileSync("src/lib/auth/recovery.ts", "utf8"), /RECOVERY_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(row(/Contract acceptances/).keptFor, /COUNSEL TO CONFIRM/);
  assert.match(row(/Backups/).keptFor, /TO VERIFY WITH SUPABASE/);
  assert.ok(legalDocument("privacy")!.body.includes(row(/Contract acceptances/).keptFor), "the Privacy Notice renders the schedule");
});

test("0068: the acceptance ledger is append-only, server-written, VAT never marked validated, and leaves with its workspace", () => {
  const sql = readFileSync("supabase/migrations/0068_contract_acceptances.sql", "utf8");
  assert.match(sql, /contract_acceptances_append_only before update or delete on contract_acceptances\s+for each row execute function refuse_mutation\(\)/);
  assert.match(sql, /vat_id_verified\s+boolean not null default false check \(vat_id_verified = false\)/);
  assert.match(sql, /unusual_terms_expressly_accepted boolean not null check \(unusual_terms_expressly_accepted\)/);
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger on contract_acceptances from anon, authenticated/);
  assert.match(sql, /m\.role in \('owner', 'admin'\)/);
  assert.doesNotMatch(sql, /\bip(_address)?\b\s+(inet|text)/i, "no IP address column");
  // erase_workspace: 0062's body exactly, plus this table.
  const body = (s: string) => s.slice(s.indexOf("create or replace function erase_workspace"), s.indexOf("$$;", s.indexOf("create or replace function erase_workspace")));
  const previous = body(readFileSync("supabase/migrations/0062_product_events.sql", "utf8"));
  const next = body(sql);
  assert.equal(next.replace(/  -- 0068: contract acceptances\.[^\n]*\n  delete from contract_acceptances\s+where workspace_id = target;\n/, ""), previous);
});

test("a production deployment refuses a Stripe test key; Preview keeps the sandbox", () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_51x", STRIPE_WEBHOOK_SECRET: "whsec_x" };
  const prod = billingConfig({ ...env, VERCEL_ENV: "production" });
  assert.equal(prod.active, false);
  assert.match(prod.reason!, /production deployment, which takes live keys only/);
  assert.equal(prod.mode, null, "and it reads live rows, so sandbox subscriptions never count there");
  assert.equal(billingConfig({ ...env, VERCEL_ENV: "preview" }).active, true);
  assert.equal(billingConfig(env).active, true, "local development keeps the sandbox");
});
