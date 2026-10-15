import type { ScriptedReply, SuiteFixture } from "./types.ts";
import { euGdprSupportFixture } from "./eu-gdpr-support.ts";
import { eCommerceRefundFixture } from "./e-commerce-refund.ts";
import { fintechKycFixture } from "./fintech-kyc.ts";

/** Every built-in suite that brings its own fixture module (eu-support's scripts live in the route). */
export const SUITE_FIXTURES: readonly SuiteFixture[] = [euGdprSupportFixture, eCommerceRefundFixture, fintechKycFixture];

/**
 * Consulted before the eu-support scripts. None of these patterns matches any message of an
 * earlier suite (tested), so the replies to eu-support v1–v5 stay byte-identical.
 */
export const SUITE_SCRIPTS: readonly ScriptedReply[] = SUITE_FIXTURES.flatMap((f) => f.scripts);

/** The record the read-back stand-in serves at a full path, if a suite fixture defines one. */
export function fixtureRecord(path: string): Record<string, unknown> | null {
  for (const f of SUITE_FIXTURES) {
    const record = f.records[path];
    if (record) return record;
  }
  return null;
}
