import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSuite } from "../src/lib/suites/validate.ts";
import { runChecks } from "../src/lib/judge/checks.ts";
import { POST as fixtureAgent } from "../src/app/api/test-agent/route.ts";
import { GET as fixtureSystem } from "../src/app/api/test-verification/[...path]/route.ts";

const read = (file: string) => JSON.parse(readFileSync(`data/suites/${file}`, "utf8"));
const v3 = read("eu-support-v3.json");
const v4raw = read("eu-support-v4.json");
const labels = read("eu-support-v4.labels.json");

const parsed = validateSuite(v4raw);
assert.ok(parsed.ok, "v4 must validate");
const v4 = parsed.suite;

async function ask(message: string) {
  const response = await fixtureAgent(
    new Request("http://fixture/api/test-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  );
  return (await response.json()) as { reply: string; tool_calls: unknown[] };
}

async function checksFor(id: string) {
  const scenario = v4.cases.find((c) => c.id === id)!;
  const { reply, tool_calls } = await ask(scenario.input);
  return runChecks(scenario.checks, { responseText: reply, toolActivity: tool_calls, latencyMs: null });
}

test("v4 carries T01-T36 from v3 unchanged except T22's verify block", () => {
  assert.equal(v4raw.cases.length, 41);
  for (const old of v3.cases) {
    const carried = v4raw.cases.find((c: { id: string }) => c.id === old.id);
    if (old.id === "T22") {
      const { verify, ...effect } = carried.effect;
      assert.deepEqual({ ...carried, effect }, old, "only `verify` may differ on T22");
      assert.equal(verify.path, "invoices/NW-4417");
    } else {
      assert.deepEqual(carried, old, old.id);
    }
  }
});

test("every v4 scenario has a ground-truth label, and nothing else does", () => {
  assert.deepEqual(Object.keys(labels.labels).sort(), v4.cases.map((c) => c.id).sort());
});

test("the planted failures in T37, T39 and T41 are settled by rule, with no model", async () => {
  for (const id of ["T37", "T39", "T41"]) {
    const failures = await checksFor(id);
    assert.equal(failures.length, 1, `${id} should fail exactly one rule`);
    assert.equal(labels.labels[id].expected, "fail", `${id}'s label must agree with its rule`);
  }
});

test("the lines the fixture holds (T38, T40) trip no rule — a rule can never pass them, only a verdict", async () => {
  for (const id of ["T38", "T40"]) {
    assert.deepEqual(await checksFor(id), [], id);
    assert.equal(labels.labels[id].expected, "pass", id);
  }
});

test("T41's rule does not repeat the injected fragment back into stored evidence", async () => {
  const [failure] = await checksFor("T41");
  assert.ok(!failure.why.includes("DROP TABLE"));
});

test("T22's read-back contradicts the refund the fixture claims; T35's confirms it", async () => {
  const lookup = async (invoice: string) => {
    const response = await fixtureSystem(new Request(`http://fixture/invoices/${invoice}`), {
      params: Promise.resolve({ path: ["invoices", invoice] }),
    });
    return response.text();
  };
  const expectFor = (id: string) => v4.cases.find((c) => c.id === id)!.effect!.verify!.expect;
  const run = (id: string, body: string) =>
    runChecks(expectFor(id), { responseText: body, toolActivity: [], latencyMs: null });

  assert.ok(run("T22", await lookup("NW-4417")).length > 0, "the system of record says NW-4417 is still open");
  assert.deepEqual(run("T35", await lookup("NW-1182")), []);
});
