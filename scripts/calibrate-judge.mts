/**
 * Measures candidate judge models against ground truth.
 *
 * Novera's own method, applied to Novera: rather than assert which model grades best,
 * run each candidate over the scripted fixture — whose failures are planted, so the
 * correct verdict is known — and count how often it agrees.
 *
 * The headline number is FALSE PASSES: cases that should have failed and did not.
 * That is this product's worst failure mode, because it is the one a customer cannot
 * detect. A model with more false fails is annoying; a model with false passes is
 * unusable here.
 *
 * Cases whose correct verdict is genuinely arguable are labelled null and excluded,
 * so the measurement is not inflated by cases we cannot defend either way.
 *
 * Needs the dev server running (npm run dev) for the fixture.
 * Run: npm run calibrate
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { httpAgent } from "../src/lib/agents/http.ts";
import { judgeCase } from "../src/lib/judge/index.ts";
import { connectionsFromEnv } from "../src/lib/providers/registry.ts";
import { createRoutedChat } from "../src/lib/router/execute.ts";
import type { RouteTable } from "../src/lib/router/routes.ts";
import type { SuiteCase } from "../src/lib/runner/types.ts";

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const suiteDir = path.join(process.cwd(), "data", "suites");

const suite = JSON.parse(await readFile(path.join(suiteDir, "eu-support-v1.json"), "utf8")) as {
  cases: SuiteCase[];
};
const { labels } = JSON.parse(
  await readFile(path.join(suiteDir, "eu-support-v1.labels.json"), "utf8"),
) as { labels: Record<string, { expected: "pass" | "fail" | null; why: string }> };

const connections = connectionsFromEnv();
if (connections.size === 0) {
  console.error("No provider credentials found in .env.local.");
  process.exit(1);
}

// Candidates to measure. Edit freely — that is the point of this script.
const CANDIDATES: Array<{ connection: string; model: string }> = [
  { connection: "google", model: "gemini-3.5-flash-lite" },
  { connection: "groq", model: "openai/gpt-oss-120b" },
  { connection: "groq", model: "openai/gpt-oss-20b" },
  { connection: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
  { connection: "mistral", model: "ministral-14b-latest" },
  { connection: "mistral", model: "ministral-8b-latest" },
  { connection: "mistral", model: "ministral-3b-latest" },
];

/**
 * One candidate, or a comma-separated list, overrides the table above:
 *   CALIBRATE_MODELS="google/gemini-3.5-flash" npm run calibrate
 * Re-measuring a single model is the common case — a route order is only as good as
 * its last measurement, and models change under a fixed name.
 */
const OVERRIDE = process.env.CALIBRATE_MODELS?.trim();
if (OVERRIDE) {
  CANDIDATES.length = 0;
  for (const entry of OVERRIDE.split(",")) {
    const slash = entry.trim().indexOf("/");
    CANDIDATES.push({ connection: entry.trim().slice(0, slash), model: entry.trim().slice(slash + 1) });
  }
}

/**
 * Seconds a connection needs between calls. Mistral's free tier is one request per
 * second and answers a burst with 429s, which a single-candidate route records as
 * "no readable verdict" — the model would be scored for our pacing rather than for
 * its grading. Pacing the measurement is not pacing production, where the router
 * falls through to another vendor instead of waiting.
 */
const PACE_MS: Record<string, number> = { mistral: 1500 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const agent = httpAgent({
  kind: "http",
  url: `${base}/api/test-agent`,
  bodyTemplate: { message: "{{input}}" },
  responsePath: "reply",
  toolActivityPath: "tool_calls",
});

// Collect the fixture's replies once and reuse them, so every model grades exactly
// the same evidence.
console.log("Collecting fixture responses...");
const responses = new Map<string, { text: string; toolActivity: unknown }>();
for (const testCase of suite.cases) {
  const result = await agent.send({ input: testCase.input, policy: "" });
  if (!result.ok || !result.responseText) {
    console.error(`  ${testCase.id}: fixture unavailable — ${result.error}`);
    console.error("  Is the dev server running? (npm run dev)");
    process.exit(1);
  }
  responses.set(testCase.id, { text: result.responseText, toolActivity: result.toolActivity });
}
console.log(`  ${responses.size} responses collected\n`);

const labelled = suite.cases.filter((c) => labels[c.id]?.expected !== null && labels[c.id]);
console.log(`Measuring ${CANDIDATES.length} candidate(s) over ${labelled.length} labelled case(s) `
  + `(${suite.cases.length - labelled.length} excluded as arguable)\n`);

interface Score {
  candidate: string;
  agreed: number;
  falsePasses: string[];
  falseFails: string[];
  errors: string[];
  ms: number;
}

const scores: Score[] = [];

for (const candidate of CANDIDATES) {
  if (!connections.has(candidate.connection)) {
    console.log(`skipped  ${candidate.connection}/${candidate.model} — no credential`);
    continue;
  }

  // A single-candidate route, so a fallback cannot mask a model's weakness.
  const routes = {
    judge: [candidate], judge_critical: [candidate], diagnose: [candidate], draft: [candidate],
  } satisfies RouteTable;
  const chat = createRoutedChat({ connections, routes });

  const score: Score = { candidate: `${candidate.connection}/${candidate.model}`, agreed: 0, falsePasses: [], falseFails: [], errors: [], ms: 0 };
  const started = Date.now();

  for (const testCase of labelled) {
    const expected = labels[testCase.id].expected;
    const evidence = responses.get(testCase.id)!;

    const outcome = await judgeCase({
      chat,
      task: "judge",
      testCase: {
        caseId: testCase.id,
        input: testCase.input,
        expectedBehavior: testCase.expected_behavior,
        assertions: testCase.assertions,
        forbidden: testCase.forbidden,
      },
      agentResponse: evidence.text,
      toolActivity: evidence.toolActivity,
    });

    const pace = PACE_MS[candidate.connection];
    if (pace) await pause(pace);

    if (outcome.status === "error") score.errors.push(testCase.id);
    else if (outcome.status === expected) score.agreed++;
    else if (expected === "fail") score.falsePasses.push(testCase.id);
    else score.falseFails.push(testCase.id);
  }

  score.ms = Date.now() - started;
  scores.push(score);
  console.log(
    `${score.falsePasses.length === 0 ? "  ok  " : " RISK "} ${score.candidate.padEnd(46)} ` +
      `agreed ${score.agreed}/${labelled.length}  falsePass ${score.falsePasses.length}  ` +
      `falseFail ${score.falseFails.length}  error ${score.errors.length}  ${(score.ms / 1000).toFixed(1)}s`,
  );
}

console.log("\nRanked — fewest false passes first, then most agreement:\n");
const ranked = [...scores].sort(
  (a, b) => a.falsePasses.length - b.falsePasses.length || b.agreed - a.agreed || a.ms - b.ms,
);
for (const [i, s] of ranked.entries()) {
  console.log(`  ${i + 1}. ${s.candidate}`);
  console.log(`     agreement ${s.agreed}/${labelled.length}, ${(s.ms / labelled.length / 1000).toFixed(1)}s per case`);
  if (s.falsePasses.length) console.log(`     MISSED REAL FAILURES: ${s.falsePasses.join(", ")}`);
  if (s.falseFails.length) console.log(`     flagged good behaviour: ${s.falseFails.join(", ")}`);
  if (s.errors.length) console.log(`     no readable verdict: ${s.errors.join(", ")}`);
}
console.log("\nThis measures agreement with our labels, not absolute correctness.\n");
