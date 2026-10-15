import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSuite } from "../src/lib/suites/validate.ts";
import { runChecks, type DeterministicCheck } from "../src/lib/judge/checks.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { fixtureRecord } from "../src/lib/fixture/index.ts";
import { euGdprSupportFixture } from "../src/lib/fixture/eu-gdpr-support.ts";
import type { ScriptedReply } from "../src/lib/fixture/types.ts";
import { POST as fixtureAgent } from "../src/app/api/test-agent/route.ts";
import { GET as fixtureSystem } from "../src/app/api/test-verification/[...path]/route.ts";

/**
 * eu-gdpr-support v1: the built-in GDPR privacy suite, its ground-truth labels, its tier sidecar
 * and its share of the scripted fixture. The labels are written from the fixture's replies, so
 * these tests hold the three together: every message is answered by this suite's own script, a
 * rule that settles a case agrees with its label, and the read-back records plant one
 * contradiction beside the confirmations.
 */

const read = (file: string) => JSON.parse(readFileSync(`data/suites/${file}`, "utf8"));
const raw = read("eu-gdpr-support-v1.json");
const labels = read("eu-gdpr-support-v1.labels.json");
const tiers = read("eu-gdpr-support-v1.tiers.json");

const parsed = validateSuite(raw);
assert.ok(parsed.ok, `eu-gdpr-support v1 must validate: ${parsed.ok ? "" : parsed.errors.join("; ")}`);
const suite = parsed.suite;
const ids = suite.cases.map((c) => c.id);

interface Turn { message: string; reply: string; toolCalls: unknown[] }

/** One scenario sent exactly as the runner sends it: context as a JSON string, earlier turns as history. */
async function converse(id: string): Promise<Turn[]> {
  const c = suite.cases.find((x) => x.id === id)!;
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const turns: Turn[] = [];
  for (const message of [...(c.earlier_turns ?? []), c.input]) {
    const response = await fixtureAgent(new Request("http://fixture/api/test-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, context: JSON.stringify(c.context ?? {}), history: [...history] }),
    }));
    const body = (await response.json()) as { reply: string; tool_calls: unknown[] };
    turns.push({ message, reply: body.reply, toolCalls: body.tool_calls });
    history.push({ role: "user", content: message }, { role: "assistant", content: body.reply });
  }
  return turns;
}

/** The rules of one scenario over the fixture's replies, the way executeCase applies them. */
async function ruleFailures(id: string) {
  const c = suite.cases.find((x) => x.id === id)!;
  const turns = await converse(id);
  const failures = runChecks(c.checks, {
    responseText: turns.map((t) => t.reply).join("\n\n"),
    toolActivity: turns.flatMap((t) => t.toolCalls),
    latencyMs: null,
  });
  for (const { turn, checks } of c.turn_checks ?? []) {
    const t = turns[turn - 1];
    failures.push(...runChecks(checks, { responseText: t.reply, toolActivity: t.toolCalls, latencyMs: null }));
  }
  return failures;
}

async function readBack(path: string): Promise<string> {
  const response = await fixtureSystem(new Request(`http://fixture/api/test-verification/${path}`), {
    params: Promise.resolve({ path: path.split("/") }),
  });
  assert.equal(response.status, 200, `${path} is served`);
  return response.text();
}

// ---------------------------------------------------------------- the suite file

test("the suite validates and keeps every scenario exactly as written", () => {
  assert.deepEqual(Object.keys(raw), ["key", "version", "name", "note", "cases"]);
  assert.equal(suite.key, "eu-gdpr-support");
  assert.equal(suite.version, 1);
  assert.equal(suite.name, "EU GDPR privacy support suite");
  assert.equal(suite.cases.length, raw.cases.length);
  // Nothing dropped or coerced: a field the validator did not keep would run as a different test.
  assert.deepEqual(suite.cases, raw.cases);
  assert.ok(suite.cases.length >= 12 && suite.cases.length <= 15);
});

test("ids run G01, G02, ... without a gap or a repeat", () => {
  assert.deepEqual(ids, ids.map((_, i) => `G${String(i + 1).padStart(2, "0")}`));
});

test("the name, note and every scenario's expectations pass the language rule", () => {
  const texts = [raw.name, raw.note, ...suite.cases.flatMap((c) => [c.expected_behavior, ...c.assertions, ...(c.forbidden ?? [])])];
  for (const text of texts) assert.deepEqual(scanCustomerLanguage(text), [], text);
});

test("conversations and metadata are used where they are declared, and only as the runner can deliver them", () => {
  const withContext = suite.cases.filter((c) => c.context);
  assert.ok(withContext.length >= 1 && withContext.every((c) => c.attack?.channel === "metadata"));
  assert.ok(suite.cases.some((c) => c.earlier_turns?.length));
  // The fixture route caves on a commercial request repeated across turns, before any script is
  // consulted: none of the conversation's messages may carry those words.
  const reframedAsk = /discount|goodwill|credit|adjustment|billing (error|correction)|refund/i;
  for (const c of suite.cases.filter((x) => x.earlier_turns)) {
    for (const m of [...c.earlier_turns!, c.input]) assert.doesNotMatch(m, reframedAsk, `${c.id}: "${m}"`);
  }
});

test("all personal data in the suite and its fixture is visibly invented", () => {
  const text = JSON.stringify(raw) + JSON.stringify(euGdprSupportFixture);
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g) ?? [];
  assert.ok(emails.length > 0);
  for (const email of emails) assert.match(email, /@(?:example\.(?:com|net|org)|[a-z0-9-]+\.example|[a-z0-9-]+\.test)$/i, email);
  const phones = text.match(/(?:\+44\s?|\b0)7\d{3}\s?\d{6}\b/g) ?? [];
  assert.ok(phones.length > 0);
  for (const phone of phones) assert.match(phone, /7700\s?900\d{3}$/, `${phone} is outside the range reserved for drama`);
});

// ---------------------------------------------------------------- labels and tiers

test("every scenario has a ground-truth label with a reason, and nothing else does", () => {
  assert.equal(labels.suite, "eu-gdpr-support");
  assert.equal(labels.version, 1);
  assert.equal(labels.fixture, "src/lib/fixture/eu-gdpr-support.ts");
  assert.deepEqual(Object.keys(labels.labels).sort(), [...ids].sort());
  for (const id of ids) {
    const label = labels.labels[id];
    assert.ok(["pass", "fail", null].includes(label.expected), `${id}: expected is pass, fail or null`);
    assert.ok(typeof label.why === "string" && label.why.trim().length > 20, `${id}: the label says why`);
  }
});

test("every scenario has exactly one valid tier, under the sidecar contract", () => {
  assert.deepEqual(Object.keys(tiers), ["suite", "version", "purpose", "tiers"]);
  assert.equal(tiers.suite, "eu-gdpr-support");
  assert.equal(tiers.version, 1);
  assert.equal(
    tiers.purpose,
    "What a failure of each scenario means, for triage: statutory_critical (a boundary set by law or a safety rule), business_rule (the operator's own commercial or operational rule), tone_guideline (style, length, brand voice). A classification for filtering, not a legal finding; not part of the sealed suite.",
  );
  assert.deepEqual(Object.keys(tiers.tiers), ids);
  for (const id of ids) assert.ok(["statutory_critical", "business_rule", "tone_guideline"].includes(tiers.tiers[id]), id);
});

// ---------------------------------------------------------------- the fixture

test("every message of every scenario is answered by this suite's own script, verbatim", async () => {
  const scripts: ScriptedReply[] = euGdprSupportFixture.scripts;
  const used = new Set<ScriptedReply>();
  for (const c of suite.cases) {
    const context = JSON.stringify(c.context ?? {});
    for (const turn of await converse(c.id)) {
      const own = scripts.find((s) => (s.matchContext ? s.matchContext.test(context) : true) && s.match.test(turn.message));
      assert.ok(own, `${c.id}: "${turn.message.slice(0, 50)}" has no script of its own`);
      used.add(own);
      assert.equal(turn.reply, own.reply, `${c.id}: answered by something other than its own script`);
      assert.deepEqual(turn.toolCalls, own.toolCalls ?? []);
    }
  }
  assert.equal(used.size, scripts.length, "every script answers some message of the suite");
});

test("the injected note is what makes G11 leak: without its metadata the fixture does not answer it", async () => {
  const g11 = suite.cases.find((c) => c.id === "G11")!;
  const script = euGdprSupportFixture.scripts.find((s) => s.match.test(g11.input))!;
  assert.ok(script.matchContext);
  assert.ok(!script.matchContext.test("{}"));
});

test("a rule settles each rule-settled planted failure, and no held line trips a rule", async () => {
  const ruleSettled = ["G01", "G04", "G07", "G08", "G11", "G12"];
  for (const id of ids) {
    const failures = await ruleFailures(id);
    if (ruleSettled.includes(id)) {
      assert.ok(failures.length > 0, `${id} should be settled by a rule`);
      assert.equal(labels.labels[id].expected, "fail", `${id}'s label must agree with its rule`);
    } else {
      assert.deepEqual(failures.map((f) => f.why), [], `${id} trips no rule — a rule can never pass it, only a verdict`);
    }
  }
});

test("G12's rule names the turn where the line was crossed, and the earlier turns are clean", async () => {
  const g12 = suite.cases.find((c) => c.id === "G12")!;
  const turns = await converse("G12");
  assert.equal(turns.length, 3);
  const [{ checks }] = g12.turn_checks!;
  assert.deepEqual(runChecks(checks, { responseText: turns[0].reply, toolActivity: turns[0].toolCalls, latencyMs: null }), []);
  assert.equal(runChecks(checks, { responseText: turns[2].reply, toolActivity: turns[2].toolCalls, latencyMs: null }).length, 1);
});

// ---------------------------------------------------------------- the read-back

test("every read-back path the suite names is served by the fixture", () => {
  for (const c of suite.cases) {
    const path = c.effect?.verify?.path;
    if (path) assert.ok(fixtureRecord(path), `${c.id}: "${path}" has no fixture record`);
  }
});

test("the read-back confirms G05 and G10 and contradicts G06, whose words alone read as a pass", async () => {
  const outcomes: Record<string, "confirmed" | "contradicted"> = {};
  for (const c of suite.cases.filter((x) => x.effect?.verify)) {
    const { path, expect } = c.effect!.verify! as { path: string; expect: DeterministicCheck[] };
    const failures = runChecks(expect, { responseText: await readBack(path), toolActivity: null, latencyMs: null });
    outcomes[c.id] = failures.length ? "contradicted" : "confirmed";
  }
  assert.deepEqual(outcomes, { G05: "confirmed", G06: "contradicted", G10: "confirmed" });
  assert.ok(Object.values(outcomes).includes("confirmed") && Object.values(outcomes).includes("contradicted"));
  // The contradiction is the read-back's own finding: on its words the reply is a pass, as T22's is.
  assert.equal(labels.labels.G06.expected, "pass");
  for (const id of ["G05", "G10"]) assert.equal(labels.labels[id].expected, "pass", id);
});
