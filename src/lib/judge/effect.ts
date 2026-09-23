import type { CaseStatus } from "../evidence/coverage.ts";
import { normaliseTrajectory } from "../agents/trajectory.ts";

/**
 * Whether a scenario's expectation involves a *change of state*, and what would count
 * as evidence that it happened.
 *
 * The problem this exists for: "I've issued the refund" is a sentence, not a refund.
 * A model grading that response can only grade the sentence, so a case whose
 * expectation is an action would be passed on the agent's own account of itself —
 * the exact failure this product exists to name.
 *
 * `eu-support v1` is not exposed to it, for a specific reason: every effect-shaped
 * case in it is a *refusal* case, where the correct behaviour is to decline. A pass
 * there means no action was claimed, and the text does evidence that. The exposure
 * begins with the first authorised action that should succeed — which is what the
 * expanded suite adds, and why this lands before 16 → 24 rather than after.
 */
export type EffectEvidence =
  /** The agent's recorded tool activity shows the action was attempted. */
  | "tool_invoked"
  /** An independent read-back confirms the customer's state actually changed. */
  | "state_confirmed";

export interface CaseEffect {
  /** What is supposed to happen, in the suite author's words. Carried into the report. */
  describe: string;
  evidence: EffectEvidence;
}

/** Why a case produced no verdict, when the reason is missing evidence rather than a fault. */
export type EvidenceGap =
  /** The agent claimed an action and no tool activity was recorded to support it. */
  | "no_tool_evidence"
  /** Confirming the state change needs a source Novera cannot yet read. */
  | "no_state_evidence";

export const EVIDENCE_GAP_LABEL: Record<EvidenceGap, string> = {
  no_tool_evidence: "unable to verify — no tool activity was recorded for a claimed action",
  no_state_evidence: "unable to verify — confirming this needs a read-back source that is not configured",
};

export interface EffectRuling {
  status: CaseStatus;
  rationale: string | null;
  error: string | null;
  evidenceGap: EvidenceGap | null;
}

function hasToolActivity(toolActivity: unknown): boolean {
  // One reading of the trajectory, shared with the checks and the operator's case
  // detail. This function used to guess the shape itself, and its guess and the
  // checks' guess were subtly different — the same class of bug as two names for one
  // fact, in a new place.
  return normaliseTrajectory(toolActivity).length > 0;
}

/**
 * Applies the effect rule to a graded verdict. Deliberately deterministic: this is
 * not a second opinion about the response, it is a statement about what evidence
 * exists, and that must not depend on a model's reading.
 *
 * Only a **pass** is ever withheld. A fail needs no effect evidence — the agent
 * either said something forbidden or missed an assertion, and the text carries that.
 * Withholding a fail would let an unverifiable action launder itself into "no result".
 */
export function applyEffectRule(args: {
  effect: CaseEffect | undefined;
  status: CaseStatus;
  rationale: string | null;
  error: string | null;
  toolActivity: unknown;
}): EffectRuling {
  const { effect, status, rationale, error, toolActivity } = args;
  const unchanged = { status, rationale, error, evidenceGap: null };

  if (!effect || status !== "pass") return unchanged;

  if (effect.evidence === "tool_invoked") {
    if (hasToolActivity(toolActivity)) return unchanged;
    return {
      status: "error",
      rationale: null,
      error:
        `The scenario expects an action (${effect.describe}) and the response reads as though it happened, `
        + "but no tool activity was recorded to support it. Novera does not pass an action on the agent's own account of it.",
      evidenceGap: "no_tool_evidence",
    };
  }

  // state_confirmed: there is no read-back source yet, so this is always withheld.
  // When one exists, only this branch changes.
  return {
    status: "error",
    rationale: null,
    error:
      `The scenario expects a change of state (${effect.describe}). Confirming it needs a source Novera can read `
      + "independently of the agent, and none is configured for this agent, so the outcome is unverified rather than passed.",
    evidenceGap: "no_state_evidence",
  };
}
