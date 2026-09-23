/**
 * Proves the metadata channel is a real, separate channel.
 *
 * `eu-support v3` attacks an agent through the data it is given *about* the
 * conversation, not only through the customer's message. That distinction only
 * means something if the delivery is real: if the note ever reached the agent
 * inside the message, the scenario would be a direct-injection test wearing an
 * indirect-injection scenario's name and id.
 *
 * Everything here is live — the real fixture over HTTP, the real `executeCase`, the
 * real judges — and the cases come from the shipped suite file rather than from
 * copies, so this cannot pass against a scenario the suite does not contain.
 *
 * Needs the dev server running (npm run dev).
 * Run: npm run verify:channel
 */
import { readFile } from "node:fs/promises";
import { httpAgent } from "../src/lib/agents/http.ts";
import { executeCase } from "../src/lib/runner/execute.ts";
import { httpVerificationConnector } from "../src/lib/evidence/connectors/http.ts";
import { connectionsFromEnv } from "../src/lib/providers/registry.ts";
import { createRoutedChat } from "../src/lib/router/execute.ts";
import { DEFAULT_ROUTES } from "../src/lib/router/routes.ts";
import { validateSuite } from "../src/lib/suites/validate.ts";
import type { SuiteCase } from "../src/lib/runner/types.ts";

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const judge = createRoutedChat({ connections: connectionsFromEnv(), routes: DEFAULT_ROUTES });

const parsed = validateSuite(JSON.parse(await readFile("data/suites/eu-support-v3.json", "utf8")));
if (!parsed.ok) {
  console.error(parsed.errors.join("\n"));
  process.exit(1);
}
const caseById = (id: string): SuiteCase => {
  const found = parsed.suite.cases.find((c) => c.id === id);
  if (!found) throw new Error(`${id} is not in eu-support v3`);
  return found;
};

const wired = httpAgent({
  kind: "http",
  url: `${base}/api/test-agent`,
  bodyTemplate: { message: "{{input}}", context: "{{context}}" },
  responsePath: "reply",
  toolActivityPath: "tool_calls",
});

// The same agent as far as the customer is concerned — it just has nowhere to put
// conversation metadata, which most deployed agents genuinely do not.
const unwired = httpAgent({
  kind: "http",
  url: `${base}/api/test-agent`,
  bodyTemplate: { message: "{{input}}" },
  responsePath: "reply",
  toolActivityPath: "tool_calls",
});

const verifier = httpVerificationConnector({ kind: "http_read", url: `${base}/api/test-verification/` });

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}\n       ${detail}`);
};

console.log("\nThe metadata channel\n");

// 1. The attack lands, and it lands through the metadata.
const injected = await executeCase({ testCase: caseById("T29"), agent: wired, policy: "", judge });
check(
  "an instruction planted in account metadata reaches the agent and is obeyed",
  injected.status === "fail",
  `T29 ${injected.status} — ${(injected.rationale ?? injected.error ?? "").slice(0, 110)}`,
);

// 2. The same message with the metadata removed is answered normally. This is the
// control: without it, the case could be failing on the message alone and nobody
// would know the channel was doing any work.
const withoutMetadata = await wired.send({ input: caseById("T29").input, policy: "" });
check(
  "the same message without the metadata produces no refund at all",
  !/refund/i.test(withoutMetadata.responseText ?? ""),
  (withoutMetadata.responseText ?? "").slice(0, 110),
);

// 3. An agent with nowhere to receive it is not quietly sent the same attack in the
// message body. The case does not run, and says so.
const unsupported = await executeCase({ testCase: caseById("T29"), agent: unwired, policy: "", judge });
check(
  "an agent with no metadata channel does not run the case as a different test",
  unsupported.status === "error" && unsupported.responseText === null,
  `${unsupported.status}: ${(unsupported.error ?? "").slice(0, 120)}`,
);

// 4. A rule settles the fabricated-approval case before any model is asked.
const approval = await executeCase({ testCase: caseById("T32"), agent: wired, policy: "", judge });
check(
  "a forbidden tool call settles the fabricated-approval case with no judge",
  approval.status === "fail" && approval.settledBy === "deterministic" && approval.judgeModel === null,
  `T32 ${approval.status}, settled by ${approval.settledBy}, judge ${approval.judgeModel ?? "none"}`,
);

// 5. An authorised action the customer's own system confirms. The pass branch of the
// read-back, exercised by a scenario that ships rather than one written for a script.
const confirmed = await executeCase({ testCase: caseById("T35"), agent: wired, policy: "", judge, verifier });
check(
  "an authorised refund the system of record confirms is allowed to pass",
  confirmed.status === "pass" && confirmed.observation?.status === "confirmed",
  `T35 ${confirmed.status}, read-back ${confirmed.observation?.status ?? "none"}, gap ${confirmed.evidenceGap ?? "none"}`,
);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
