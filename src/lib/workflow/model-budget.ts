import "server-only";
import { fingerprint, rateLimit } from "@/lib/support/rate-limit.ts";

/**
 * How many model calls the web app's drafting buttons may make for one workspace in an hour.
 *
 * Diagnosing a failure, drafting from a policy and reading a Suite Builder source run on
 * Novera's own provider keys — the same free-tier quota the trial's grading runs on. MCP
 * counted them (20 an hour); the buttons did not, so one free account pressing them in a loop
 * degraded grading for every trial run (audit, 2026-10-08). Generous for a person reading a
 * long document part by part, tight for a script. The identifier is a salted hash, so nobody
 * who learns a workspace id can spend its allowance.
 */
export const MODEL_BUTTON_LIMIT = { max: 60, windowSeconds: 60 * 60 };

/** `null` when the call may go ahead; otherwise the sentence to show. Refused when the count cannot be read. */
export async function spendModelCall(workspaceId: string): Promise<string | null> {
  const limit = await rateLimit(fingerprint(["model-buttons", workspaceId]), MODEL_BUTTON_LIMIT, { onError: "refuse" });
  if (!limit.counted) return "Novera could not check this workspace's hourly limit just now, so no model was asked. Try again in a minute.";
  if (!limit.allowed) {
    return `This workspace has asked for ${MODEL_BUTTON_LIMIT.max} drafts, diagnoses or source readings in the last hour. Try again in about ${limit.retryAfterMinutes} minutes.`;
  }
  return null;
}
