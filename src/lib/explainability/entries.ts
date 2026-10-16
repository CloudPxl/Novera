import { GLOSSARY, type ExplainEntry, type ExplainKey } from "./glossary.ts";

/**
 * The glossary entries a client component renders, picked by key on the server and passed down
 * as props (`<ExplainProvider entries={…}>`). Importing the glossary into a "use client" file
 * would put all of it in the browser's bundle; this keeps it to the few entries a screen uses.
 */
export function explainEntries(keys: readonly ExplainKey[]): Partial<Record<ExplainKey, ExplainEntry>> {
  return Object.fromEntries(keys.map((k) => [k, GLOSSARY[k]])) as Partial<Record<ExplainKey, ExplainEntry>>;
}

/**
 * Every glossary key each client component can render. A client file's `<Explained id=…>` keys
 * must be listed here (tests/explainability.test.ts), and its server parent passes
 * `explainEntries(CLIENT_EXPLAINS.<name>)`.
 */
export const CLIENT_EXPLAINS = {
  sampleReport: ["grade_withheld", "sha256_seal", "coverage", "readback_contradiction", "readback_unavailable"],
  sealInspector: ["sha256_seal"],
  fileCheck: ["test_data"],
  // Shared by /verify/[hash] (server) and the file check (client): both parents resolve it.
  receiptDetails: ["seal_ledger", "run_funding", "grade_withheld", "grade_incomplete", "chained_report"],
  readiness: ["declared_manifest", "one_grader_only", "withdrawn_report"],
  caseTable: [
    "severity", "test_data", "readback_contradiction", "readback_unavailable", "one_grader_only", "consensus_tiebreaker",
    "unresolved_disagreement", "action_not_verified", "agent_unreachable", "not_run",
  ],
} as const satisfies Record<string, readonly ExplainKey[]>;
