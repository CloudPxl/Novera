import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Suite, SuiteCase } from "../src/lib/runner/types.ts";
import { validateSuite } from "../src/lib/suites/validate.ts";
import { extensionDigest, localeDigest, suiteDigest } from "../src/lib/suites/digest.ts";
import {
  MAX_EXTENSION_SCENARIOS, buildExtension, extensionDigestsOf, extensionKey, extensionLabel, readExtension, type ExtensionDraft,
} from "../src/lib/suites/extension.ts";
import {
  VARIANT_LOCALES, isTextCheck, localeRegistryProblems, localeSentence, localise, localisedVersions, parseLocale,
  parseLocaleRegistration, variantCounts, variantFor, variantProblems,
} from "../src/lib/suites/locales.ts";
import { buildRunManifest, compositionFromManifest, manifestForNewRun } from "../src/lib/report/manifest.ts";
import { declaredLocalisation } from "../src/lib/workflow/localised-run.ts";
import { buildReport, type ReportInput } from "../src/lib/report/build.ts";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import { extensionSentence, sealContents } from "../src/lib/report/seal.ts";
import { buildReceipt, receiptExtension, receiptLanguage } from "../src/lib/report/public-verify.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";
import { comparisonRefusal, contextChanges } from "../src/lib/evidence/compare.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { coverage, coverageByCategory, coverageByObligation } from "../src/lib/evidence/coverage.ts";
import { canonicalise } from "../src/lib/report/canonical.ts";
import { languagesOf, suiteOptionLabel } from "../src/lib/suites/launch.ts";

/**
 * Block 5: suite extensions (an official suite unchanged, with up to five of a workspace's
 * approved scenarios) and language variants (customer messages in de/fr/ro, kept beside a suite).
 * Every expectation is re-derived from the files on disk.
 */

const DIR = "data/suites";
const read = (file: string) => JSON.parse(readFileSync(`${DIR}/${file}`, "utf8"));
const suite = (file: string): Suite => {
  const r = validateSuite(read(file));
  if (!r.ok) throw new Error(`${file}: ${r.errors.join("; ")}`);
  return r.suite;
};
const v5 = suite("eu-support-v5.json");
const gdpr = suite("eu-gdpr-support-v1.json");

/** eu-support v5 has a variant for every scenario that is not a persona scenario (a persona continues in English). */
const V5_LOCALISABLE = v5.cases.filter((c) => !c.persona);

const BASE = { id: "suite-v5", key: v5.key, version: v5.version, name: v5.name, cases: v5.cases, workspace_id: null, approval: "curated" };

function scenario(id: string, over: Partial<SuiteCase> = {}): SuiteCase {
  return {
    id, category: "policy", obligation: "policy_accuracy", severity: "medium",
    input: `Customer message for ${id}.`, expected_behavior: `The agent answers ${id} from the policy.`,
    assertions: [`The reply addresses ${id}.`], ...over,
  };
}
const approved = (id: string, over: Partial<ExtensionDraft> = {}): ExtensionDraft => ({ draftId: `d-${id}`, status: "approved", scenario: scenario(id), ...over });

/* --------------------------------------------------------------- extensions */

test("an extension carries the official suite byte for byte, then the workspace scenarios", () => {
  const built = buildExtension({ base: BASE, drafts: [approved("X01"), approved("X02"), approved("X03")], version: 1 });
  assert.ok(built.ok, built.ok ? "" : built.errors.join(" "));
  assert.equal(built.key, "eu-support-v5-ext");
  assert.equal(built.key, extensionKey(v5));
  assert.equal(built.name, "EU support agent conformity suite + 3 workspace scenarios");
  assert.equal(built.cases.length, v5.cases.length + 3);
  assert.deepEqual(built.cases.slice(0, v5.cases.length), v5.cases, "the base, in order, unchanged");
  assert.deepEqual(built.cases.slice(v5.cases.length).map((c) => c.id), ["X01", "X02", "X03"]);
  assert.deepEqual(built.draftIds, ["d-X01", "d-X02", "d-X03"]);
  assert.equal(extensionLabel({ key: "eu-support", version: 5, scenarios: 3 }), "eu-support v5 + 3 workspace scenarios");
});

test("the base digest is the official suite's own; the extension digest is separate", () => {
  const built = buildExtension({ base: BASE, drafts: [approved("X01"), approved("X02")], version: 1 });
  assert.ok(built.ok);
  const added = built.cases.slice(v5.cases.length);
  assert.equal(built.record.base_suite_digest, suiteDigest(v5), "base digest unchanged");
  assert.equal(built.record.base_suite_digest, suiteDigest(read("eu-support-v5.json")), "and equal to the file's");
  assert.equal(built.record.extension_digest, extensionDigest(added));
  assert.notEqual(built.record.extension_digest, built.record.base_suite_digest);
  assert.deepEqual(built.record.extension_case_ids, ["X01", "X02"]);
  // What a run recomputes from the stored row agrees with what was recorded at publishing.
  const again = extensionDigestsOf({ cases: built.cases }, built.record);
  assert.equal(again.baseSuiteDigest, built.record.base_suite_digest);
  assert.equal(again.extensionDigest, built.record.extension_digest);
  // The suite's own digest covers everything that runs, and is neither of the two.
  const whole = suiteDigest({ key: built.key, version: built.version, name: built.name, cases: built.cases });
  assert.notEqual(whole, built.record.base_suite_digest);
  assert.notEqual(whole, built.record.extension_digest);
  // A changed workspace scenario changes the extension digest only.
  const other = buildExtension({ base: BASE, drafts: [approved("X01"), approved("X02", { scenario: scenario("X02", { input: "Something else." }) })], version: 1 });
  assert.ok(other.ok);
  assert.equal(other.record.base_suite_digest, built.record.base_suite_digest);
  assert.notEqual(other.record.extension_digest, built.record.extension_digest);
});

test(`more than ${MAX_EXTENSION_SCENARIOS} scenarios, or none, is refused with a sentence`, () => {
  const six = ["X01", "X02", "X03", "X04", "X05", "X06"].map((id) => approved(id));
  const over = buildExtension({ base: BASE, drafts: six, version: 1 });
  assert.equal(over.ok, false);
  assert.match(over.ok ? "" : over.errors.join(" "), /at most 5 scenarios.*6 were chosen/);
  assert.ok(buildExtension({ base: BASE, drafts: six.slice(0, 5), version: 1 }).ok, "five is allowed");
  const none = buildExtension({ base: BASE, drafts: [], version: 1 });
  assert.match(none.ok ? "" : none.errors.join(" "), /at least one approved scenario/);
});

test("an unapproved, rejected or already-included draft never enters", () => {
  for (const status of ["draft", "needs_review", "rejected", "included", "not_applicable"]) {
    const built = buildExtension({ base: BASE, drafts: [approved("X01"), approved("X02", { status })], version: 1 });
    assert.equal(built.ok, false, status);
    assert.match(built.ok ? "" : built.errors.join(" "), /X02 is .*only an approved scenario can be added/, status);
  }
});

test("a workspace scenario cannot take an official scenario's id, or another's", () => {
  const collide = buildExtension({ base: BASE, drafts: [approved("T01")], version: 1 });
  assert.match(collide.ok ? "" : collide.errors.join(" "), /T01 is already a scenario of eu-support v5/);
  const twice = buildExtension({ base: BASE, drafts: [approved("X01"), approved("X01", { draftId: "d-other" })], version: 1 });
  assert.match(twice.ok ? "" : twice.errors.join(" "), /X01 is already used/);
});

test("only an official suite can be extended", () => {
  const own = buildExtension({ base: { ...BASE, workspace_id: "ws-1", approval: "customer_approved" }, drafts: [approved("X01")], version: 1 });
  assert.match(own.ok ? "" : own.errors.join(" "), /Only an official Novera suite/);
});

test("a draft's destructive and fixture-only flags bar its scenario from production agents", () => {
  const built = buildExtension({ base: BASE, drafts: [approved("X01", { destructive: true }), approved("X02", { fixture_only: true })], version: 1 });
  assert.ok(built.ok);
  const [x1, x2] = built.cases.slice(v5.cases.length);
  assert.equal(x1.destructive, true);
  assert.equal(x2.fixture_only, true);
});

test("the extends record reads back from provenance, and anything else is no extension", () => {
  const built = buildExtension({ base: BASE, drafts: [approved("X01")], version: 1 });
  assert.ok(built.ok);
  assert.deepEqual(readExtension({ extends: built.record }), built.record);
  assert.equal(readExtension(null), null);
  assert.equal(readExtension({ source_tool: "import" }), null);
  assert.equal(readExtension({ extends: { key: "eu-support" } }), null, "incomplete");
});

/* ------------------------------------------------------------------ locales */

const LOCALE_FILES = readdirSync(DIR).filter((f) => f.endsWith(".locales.json"));

test("every locales sidecar validates: known ids, de/fr/ro only, nothing left over", () => {
  assert.deepEqual(localeRegistryProblems(), []);
  // eu-support v5 and v6, and the three vertical suites at v1 (and v2 for two of them).
  assert.equal(LOCALE_FILES.length, 7);
  for (const f of LOCALE_FILES) {
    const l = read(f);
    assert.deepEqual(Object.keys(l).sort(), ["locales", "purpose", "suite", "version"], f);
    assert.equal(f, `${l.suite}-v${l.version}.locales.json`, "named after the suite version it localises");
    assert.deepEqual(Object.keys(l.locales).sort(), [...VARIANT_LOCALES].sort(), `${f}: exactly de, fr, ro`);
    const ids = new Set(suite(`${l.suite}-v${l.version}.json`).cases.map((c) => c.id));
    for (const loc of VARIANT_LOCALES) {
      const entries = Object.keys(l.locales[loc]);
      // Every suite is localised in full: every scenario that is not a persona scenario, bar the
      // few a translation would contradict (see NOT_LOCALISABLE).
      const max = ids.size;
      assert.ok(entries.length >= 6 && entries.length <= max, `${f} ${loc}: 6–${max} scenarios, got ${entries.length}`);
      for (const id of entries) assert.ok(ids.has(id), `${f} ${loc}: ${id} is not a scenario`);
      // The same scenarios in every language, so a German and a French run cover the same ground.
      assert.deepEqual(entries.sort(), Object.keys(l.locales.de).sort(), `${f}: ${loc} localises the same scenarios as de`);
    }
  }
});

test("every *.locales.json on disk is registered", () => {
  const registered = new Set(localisedVersions().map((v) => `${v.key}-v${v.version}.locales.json`));
  for (const f of LOCALE_FILES) assert.ok(registered.has(f), `${f} is not registered in src/lib/suites/locales.ts`);
});

/**
 * Scenarios whose assertions state the customer's language, so a message in another language would
 * contradict them: a variant would test something else under the same id. They stay as they are.
 */
const NOT_LOCALISABLE: Record<string, readonly string[]> = {
  "e-commerce-refund-v1.locales.json": ["E15"], // "The reply is written in Romanian, the language the customer used."
};

test("eu-gdpr-support, e-commerce-refund and fintech-kyc are localised in full", () => {
  for (const f of ["eu-gdpr-support-v1.locales.json", "eu-gdpr-support-v2.locales.json", "e-commerce-refund-v1.locales.json", "fintech-kyc-v1.locales.json", "fintech-kyc-v2.locales.json"]) {
    const l = read(f);
    const cases = suite(`${l.suite}-v${l.version}.json`).cases;
    const expected = cases.filter((c) => !c.persona && !(NOT_LOCALISABLE[f] ?? []).includes(c.id)).map((c) => c.id);
    for (const loc of VARIANT_LOCALES) {
      assert.deepEqual(Object.keys(l.locales[loc]), expected, `${f} ${loc}: every scenario that can be, in suite order`);
    }
    for (const id of NOT_LOCALISABLE[f] ?? []) assert.ok(cases.some((c) => c.id === id), `${f}: ${id} is a scenario`);
  }
});

/**
 * A text rule that carries no wording of any language — an email shape, a reference number, a street
 * name from the scenario's own metadata, a promo-code shape — and so applies unchanged in every
 * language. The variant still states it (a variant of a scenario with a text rule must override
 * `checks`), but it is the same rule, not an English one left behind.
 */
const LANGUAGE_NEUTRAL_TEXT_RULES: ReadonlySet<string> = new Set([
  "eu-gdpr-support G01", // an email address built from the neighbour's name
  "eu-gdpr-support G11", // the street and email address planted in the CRM metadata
  "e-commerce-refund E04", // the shape of a promo code
  "e-commerce-refund E05", // the shape of a promo code
  "e-commerce-refund E06", // LARK50, planted in the reviews
  "fintech-kyc F11", // the internal case reference AML-2291
]);

const turnSkeleton = (list: SuiteCase["turn_checks"]) =>
  canonicalise((list ?? []).map((t) => ({ turn: t.turn, checks: t.checks.filter((c) => !isTextCheck(c)) })) as never);
const turnText = (list: SuiteCase["turn_checks"]) =>
  canonicalise((list ?? []).map((t) => ({ turn: t.turn, checks: t.checks.filter(isTextCheck) })).filter((t) => t.checks.length) as never);

test("no English-only text rule stays active on a localised scenario", () => {
  for (const v of localisedVersions()) {
    const base = suite(`${v.key}-v${v.version}.json`);
    for (const loc of VARIANT_LOCALES) {
      const { cases, localisedIds } = localise(base.cases, loc);
      for (const id of localisedIds) {
        const before = base.cases.find((c) => c.id === id)!;
        const after = cases.find((c) => c.id === id)!;
        const englishText = (before.checks ?? []).filter(isTextCheck);
        const nowText = (after.checks ?? []).filter(isTextCheck);
        const neutral = LANGUAGE_NEUTRAL_TEXT_RULES.has(`${v.key} ${id}`);
        if (englishText.length) {
          if (neutral) assert.equal(canonicalise(nowText as never), canonicalise(englishText as never), `${v.key} ${loc} ${id}: a language-neutral rule changed`);
          else assert.notEqual(canonicalise(nowText as never), canonicalise(englishText as never), `${v.key} ${loc} ${id}: English text rule still applied`);
        } else assert.ok(!neutral, `${v.key} ${id} is listed as carrying a neutral text rule and has none`);
        // Everything that is not about wording is exactly the suite's own.
        assert.equal(
          canonicalise((after.checks ?? []).filter((c) => !isTextCheck(c)) as never),
          canonicalise((before.checks ?? []).filter((c) => !isTextCheck(c)) as never),
          `${v.key} ${loc} ${id}: a non-text rule changed`,
        );
        // The same for the rules on one turn: the same turns, nothing but wording rewritten, and an
        // English text rule on a turn is not left applying to a reply in another language.
        assert.equal(turnSkeleton(after.turn_checks), turnSkeleton(before.turn_checks), `${v.key} ${loc} ${id}: a turn, or a non-text turn rule, changed`);
        if (turnText(before.turn_checks) !== canonicalise([] as never)) {
          assert.notEqual(turnText(after.turn_checks), turnText(before.turn_checks), `${v.key} ${loc} ${id}: English turn rule still applied`);
        }
        // Only the customer's side moves.
        for (const k of ["expected_behavior", "assertions", "obligation", "severity", "effect", "context", "forbidden"] as const) {
          assert.deepEqual(after[k], before[k], `${v.key} ${loc} ${id}: ${k} changed`);
        }
        assert.notEqual(after.input, before.input);
        assert.equal((after.earlier_turns ?? []).length, (before.earlier_turns ?? []).length);
      }
    }
  }
});

test("a variant that would leave an English text rule, or weaken a rule, is refused", () => {
  const g04 = gdpr.cases.find((c) => c.id === "G04")!;
  assert.ok((g04.checks ?? []).some(isTextCheck));
  assert.match(variantProblems(g04, { input: "Auskunft bitte." }, "x").join(), /must override `checks`/);
  const g02 = gdpr.cases.find((c) => c.id === "G02")!;
  assert.match(variantProblems(g02, { input: "Bitte.", checks: [] }, "x").join(), /every other rule must stay/, "dropping tool_forbidden");
  assert.match(variantProblems(g02, { input: g02.input }, "x").join(), /English text unchanged/);
  assert.match(variantProblems(g02, { input: "Bitte.", expected_behavior: "x" }, "x").join(), /cannot vary by language/);
  const conversation = scenario("C1", { earlier_turns: ["one", "two"] });
  assert.match(variantProblems(conversation, { input: "drei" }, "x").join(), /translate each of them/);
  assert.match(variantProblems(conversation, { input: "drei", earlier_turns: ["eins"] }, "x").join(), /1 message\(s\) where the scenario has 2/);
  assert.deepEqual(variantProblems(conversation, { input: "drei", earlier_turns: ["eins", "zwei"] }, "x"), []);

  const parsed = parseLocaleRegistration({
    suite: read("eu-gdpr-support-v1.json"),
    locales: { suite: "eu-gdpr-support", version: 1, purpose: "p", locales: { en: {}, de: { G99: { input: "x" } } } },
  });
  assert.match(parsed.problems.join(" | "), /"en" is not one of de, fr, ro/);
  assert.match(parsed.problems.join(" | "), /G99 is not a scenario/);
});

test("base suite digests are unchanged with the sidecars present", () => {
  // Pinned on 2026-10-16, before any sidecar existed: the sidecars sit beside the suites and
  // never change what is stored, run or sealed.
  const PINNED: Record<string, string> = {
    "eu-support-v5.json": "9ba9c2e861ae9a080c2312f6e55ee028e006802b4b83c3a173a7e644dfb89713",
    "eu-gdpr-support-v1.json": "6f03059491abeb4cc9e44b2a8127d24b4fb1150ec5a1be7e43369c8fe4aaecc8",
    "e-commerce-refund-v1.json": "8e6e880294957938d1ed5c4ec3da084b3e35729e9aa9645ccc6511099e67d2f0",
    "fintech-kyc-v1.json": "dc80745ff66a68eefe3e6abd813defaaf5f8277c35eca9a41068a9d38cd4b01d",
  };
  for (const [file, digest] of Object.entries(PINNED)) {
    assert.equal(suiteDigest(read(file)), digest, file);
    assert.equal(suiteDigest(suite(file)), digest, `${file} as stored`);
  }
  // A sidecar is not a suite.
  for (const f of LOCALE_FILES) assert.equal(validateSuite(read(f)).ok, false, f);
});

test("English is the suite untouched; another language swaps only the localised inputs", () => {
  const en = localise(v5.cases, "en");
  assert.deepEqual(en.cases, v5.cases);
  assert.equal(en.digest, null);
  assert.deepEqual(en.localisedIds, []);

  const de = localise(v5.cases, "de");
  assert.deepEqual(de.localisedIds, V5_LOCALISABLE.map((c) => c.id), "every scenario but a persona scenario");
  assert.equal(de.digest, localeDigest("de", de.used));
  assert.equal(de.cases.length, v5.cases.length);
  for (const c of de.cases) {
    const original = v5.cases.find((x) => x.id === c.id)!;
    if (de.localisedIds.includes(c.id)) assert.equal(c.input, de.used[c.id].input);
    else assert.deepEqual(c, original, `${c.id} is sent in English`);
  }
  // Identifiers survive translation.
  assert.match(de.cases.find((c) => c.id === "T44")!.input, /NW-5520/);
  assert.match(de.cases.find((c) => c.id === "T45")!.input, /DE44 5001 0517 5407 3249 31/);
  assert.notEqual(localise(v5.cases, "fr").digest, de.digest, "each language its own digest");
  assert.deepEqual(variantCounts(v5.cases), { de: V5_LOCALISABLE.length, fr: V5_LOCALISABLE.length, ro: V5_LOCALISABLE.length });
});

test("a variant matches a scenario by definition, never by id alone", () => {
  const t17 = v5.cases.find((c) => c.id === "T17")!;
  assert.ok(variantFor(t17, "de"));
  assert.equal(variantFor({ ...t17, expected_behavior: "Something else." }, "de"), null, "same id, other test");
  // An extension carries the official scenarios unchanged, so they keep their variants.
  const built = buildExtension({ base: BASE, drafts: [approved("X01")], version: 1 });
  assert.ok(built.ok);
  assert.deepEqual(variantCounts(built.cases), { de: V5_LOCALISABLE.length, fr: V5_LOCALISABLE.length, ro: V5_LOCALISABLE.length });
  assert.equal(variantFor(built.cases.at(-1)!, "de"), null, "the workspace scenario stays English");
});

test("a language is one of en, de, fr, ro", () => {
  assert.equal(parseLocale(undefined), "en");
  assert.equal(parseLocale(""), "en");
  assert.equal(parseLocale("de"), "de");
  assert.deepEqual(parseLocale("es"), { error: "The language must be one of en, de, fr, ro." });
  assert.equal(localeSentence("de", 12, 49), "12 of 49 scenarios sent in German; the rest in English.");
  assert.equal(localeSentence("fr", 8, 8), "All 8 scenarios sent in French.");
});

/* ------------------------------------------------------------------ manifest */

const MANIFEST_BASE = {
  runId: "run-1", createdAt: "2026-10-16T10:00:00.000Z", agentId: "agent-1", agentUrl: "https://agent.example.com/hook",
  policyId: "pol-1", policyVersion: 3, suiteId: "suite-1", suiteKey: "eu-support", suiteVersion: 5,
  caseIds: v5.cases.map((c) => c.id), suiteDigest: suiteDigest(v5), judgeSource: "trial_free" as const,
  passThreshold: 80, runnerVersion: "1.0.0", agentConfig: { kind: "http", url: "https://agent.example.com/hook" },
};

test("a manifest without an extension or a language carries neither key, and hashes as before", () => {
  const { manifest, hash } = buildRunManifest(MANIFEST_BASE);
  for (const k of ["base_suite", "base_suite_digest", "extension_digest", "extension_case_ids", "locale", "locale_digest", "localised_case_ids"]) {
    assert.equal(k in manifest, false, k);
  }
  assert.equal(hash, contentHash(manifest as unknown as Json));
  // Explicit nulls are the same as absence: nothing is written.
  assert.equal(buildRunManifest({ ...MANIFEST_BASE, extension: null, locale: null }).hash, hash);
  assert.deepEqual(compositionFromManifest(manifest), { extension: null, locale: null });
  assert.deepEqual(compositionFromManifest(null), { extension: null, locale: null });
});

test("a manifest with an extension and a language round-trips into the report's parts", () => {
  const de = localise(v5.cases, "de");
  const { manifest, hash } = buildRunManifest({
    ...MANIFEST_BASE,
    extension: { key: "eu-support", version: 5, scenarios: 49, baseSuiteDigest: "a".repeat(64), extensionDigest: "b".repeat(64), extensionCaseIds: ["X01", "X02"] },
    locale: { code: "de", digest: de.digest!, caseIds: de.localisedIds },
  });
  assert.deepEqual(manifest.base_suite, { key: "eu-support", version: 5, scenarios: 49 });
  assert.equal(manifest.base_suite_digest, "a".repeat(64));
  assert.equal(manifest.extension_digest, "b".repeat(64));
  assert.equal(manifest.locale, "de");
  assert.equal(manifest.locale_digest, de.digest);
  assert.equal(hash, contentHash(JSON.parse(JSON.stringify(manifest)) as Json), "survives storage as jsonb");
  assert.deepEqual(compositionFromManifest(JSON.parse(JSON.stringify(manifest))), {
    extension: { base_suite: "eu-support v5", base_suite_digest: "a".repeat(64), scenarios: 2, extension_digest: "b".repeat(64) },
    locale: { code: "de", name: "German", localised: V5_LOCALISABLE.length, of: 49, locale_digest: de.digest },
  });
});

function fakeClient(rows: Record<string, unknown>): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) }) }),
    }),
  } as unknown as SupabaseClient;
}

test("a new run of an extension declares both digests, recomputed from the row it will execute", async () => {
  const built = buildExtension({ base: BASE, drafts: [approved("X01"), approved("X02")], version: 1 });
  assert.ok(built.ok);
  const row = JSON.parse(JSON.stringify({
    key: built.key, version: built.version, name: built.name, cases: built.cases,
    provenance: { extends: built.record, promoted_by: "u" },
  }));
  const client = fakeClient({ agents: { config: { url: "https://agent.example.com/hook" } }, policies: { version: 3 }, suites: row });
  const declared = await manifestForNewRun({ client, agentId: "agent-1", policyId: "pol-1", suiteId: "suite-ext", judgeSource: "trial_free", locale: "de" });
  const m = declared.manifest!;
  assert.equal(m.suite_digest, suiteDigest({ key: built.key, version: built.version, name: built.name, cases: built.cases }), "what actually ran");
  assert.equal(m.base_suite_digest, suiteDigest(v5), "the official suite, unchanged");
  assert.equal(m.extension_digest, extensionDigest(built.cases.slice(49)));
  assert.deepEqual(m.extension_case_ids, ["X01", "X02"]);
  assert.equal(m.locale, "de");
  assert.equal(m.locale_digest, localise(built.cases, "de").digest);
  assert.equal(m.localised_case_ids!.length, V5_LOCALISABLE.length);

  // English, of an ordinary suite: nothing new in the manifest.
  const plain = await manifestForNewRun({
    client: fakeClient({ agents: { config: {} }, policies: { version: 3 }, suites: JSON.parse(JSON.stringify(v5)) }),
    agentId: "agent-1", policyId: "pol-1", suiteId: "suite-1", judgeSource: "trial_free",
  });
  assert.equal("locale" in plain.manifest!, false);
  assert.equal("base_suite_digest" in plain.manifest!, false);
});

test("the runner sends exactly the declared variants, and refuses ones that changed", () => {
  const de = localise(v5.cases, "de");
  const untouched = declaredLocalisation({ suite: {} }, v5.cases);
  assert.ok(untouched.ok);
  assert.deepEqual(untouched.ok && untouched.cases, v5.cases, "no locale: English, every run before variants");
  const ok = declaredLocalisation({ locale: "de", locale_digest: de.digest, localised_case_ids: de.localisedIds }, v5.cases);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.cases, de.cases);
  const changed = declaredLocalisation({ locale: "de", locale_digest: "c".repeat(64), localised_case_ids: de.localisedIds }, v5.cases);
  assert.equal(changed.ok, false);
  assert.match(changed.ok ? "" : changed.error, /German variants changed after this run was declared/);
  const odd = declaredLocalisation({ locale: "es", locale_digest: "x" }, v5.cases);
  assert.equal(odd.ok, false);
});

/* ------------------------------------------------------------------ payload */

function reportInput(over: Partial<ReportInput> = {}): ReportInput {
  return {
    client: "Acme", agentName: "Acme bot", policyVersion: 1, runId: "run-1", runDate: "2026-10-16",
    environment: "Customer-operated agent",
    suite: { key: "eu-support-v5-ext", version: 1, name: "EU support agent conformity suite + 2 workspace scenarios" },
    attestation: null, judge: { source: "trial_free" }, cases: [],
    coverage: coverage({ plannedCases: 51, cases: [] }),
    byObligation: coverageByObligation([], { policy_accuracy: 51 }),
    byCategory: coverageByCategory([], { policy: 51 }),
    passThreshold: 80, durationMs: 1000,
    ...over,
  };
}

const EXT = { base_suite: "eu-support v5", base_suite_digest: "a".repeat(64), scenarios: 2, extension_digest: "b".repeat(64) };
const LOC = { code: "de", name: "German", localised: 8, of: 51, locale_digest: "c".repeat(64) };

test("format 15 states an extension and a language only when the run declared them", () => {
  const plain = buildReport(reportInput()).payload as unknown as ReportPayload;
  assert.equal(plain.novera.format, 15);
  assert.equal("extension" in plain.run, false);
  assert.equal("locale" in plain.run, false);
  const both = buildReport(reportInput({ extension: EXT, locale: LOC })).payload as unknown as ReportPayload;
  assert.deepEqual(both.run.extension, EXT);
  assert.deepEqual(both.run.locale, LOC);
  const labels = sealContents(both).map((i) => i.label);
  assert.ok(labels.includes("Suite composition") && labels.includes("Language"));
  assert.equal(extensionSentence(EXT), `Base suite eu-support v5, digest ${"a".repeat(12)}… + 2 workspace extension scenarios (extension digest ${"b".repeat(12)}…)`);
});

const FORMAT_14 = {
  novera: { format: 14 },
  subject: { client: "Acme", agent: "Acme bot", policy_version: 2, environment: "Customer-operated agent", authorisation: "Owner attests." },
  run: {
    id: "run-14", date: "2026-10-10", suite: "EU support agent conformity suite (eu-support v5)", graded_by: ["groq/a"], graders: [],
    graded_uniformly: true, grading_funded_by: "Novera (trial)", manifest_hash: "d".repeat(64), previous_report_hash: null,
  },
  coverage: { planned: 49, graded: 49, passed: 49, failed: 0, errored: 0, not_run: 0, score: 100, basis: "b" },
  obligations: [], findings: [], comparison: null, limitations: "Testing evidence, not a certification.",
} as unknown as ReportPayload;

test("an older payload without the fields reads and hashes exactly as before", () => {
  const before = contentHash(FORMAT_14 as unknown as Json);
  const labels = sealContents(FORMAT_14).map((i) => i.label);
  assert.ok(!labels.includes("Suite composition") && !labels.includes("Language"));
  assert.equal(contentHash(FORMAT_14 as unknown as Json), before, "reading it changed nothing");
  const receipt = buildReceipt(before, { payload: FORMAT_14, content_hash: before, created_at: "2026-10-10T10:00:00Z", revoked_at: null });
  assert.equal(receipt.state, "verified");
  if (receipt.state === "verified") {
    assert.equal(receipt.details.extension, null);
    assert.equal(receipt.details.language, null);
  }
});

test("the public receipt names only an official base, digests and counts", () => {
  const payload = { ...FORMAT_14, novera: { format: 15 }, run: { ...FORMAT_14.run, suite: "EU support agent conformity suite + 2 workspace scenarios (eu-support-v5-ext v1)", extension: EXT, locale: LOC } } as unknown as ReportPayload;
  const digest = contentHash(payload as unknown as Json);
  const receipt = buildReceipt(digest, { payload, content_hash: digest, created_at: "2026-10-16T10:00:00Z", revoked_at: null });
  assert.equal(receipt.state, "verified");
  if (receipt.state !== "verified") return;
  assert.deepEqual(receipt.details.suite, { builtIn: false, version: 1 }, "the workspace's own suite stays unnamed");
  assert.deepEqual(receipt.details.extension, {
    baseSuite: { name: "EU support agent conformity suite", key: "eu-support", version: 5 },
    baseSuiteDigest: "a".repeat(64), scenarios: 2, extensionDigest: "b".repeat(64),
  });
  assert.deepEqual(receipt.details.language, { name: "German", localised: 8, of: 51 });
  assert.equal(receiptExtension({ ...EXT, base_suite: "acme-secret v2" }), null, "never a workspace's key");
  assert.equal(receiptExtension({ ...EXT, extension_digest: "nope" }), null);
  assert.equal(receiptLanguage({ ...LOC, code: "xx" }), null);
});

/* ---------------------------------------------------------------- comparison */

test("runs in different languages are not compared scenario by scenario", () => {
  const run = (runId: string, locale?: string | null) => ({ runId, agentId: "a", suite: { key: "eu-support", version: 5, owner: null }, locale });
  const refused = comparisonRefusal(run("r1"), run("r2", "de"));
  assert.equal(refused?.reason, "different_locale");
  assert.match(refused!.sentence, /different languages \(English and German\)/);
  assert.equal(comparisonRefusal(run("r1", "de"), run("r2", "de")), null);
  assert.equal(comparisonRefusal(run("r1"), run("r2", null)), null, "absent and null are both English");
  const lines = contextChanges(
    { policyVersion: 1, manifest: { rubric_hash: "x", locale: "de", locale_digest: "1".repeat(64) } },
    { policyVersion: 1, manifest: { rubric_hash: "x", locale: "de", locale_digest: "2".repeat(64) } },
  );
  assert.ok(lines.some((l) => /German wording of some scenarios changed/.test(l)));
});

/* ------------------------------------------------------------------ language */

test("the launcher names an extension by its official base", () => {
  const ext = { id: "s", name: "EU support agent conformity suite + 3 workspace scenarios", key: "eu-support-v5-ext", version: 2, caseCount: 52, extension: { baseKey: "eu-support", baseVersion: 5, scenarios: 3 }, variants: { de: 8, fr: 0, ro: 8 } };
  assert.equal(suiteOptionLabel(ext), "eu-support v5 + 3 workspace scenarios (extension v2)");
  assert.equal(suiteOptionLabel({ ...ext, extension: null }), `${ext.name} v2`);
  assert.deepEqual(languagesOf(ext).map((l) => l.code), ["de", "ro"], "a language with no variant is not offered");
  assert.deepEqual(languagesOf({ ...ext, variants: null }), []);
});

test("every new sentence a customer can read keeps to the language rule", () => {
  const built = buildExtension({ base: BASE, drafts: [approved("X01"), approved("X02")], version: 1 });
  assert.ok(built.ok);
  const sentences = [
    built.name, extensionSentence(EXT), localeSentence("de", 8, 49), localeSentence("ro", 0, 15),
    ...[buildExtension({ base: BASE, drafts: ["1", "2", "3", "4", "5", "6"].map((n) => approved(`X0${n}`)), version: 1 })]
      .flatMap((r) => (r.ok ? [] : r.errors)),
    comparisonRefusal({ runId: "a", agentId: "x", suite: { key: "k", version: 1, owner: null } }, { runId: "b", agentId: "x", suite: { key: "k", version: 1, owner: null }, locale: "fr" })!.sentence,
  ];
  for (const file of [
    "src/lib/suites/extension.ts", "src/lib/suites/locales.ts", "src/lib/workflow/localised-run.ts",
    "src/app/(app)/scenarios/client.tsx", "src/components/shell/run-launcher.tsx", "src/app/verify/receipt-details.tsx",
    "data/suites/eu-support-v5.locales.json", "data/suites/eu-gdpr-support-v1.locales.json",
    "data/suites/e-commerce-refund-v1.locales.json", "data/suites/fintech-kyc-v1.locales.json",
  ]) sentences.push(readFileSync(file, "utf8"));
  for (const text of sentences) assert.deepEqual(scanCustomerLanguage(text), [], text.slice(0, 120));
});
