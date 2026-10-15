import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SUITE_FIXTURES, SUITE_SCRIPTS, fixtureRecord } from "../src/lib/fixture/index.ts";

/**
 * The scripted fixture is what judges are measured against, so its replies to a suite must
 * never move because another suite was added. Later suites' scripts are consulted first;
 * these tests are what make that safe.
 */

interface CaseLike {
  id: string;
  input: string;
  context?: unknown;
  earlier_turns?: Array<string | { message: string }>;
  effect?: { verify?: { path?: string } };
}
interface SuiteLike { key: string; version: number; cases: CaseLike[] }

const dir = join(process.cwd(), "data/suites");
const suites: Array<SuiteLike & { file: string }> = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".labels.json") && !f.endsWith(".tiers.json"))
  .map((f) => ({ ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as SuiteLike), file: f }))
  .filter((s) => typeof s.key === "string" && Array.isArray(s.cases));

const fixtureKeys = new Set(SUITE_FIXTURES.map((f) => f.suite));

/** Every message a scenario sends: earlier turns first, then its own input. */
function messages(c: CaseLike): string[] {
  return [...(c.earlier_turns ?? []).map((t) => (typeof t === "string" ? t : t.message)), c.input];
}
/** The metadata channel as the agent receives it: a JSON string when it is an object. */
function contextOf(c: CaseLike): string {
  if (typeof c.context === "string") return c.context;
  return c.context ? JSON.stringify(c.context) : "";
}

test("no later suite's script matches a message of a suite that has no fixture module", () => {
  for (const suite of suites.filter((s) => !fixtureKeys.has(s.key))) {
    for (const c of suite.cases) {
      for (const message of messages(c)) {
        const hit = SUITE_SCRIPTS.find((s) => s.match.test(message));
        assert.equal(hit, undefined, `${suite.file} ${c.id}: "${message.slice(0, 60)}" is matched by ${hit?.match}, which would change its reply`);
      }
    }
  }
});

test("each suite with a fixture module is answered by its own scripts", () => {
  for (const suite of suites.filter((s) => fixtureKeys.has(s.key))) {
    const own = SUITE_FIXTURES.find((f) => f.suite === suite.key)!;
    for (const c of suite.cases) {
      const context = contextOf(c);
      const hit = SUITE_SCRIPTS.find((s) => (s.matchContext ? s.matchContext.test(context) && s.match.test(c.input) : s.match.test(c.input)));
      if (!hit) continue; // the fixture's default reply, deliberately
      assert.ok(own.scripts.includes(hit), `${suite.file} ${c.id}: answered by another suite's script ${hit.match}`);
    }
  }
});

test("every read-back path a fixture-backed suite names is served by the fixture", () => {
  for (const suite of suites.filter((s) => fixtureKeys.has(s.key))) {
    for (const c of suite.cases) {
      const path = c.effect?.verify?.path;
      if (!path) continue;
      assert.ok(fixtureRecord(path), `${suite.file} ${c.id}: read-back path "${path}" has no fixture record`);
    }
  }
});
