import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGAL_ENTITY, REQUIRED_ENTITY_FIELDS, type LegalEntity } from "../data/legal/entity.ts";
import { LEGAL_DOCUMENTS } from "../data/legal/index.ts";
import { PROVIDER_REGISTER, activeHere } from "../data/legal/register.ts";
import { buildStatus, countStates } from "../src/lib/readiness/status.ts";
import { buildGates } from "../src/lib/readiness/gates.ts";
import { DECISIONS } from "../src/lib/readiness/decisions.ts";
import { parseLaunchLedger, prepareRepoDoc, readRepoDoc, READINESS_DOCS } from "../src/lib/readiness/repo-docs.ts";
import { BRIEF_ELSEWHERE, BRIEF_TRACKER, sectionsIn } from "../src/lib/legal/framework.ts";
import { parseLegalBody } from "../src/lib/legal/document.ts";
import { isStaff, staffEmails } from "../src/lib/auth/staff-list.ts";
import robots from "../src/app/robots.ts";

/**
 * The staff page /readiness: its live status is computed from the code and configuration and never
 * prints a configuration value; its brief tracker is the same table as docs/LEGAL-FRAMEWORK.md; its
 * decisions quote the repository word for word; and only staff can open it.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id)!;
const COMPLETE: LegalEntity = {
  ...LEGAL_ENTITY,
  legalName: "Example SRL", legalForm: "SRL", registeredOffice: "Strada Exemplu 1, Bucharest", tradeRegisterNumber: "J40/1/2026",
  uniqueRegistrationCode: "RO1", vatStatus: "Not VAT-registered", contactEmail: "hello@example.com",
};

// ------------------------------------------------------------------ Status

test("an incomplete entity waits on David and names only the missing fields", () => {
  const checks = buildStatus({ env: {} });
  const entity = byId(checks, "entity");
  assert.equal(entity.state, "david");
  assert.match(entity.summary, new RegExp(`^0 of ${REQUIRED_ENTITY_FIELDS.length} required fields`));
  const missing = entity.items!.find((i) => i.label.startsWith("Missing"))!;
  for (const name of ["legal name", "legal form", "registered office", "VAT status", "contact email"]) assert.ok(missing.value.includes(name), name);

  const done = byId(buildStatus({ env: {}, entity: COMPLETE }), "entity");
  assert.equal(done.state, "ready");
  assert.ok(!done.items!.some((i) => i.label.startsWith("Missing")));
});

test("legal documents are read through the publication rule: drafts wait on counsel", () => {
  const docs = byId(buildStatus({ env: {} }), "documents");
  assert.equal(docs.state, "counsel");
  assert.equal(docs.items!.length, LEGAL_DOCUMENTS.length);
  assert.ok(docs.items!.every((i) => i.value.includes("draft awaiting counsel")));
  assert.match(docs.summary, new RegExp(`^0 of ${LEGAL_DOCUMENTS.length} published`));
});

test("a Stripe test key on production is blocked, and no key or secret is ever printed", () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_SECRETVALUE123456", STRIPE_WEBHOOK_SECRET: "whsec_SIGNINGSECRET789",
    STRIPE_PRICE_TEAM_BYOK: "price_TEAMPRICEID", VERCEL_ENV: "production",
    RESEND_API_KEY: "re_RESENDKEYVALUE", RESEND_FROM_EMAIL: "no-reply@nover.space",
  };
  const checks = buildStatus({ env });
  const billing = byId(checks, "billing");
  assert.equal(billing.state, "blocked");
  assert.match(billing.summary, /test key is configured on production/);
  assert.ok(billing.items!.some((i) => i.label === "Billing mode here" && i.value === "off"));
  assert.ok(billing.items!.some((i) => i.label === "Stripe secret key" && i.value === "present (test)"));
  assert.equal(countStates(checks).blocked, 1);

  const everything = JSON.stringify([checks, buildGates({ env, ledger: null })]);
  for (const value of ["SECRETVALUE123456", "SIGNINGSECRET789", "TEAMPRICEID", "RESENDKEYVALUE"]) {
    assert.ok(!everything.includes(value), `${value} leaked into the page data`);
  }
});

test("the same test key on a preview deployment is sandbox billing, still refused for a live sale", () => {
  const billing = byId(buildStatus({ env: { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_y", VERCEL_ENV: "preview" } }), "billing");
  assert.notEqual(billing.state, "blocked");
  assert.equal(billing.state, "counsel", "contract documents are drafts");
  assert.ok(billing.items!.some((i) => i.label === "Billing mode here" && i.value === "test"));
  assert.ok(billing.items!.some((i) => i.label === "Live selling refused" && /drafts awaiting counsel/.test(i.value)));
});

test("email without its environment waits on David; presence is a boolean, never the value", () => {
  const off = byId(buildStatus({ env: {} }), "email");
  assert.equal(off.state, "david");
  assert.deepEqual(off.items!.slice(0, 2).map((i) => i.value), ["absent", "absent"]);

  const on = byId(buildStatus({ env: { RESEND_API_KEY: "re_abc", RESEND_FROM_EMAIL: "no-reply@nover.space" } }), "email");
  assert.equal(on.state, "ready");
  assert.deepEqual(on.items!.slice(0, 2).map((i) => i.value), ["present", "present"]);
  assert.match(on.summary, /Delivery is proven only by a message arriving/);
});

test("providers are in use exactly when the register's own function says so", () => {
  const env = { GROQ_API_KEY: "g", MISTRAL_API_KEY: "m" };
  const providers = byId(buildStatus({ env }), "providers");
  PROVIDER_REGISTER.forEach((p, i) => {
    assert.equal(providers.items![i].value, activeHere(p, env) ? "in use on this deployment" : "not in use on this deployment", p.provider);
  });
  assert.equal(providers.state, "david", "Resend is a core provider and has no key here");
  assert.match(providers.summary, /Resend/);
});

test("VAT stays with the accountant while Stripe Tax is off", () => {
  const vat = byId(buildStatus({ env: {} }), "vat");
  assert.equal(vat.state, "accountant");
  assert.match(vat.summary, /question 42/);
});

// ------------------------------------------------------------------ Brief tracker

function frameworkTable(): string[][] {
  const doc = read("docs/LEGAL-FRAMEWORK.md");
  const start = doc.indexOf("## Brief section → implementation");
  const end = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, end).split("\n")
    .filter((l) => l.startsWith("| §"))
    .map((l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\*\*/g, "")));
}

test("the tracker lists exactly the sections of the table in docs/LEGAL-FRAMEWORK.md, in order", () => {
  const rows = frameworkTable();
  assert.ok(rows.length >= 17);
  assert.deepEqual(BRIEF_TRACKER.map((r) => r.brief), rows.map((r) => r[0]));
  assert.deepEqual(BRIEF_TRACKER.map((r) => r.statusText), rows.map((r) => r[3]), "the status column, verbatim");
});

test("every § the framework document mentions is covered by the tracker or a tab of its own", () => {
  const covered = new Set([...BRIEF_TRACKER.flatMap((r) => sectionsIn(r.brief)), ...BRIEF_ELSEWHERE.flatMap((e) => sectionsIn(e.brief))]);
  const mentioned = new Set(sectionsIn(read("docs/LEGAL-FRAMEWORK.md")));
  for (const s of mentioned) assert.ok(covered.has(s), `§${s} is mentioned but not tracked`);
  assert.deepEqual(sectionsIn("§8–10, §13–14"), ["8", "9", "10", "13", "14"]);
});

// ------------------------------------------------------------------ Launch gates

test("every ledger row a gate names exists in docs/LAUNCH-READINESS.md", () => {
  const ledger = parseLaunchLedger(read("docs/LAUNCH-READINESS.md"));
  assert.equal(ledger.get("A1")?.owner, "David");
  assert.ok(ledger.get("P3")?.status.startsWith("PASS (offline)"));
  const gates = buildGates({ env: {}, ledger });
  for (const g of gates.filter((x) => x.basis === "stated")) {
    for (const src of g.source) {
      const id = src.replace("docs/LAUNCH-READINESS.md ", "");
      assert.ok(ledger.has(id), `${g.id} names ${id}`);
    }
    assert.ok(!g.detail.includes("no such row"), g.id);
  }
});

test("a gate the code cannot check is ready only where its ledger row says exactly PASS", () => {
  const row = (status: string) => new Map([["O5", { id: "O5", item: "CI", owner: "Code + David", status }], ["O13", { id: "O13", item: "Mail", owner: "David", status: "PASS" }]]);
  assert.equal(byId(buildGates({ env: {}, ledger: row("PASS (ruleset needs correcting)") }), "branch").state, "david");
  assert.equal(byId(buildGates({ env: {}, ledger: row("PASS") }), "branch").state, "ready");
  assert.equal(byId(buildGates({ env: {}, ledger: row("PASS") }), "mailbox").state, "ready");
  const unread = byId(buildGates({ env: {}, ledger: null }), "drafts");
  assert.equal(unread.state, "counsel");
  assert.equal(unread.basis, "stated");
  assert.match(unread.detail, /could not be read/);
});

test("computed gates follow the code: entity, documents, VAT, live billing", () => {
  const gates = buildGates({ env: {}, ledger: null });
  assert.equal(byId(gates, "entity").state, "david");
  assert.equal(byId(gates, "entity").basis, "code");
  assert.equal(byId(gates, "privacy").state, "counsel");
  assert.equal(byId(gates, "lawyer").detail, `0 of ${LEGAL_DOCUMENTS.length} documents approved.`);
  assert.equal(byId(gates, "vat").state, "accountant");
  assert.equal(byId(gates, "live-webhook").state, "david");
  assert.equal(byId(gates, "attestation").basis, "built");
  assert.equal(byId(buildGates({ env: {}, entity: COMPLETE, ledger: null }), "entity").state, "ready");
  assert.ok(gates.some((g) => g.stage === "pilot") && gates.some((g) => g.stage === "paid"));
  assert.equal(new Set(gates.map((g) => g.id)).size, gates.length);
});

// ------------------------------------------------------------------ Decisions

test("every decision quotes its source word for word", () => {
  const squash = (s: string) => s.replace(/\s+/g, " ");
  for (const d of DECISIONS) {
    assert.ok(squash(read(d.source.file)).includes(squash(d.source.quote)), `${d.id}: quote not found in ${d.source.file}`);
  }
  assert.equal(new Set(DECISIONS.map((d) => d.id)).size, DECISIONS.length);
  for (const area of ["commercial", "legal", "operations"]) assert.ok(DECISIONS.some((d) => d.area === area), area);
  const prices = DECISIONS.find((d) => d.id === "prices")!;
  assert.equal(prices.state, "decided");
  assert.match(prices.detail, /not published/);
});

// ------------------------------------------------------------------ Counsel

test("the counsel documents parse into lists, every question its own item", async () => {
  const questions = prepareRepoDoc((await readRepoDoc("counsel"))!);
  assert.equal(questions.title, "Questions for counsel");
  const blocks = parseLegalBody(questions.body);
  const items = blocks.filter((b) => b.kind === "list" && b.ordered).flatMap((b) => (b.kind === "list" ? b.items : []));
  assert.equal(items.length, 42, "42 numbered questions");
  const numbers = blocks.flatMap((b) => (b.kind === "list" && b.ordered ? b.items.map((_, i) => (b.start ?? 1) + i) : []));
  assert.deepEqual([...numbers].sort((a, b) => a - b), Array.from({ length: 42 }, (_, i) => i + 1), "each question keeps its own number");
  for (const key of ["counsel", "inputs"] as const) {
    const body = parseLegalBody(prepareRepoDoc((await readRepoDoc(key))!).body);
    const text = (spans: Array<{ text: string }>) => spans.map((s) => s.text).join("");
    assert.ok(!body.some((b) => b.kind === "paragraph" && /^\d+\. /.test(text(b.spans))), `${key}: a numbered item fell into a paragraph`);
    assert.ok(!body.some((b) => b.kind === "paragraph" && /^# /.test(text(b.spans))), `${key}: the title printed as text`);
  }
  assert.equal(await readRepoDoc("counsel", "/nonexistent-root"), null);
});

test("the files the page reads at request time ship with its function", () => {
  const config = read("next.config.ts");
  for (const file of Object.values(READINESS_DOCS)) assert.ok(config.includes(`"./${file}"`), file);
  assert.match(config, /"\/readiness": \[/);
});

// ------------------------------------------------------------------ staff only

test("only staff may open /readiness, and nothing invites a crawler to it", () => {
  const env = { NOVERA_STAFF_EMAILS: " Staff@Example.com , ops@example.com" };
  assert.deepEqual(staffEmails(env), ["staff@example.com", "ops@example.com"]);
  assert.equal(isStaff("staff@example.com", env), true);
  assert.equal(isStaff("owner@example.com", env), false);
  assert.equal(isStaff(undefined, env), false);
  assert.equal(isStaff("staff@example.com", {}), false, "no list, no staff");

  const page = read("src/app/(app)/readiness/page.tsx");
  const body = page.slice(page.indexOf("export default async function ReadinessPage"));
  const firstStatement = body.slice(body.indexOf("{\n") + 2).trim().split("\n")[0];
  assert.equal(firstStatement, "await requireStaff();", "the staff check comes before anything is computed");
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(read("src/lib/auth/staff.ts"), /if \(!isStaff\(user\.email\)\) redirect\("\/dashboard"\)/);
  assert.match(read("src/components/shell/top-bar.tsx"), /const staff: NavItem\[\] = isStaff\(user\.email\) \? \[\{ href: "\/inbox", label: "Inbox" \}, \{ href: "\/readiness", label: "Readiness" \}\] : \[\];/);

  const rule = robots().rules;
  const disallow = ([] as string[]).concat((Array.isArray(rule) ? rule[0] : rule).disallow ?? []);
  assert.ok(disallow.includes("/readiness"));
});
