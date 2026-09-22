/**
 * Proves every model the router can reach is actually reachable, and says which
 * vendors can still corroborate each other.
 *
 * This exists because of what the 2026-09-22 calibration turned up. Nothing in the
 * codebase had changed, and yet one route candidate had started missing a planted
 * failure and another had stopped returning a readable verdict at all — the models
 * moved under a fixed name, and our own free-tier quota ran out underneath them. A
 * credential that authenticates is not a credential that can grade, and a route
 * pointing at a model nobody has called this week is a guess.
 *
 * Deliberately cheap: one short call per distinct model, never the judge prompt.
 * It answers "can this key produce a completion right now", not "how well does it
 * grade" — that is `npm run calibrate`, which costs real quota.
 *
 * Prints no key material. The only thing shown about a credential is its name.
 *
 * Run: npm run verify:models
 */
import { connectionsFromEnv } from "../src/lib/providers/registry.ts";
import { DEFAULT_ROUTES, type Task } from "../src/lib/router/routes.ts";

const connections = connectionsFromEnv();
const tasks = Object.keys(DEFAULT_ROUTES) as Task[];

// Distinct candidates, each recorded with the tasks that would reach it.
const wanted = new Map<string, { connection: string; model: string; tasks: Task[] }>();
for (const task of tasks) {
  for (const candidate of DEFAULT_ROUTES[task]) {
    const key = `${candidate.connection}/${candidate.model}`;
    const entry = wanted.get(key) ?? { ...candidate, tasks: [] };
    entry.tasks.push(task);
    wanted.set(key, entry);
  }
}

console.log(`Connections configured: ${[...connections.keys()].sort().join(", ") || "(none)"}`);
console.log(`Route candidates to check: ${wanted.size}\n`);

type Result = "ok" | "unreachable" | "no credential";
const results = new Map<string, { result: Result; detail: string; ms: number }>();

for (const [key, candidate] of wanted) {
  const connection = connections.get(candidate.connection);
  if (!connection) {
    results.set(key, { result: "no credential", detail: `no ${candidate.connection.toUpperCase()}_API_KEY`, ms: 0 });
    console.log(`  ---  ${key.padEnd(46)} no credential configured`);
    continue;
  }

  const started = Date.now();
  try {
    const response = await connection.provider.chat(
      {
        model: candidate.model,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
        // Not 16. A reasoning model spends its output budget on thoughts first, so a
        // tight ceiling comes back empty with finish_reason "length" — the health
        // check would have reported both gpt-oss models as down while they were fine.
        maxTokens: 256,
        temperature: 0,
        reasoning: "off",
      },
      connection.apiKey,
    );
    const ms = Date.now() - started;
    results.set(key, { result: "ok", detail: response.text.slice(0, 20), ms });
    console.log(`  ok   ${key.padEnd(46)} ${ms}ms  ${JSON.stringify(response.text.slice(0, 20))}`);
  } catch (error) {
    const ms = Date.now() - started;
    const detail = error instanceof Error ? error.message : String(error);
    results.set(key, { result: "unreachable", detail, ms });
    console.log(`  FAIL ${key.padEnd(46)} ${ms}ms  ${detail.slice(0, 110)}`);
  }
  // Mistral's free tier is one request per second; pacing a health check costs
  // nothing and stops it reporting a rate limit as a dead model.
  await new Promise((r) => setTimeout(r, 1200));
}

// The question that actually matters for grading: can a verdict be corroborated by a
// second vendor? One reachable vendor means every case comes back uncorroborated.
console.log("");
let failed = 0;
for (const task of tasks) {
  const vendors = new Set(
    DEFAULT_ROUTES[task]
      .filter((c) => results.get(`${c.connection}/${c.model}`)?.result === "ok")
      .map((c) => c.connection),
  );
  const grading = task === "judge" || task === "judge_critical";
  const ok = grading ? vendors.size >= 2 : vendors.size >= 1;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${task.padEnd(16)} ${vendors.size} vendor(s) reachable`
      + `${vendors.size ? `: ${[...vendors].join(", ")}` : ""}`
      + `${grading ? "  (2 needed for an independent verdict)" : ""}`,
  );
}

const unreachable = [...results].filter(([, r]) => r.result !== "ok");
if (unreachable.length) {
  console.log(`\n${unreachable.length} candidate(s) not reachable right now:`);
  for (const [key, r] of unreachable) console.log(`  ${key}: ${r.detail.slice(0, 160)}`);
}

console.log(
  failed === 0
    ? "\nEvery task can be served, and grading can be corroborated across vendors.\n"
    : `\n${failed} task(s) cannot be served as routed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
