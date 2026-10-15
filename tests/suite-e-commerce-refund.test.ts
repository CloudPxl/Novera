import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSuite } from "../src/lib/suites/validate.ts";
import { TIERS } from "../src/lib/suites/tiers.ts";
import { runChecks } from "../src/lib/judge/checks.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { fixtureRecord } from "../src/lib/fixture/index.ts";
import { eCommerceRefundFixture } from "../src/lib/fixture/e-commerce-refund.ts";
import { POST as fixtureAgent } from "../src/app/api/test-agent/route.ts";
import { GET as fixtureSystem } from "../src/app/api/test-verification/[...path]/route.ts";

/**
 * e-commerce-refund v1: the built-in refunds and withdrawal suite, its ground-truth labels, its
 * tier sidecar and its share of the scripted fixture. The labels are written from the fixture's
 * replies, so these tests hold the four together: every message gets this suite's own reply (or
 * the route's, where the conversation is meant to reach it), a rule that settles a case agrees
 * with its label, and the read-back plants a contradiction beside a confirmation.
 */

const read = (file: string) => JSON.parse(readFileSync(`data/suites/${file}`, "utf8"));
const raw = read("e-commerce-refund-v1.json");
const labels = read("e-commerce-refund-v1.labels.json");
const tiers = read("e-commerce-refund-v1.tiers.json");

const parsed = validateSuite(raw);
assert.ok(parsed.ok, `e-commerce-refund v1 must validate: ${parsed.ok ? "" : parsed.errors.join("; ")}`);
const suite = parsed.suite;
const ids = suite.cases.map((c) => c.id);
const byId = (id: string) => suite.cases.find((c) => c.id === id)!;

interface Turn { message: string; reply: string; toolCalls: unknown[] }

async function ask(message: string, context: Record<string, string> | undefined, history: Array<{ role: string; content: string }>) {
  const response = await fixtureAgent(new Request("http://fixture/api/test-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, context: JSON.stringify(context ?? {}), history }),
  }));
  return (await response.json()) as { reply: string; tool_calls: unknown[] };
}

/** One scenario sent exactly as the runner sends it: context as a JSON string, earlier turns as history. */
async function converse(id: string): Promise<Turn[]> {
  const c = byId(id);
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const turns: Turn[] = [];
  for (const message of [...(c.earlier_turns ?? []), c.input]) {
    const body = await ask(message, c.context, [...history]);
    turns.push({ message, reply: body.reply, toolCalls: body.tool_calls });
    history.push({ role: "user", content: message }, { role: "assistant", content: body.reply });
  }
  return turns;
}

/** Every rule of one scenario over the fixture's replies, the way executeCase applies them. */
async function ruleFailures(id: string) {
  const c = byId(id);
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
  assert.equal(response.status, 200, path);
  return response.text();
}

// ---------------------------------------------------------------- the suite file

test("the suite validates and keeps every scenario, under its catalogue name", () => {
  assert.equal(suite.cases.length, raw.cases.length);
  assert.equal(suite.key, "e-commerce-refund");
  assert.equal(suite.version, 1);
  assert.equal(suite.name, "E-commerce refunds and withdrawal suite");
  assert.deepEqual(Object.keys(raw).sort(), ["cases", "key", "name", "note", "version"]);
});

test("ids run E01 onwards, unique and without gaps", () => {
  assert.ok(ids.length >= 12 && ids.length <= 15, `${ids.length} scenarios`);
  assert.deepEqual(ids, ids.map((_, i) => `E${String(i + 1).padStart(2, "0")}`));
});

test("the name and note make no claim the language rule refuses", () => {
  assert.deepEqual(scanCustomerLanguage(`${raw.name}\n${raw.note}`), []);
});

test("every scenario cites its duties in the house style, or none", () => {
  for (const c of suite.cases) {
    for (const ref of c.duty_refs ?? []) {
      assert.match(ref, /^(EU AI Act Art\. \d+(\(\d+\))?|Directive (\(EU\) \d{4}\/\d+|\d{4}\/\d+\/(EU|EC)) (Art\. \d+(\(\d+\))?(\([a-z]\))?|Annex I point \d+))$/, `${c.id}: ${ref}`);
    }
    assert.match(c.obligation, /^[a-z]+(_[a-z]+)*$/, c.id);
  }
});

// ---------------------------------------------------------------- labels and tiers

test("every scenario has a ground-truth label with its reason, and nothing else does", () => {
  assert.equal(labels.suite, "e-commerce-refund");
  assert.equal(labels.version, 1);
  assert.equal(labels.fixture, "src/lib/fixture/e-commerce-refund.ts");
  assert.deepEqual(Object.keys(labels.labels).sort(), [...ids].sort());
  for (const id of ids) {
    const label = labels.labels[id];
    assert.ok(label.expected === "pass" || label.expected === "fail" || label.expected === null, id);
    assert.ok(typeof label.why === "string" && label.why.trim().length > 20, `${id} needs a reason`);
  }
});

test("every scenario is tiered exactly once, with a known tier, and the mix is real", () => {
  assert.equal(tiers.suite, "e-commerce-refund");
  assert.equal(tiers.version, 1);
  assert.ok(typeof tiers.purpose === "string" && tiers.purpose.trim());
  assert.deepEqual(Object.keys(tiers.tiers).sort(), [...ids].sort());
  for (const id of ids) assert.ok((TIERS as readonly string[]).includes(tiers.tiers[id]), `${id}: ${tiers.tiers[id]}`);
  const used = new Set(Object.values(tiers.tiers));
  assert.ok(used.has("statutory_critical") && used.has("business_rule"), "both legal and business-rule scenarios");
});

// ---------------------------------------------------------------- the fixture

test("every message gets this suite's own scripted reply, never another suite's", async () => {
  const own = new Set(eCommerceRefundFixture.scripts.map((s) => s.reply));
  for (const c of suite.cases) {
    // E08's later turns are answered by the route's REFRAMED_ASK once the history arrives (next test).
    const turns = c.id === "E08" ? [(await converse(c.id))[0]] : await converse(c.id);
    for (const t of turns) assert.ok(own.has(t.reply), `${c.id}: "${t.message.slice(0, 50)}" got "${t.reply.slice(0, 60)}"`);
  }
  // Sent alone, as the calibration harness sends it, E08's last message is still this suite's.
  assert.ok(own.has((await ask(byId("E08").input, undefined, [])).reply));
});

test("E08 holds twice and caves on the third reframing, which only its rules and history show", async () => {
  const turns = await converse("E08");
  assert.equal(turns.length, 3);
  assert.deepEqual(turns[0].toolCalls, []);
  assert.match(turns[1].reply, /can't approve a credit/);
  assert.match(turns[2].reply, /applied the credit/);
  const failures = await ruleFailures("E08");
  assert.deepEqual(failures.map((f) => (f.check as { tool?: string }).tool), ["apply_credit"]);
});

test("a rule that settles a case agrees with its label; a line the fixture holds trips none", async () => {
  for (const id of ["E04", "E06", "E08"]) {
    assert.ok((await ruleFailures(id)).length > 0, `${id} is settled by a rule`);
    assert.equal(labels.labels[id].expected, "fail", id);
  }
  for (const id of ids.filter((x) => labels.labels[x].expected === "pass")) {
    assert.deepEqual(await ruleFailures(id), [], `${id} is labelled pass, so no rule may fail it`);
  }
});

test("the code rule catches an invented code and leaves an ordinary reply alone", () => {
  const rule = byId("E04").checks!;
  const run = (text: string) => runChecks(rule, { responseText: text, toolActivity: null, latencyMs: null });
  for (const code of ["Use WELCOME20 at checkout", "try SAVE-15", "LARKSPUR10 works"]) assert.equal(run(code).length, 1, code);
  for (const fine of ["Order LK-30418 ships in 3 days.", "No codes are running; offers are listed on our Offers page.", "Refunds within 14 days, 20% off nothing."]) {
    assert.deepEqual(run(fine), [], fine);
  }
});

// ---------------------------------------------------------------- the read-back

test("every read-back path is served by the fixture", () => {
  const paths = suite.cases.map((c) => c.effect?.verify?.path).filter((p): p is string => Boolean(p));
  assert.ok(paths.length >= 2 && paths.length <= 4, `${paths.length} read-back scenarios`);
  for (const path of paths) assert.ok(fixtureRecord(path), path);
});

test("the system of record contradicts E09's refund and confirms E10's partial refund", async () => {
  const outcome = async (id: string) => {
    const verify = byId(id).effect!.verify!;
    const failures = runChecks(verify.expect, { responseText: await readBack(verify.path!), toolActivity: null, latencyMs: null });
    return failures.length === 0 ? "confirmed" : "contradicted";
  };
  assert.equal(await outcome("E09"), "contradicted", "the fixture says it issued the refund; the record says not_issued");
  assert.equal(await outcome("E10"), "confirmed");
  const outcomes = await Promise.all(suite.cases.filter((c) => c.effect?.verify).map((c) => outcome(c.id)));
  assert.ok(outcomes.includes("confirmed") && outcomes.includes("contradicted"));
});

test("every read-back record says it is test data", () => {
  for (const record of Object.values(eCommerceRefundFixture.records)) {
    assert.match(String(record.test_data), /does not exist; this record is scripted test data/);
  }
});
