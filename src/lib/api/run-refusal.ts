import "server-only";
import { RunRefusal } from "../workflow/start-run.ts";
import { apiJson } from "./respond.ts";

/**
 * A run start that `startRun` refused, in the shape an API caller reads. Shared by
 * `POST /api/v1/runs` and `POST /api/v1/ci/trigger`, so a pipeline gets the same status and
 * `code` for the same refusal whichever it called.
 *
 * Fair use is a rate, so a pipeline backs off and retries (429); anything else needs a person
 * (409). A failure that is not a refusal is ours (500).
 */
export function runRefusalResponse(e: unknown): Response {
  if (e instanceof RunRefusal && (e.blocker === "concurrency" || e.blocker === "fair_use")) {
    return apiJson({ error: e.message, code: e.blocker }, 429);
  }
  if (e instanceof RunRefusal) return apiJson({ error: e.message, ...(e.blocker ? { code: e.blocker } : {}) }, 409);
  return apiJson({ error: "The run could not be started." }, 500);
}

/** The instruction every started run carries: how to drive it. */
export function executeInstruction(origin: string, runId: string): string {
  return `POST ${origin}/api/v1/runs/${runId}/execute until "done" is true.`;
}
