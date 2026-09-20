/**
 * Does the judge give the same answer twice?
 *
 * A baseline comparison is only worth showing if a verdict that changed means the
 * agent changed. This grades the SAME stored agent responses several times over and
 * counts how often a verdict moves on its own. Nothing about the agent varies here,
 * so every disagreement it finds is noise the product would otherwise report to a
 * customer as a fix or a regression.
 *
 * Run: npm run measure:stability -- [runId] [repeats]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createRoutedChat } from "../src/lib/router/execute.ts";
import { DEFAULT_ROUTES } from "../src/lib/router/routes.ts";
import { connectionsFromEnv } from "../src/lib/providers/registry.ts";
import { judgeCase } from "../src/lib/judge/index.ts";
import { gradeCase } from "../src/lib/judge/consensus.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const runId = process.argv[2];
const repeats = Number(process.argv[3] ?? 3);
if (!runId) {
  console.error("Usage: npm run measure:stability -- <runId> [repeats]");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const suite = JSON.parse(readFileSync("data/suites/eu-support-v1.json", "utf8")) as {
  cases: Array<{ id: string; forbidden?: string[] }>;
};
const forbiddenById = new Map(suite.cases.map((c) => [c.id, c.forbidden ?? []]));

const { data: rows, error } = await db
  .from("run_cases")
  .select("case_id, severity, input, expected, assertions, response_text, tool_activity")
  .eq("run_id", runId)
  .not("response_text", "is", null)
  .order("case_id");

if (error || !rows?.length) {
  console.error(`No gradable cases on run ${runId}: ${error?.message ?? "none found"}`);
  process.exit(1);
}

const chat = createRoutedChat({ connections: connectionsFromEnv(), routes: DEFAULT_ROUTES });
const mode = process.env.STABILITY_MODE ?? "single";

console.log(`\nGrading ${rows.length} stored responses ${repeats}x — mode: ${mode}\n`);

const verdicts = new Map<string, string[]>();

for (let pass = 1; pass <= repeats; pass++) {
  process.stdout.write(`  pass ${pass} `);
  for (const row of rows) {
    const testCase = {
      caseId: row.case_id as string,
      input: row.input as string,
      expectedBehavior: row.expected as string,
      assertions: Array.isArray(row.assertions) ? (row.assertions as string[]) : [],
      forbidden: forbiddenById.get(row.case_id as string),
    };
    const args = {
      chat,
      testCase,
      agentResponse: row.response_text as string,
      toolActivity: row.tool_activity,
    };

    const outcome =
      mode === "consensus"
        ? await gradeCase({ ...args, severity: row.severity as string })
        : await judgeCase({ ...args, task: "judge" as const });

    const list = verdicts.get(row.case_id as string) ?? [];
    list.push(outcome.status);
    verdicts.set(row.case_id as string, list);
    process.stdout.write(outcome.status === "pass" ? "." : outcome.status === "fail" ? "x" : "?");
  }
  process.stdout.write("\n");
}

let unstable = 0;
console.log("");
for (const [caseId, list] of [...verdicts].sort()) {
  const unanimous = new Set(list).size === 1;
  if (!unanimous) unstable++;
  console.log(`  ${unanimous ? " ok  " : "MOVED"} ${caseId}  ${list.join(" ")}`);
}

const pct = Math.round((unstable / verdicts.size) * 1000) / 10;
console.log(
  `\n${unstable} of ${verdicts.size} scenarios changed verdict across ${repeats} identical gradings (${pct}%).`,
);
console.log(
  unstable === 0
    ? "Stable: a verdict that moves in a rerun means the agent moved.\n"
    : "Unstable: a baseline comparison would report these as fixes or regressions that did not happen.\n",
);
