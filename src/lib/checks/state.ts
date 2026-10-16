import type { Remedy } from "../billing/remedy.ts";
import type { CheckVerdict, NoVerdictReason } from "./single.ts";

/** What "Try this scenario alone" hands back to the page: a check's result, or why there is none. */
export interface ScenarioCheckState {
  check?: {
    id: string;
    verdict: CheckVerdict;
    noVerdictReason: NoVerdictReason | null;
    settledBy: string | null;
    reasons: string[];
    failedAssertions: string[];
    readBack: { status: string; detail: string } | null;
    policyVersion: number;
    scenarioId: string | null;
    createdAt: string;
  };
  /** Checks left in this workspace's rolling hour. */
  remaining?: number;
  error?: string;
  code?: string;
  remedy?: Remedy;
}
