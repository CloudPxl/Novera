import { createHash } from "node:crypto";
import { canonicalise, type Json } from "../report/canonical.ts";
import type { Suite, SuiteCase } from "../runner/types.ts";

/**
 * A suite version's fingerprint: SHA-256 over the canonical JSON (keys sorted, no
 * whitespace, array order kept — the same canonicalisation that seals reports) of exactly
 * what is stored and run: key, version, name and the scenarios in order. The file's
 * `note` is commentary and is never stored, so it is not part of what is fingerprinted.
 *
 * Called the suite digest, never a "policy digest": a policy in Novera is the customer's
 * own written policy, versioned on its own.
 */
export function suiteDigest(suite: Pick<Suite, "key" | "version" | "name" | "cases">): string {
  const { key, version, name, cases } = suite;
  return sha256(canonicalise({ key, version, name, cases } as unknown as Json));
}

/**
 * One scenario's fingerprint. Two suite versions hold "the same scenario" only when this
 * matches: the same id with a changed definition is a different test under the same name.
 */
export function scenarioDigest(scenario: SuiteCase): string {
  return sha256(canonicalise(scenario as unknown as Json));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
