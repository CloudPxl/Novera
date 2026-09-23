import type { DeterministicCheck } from "../../judge/checks.ts";

/**
 * Reading the customer's own system to find out whether an action actually happened.
 *
 * The distinction this exists for: **a tool call is not an effect, and a tool response
 * is not a durable state change.** "I've refunded the order" is a sentence; a recorded
 * `issue_refund` call is a sentence the agent's framework wrote. Neither is the refund.
 * Only something read from outside the agent, after the fact, is evidence that the
 * customer's state changed.
 *
 * Three outcomes, and the third is not a failure of the agent:
 *
 *  - `confirmed`   — the read-back shows what the scenario said should happen.
 *  - `contradicted`— it shows the opposite. This is the strongest finding this product
 *                    can produce: the agent said it did something and the customer's
 *                    own system says otherwise.
 *  - `unavailable` — we could not look. The verdict is withheld, not failed, and the
 *                    report says which.
 */
export type ObservationStatus = "confirmed" | "contradicted" | "unavailable";

export interface VerificationObservation {
  status: ObservationStatus;
  /** One sentence for the case rationale. Redacted before it is stored or shown. */
  detail: string;
  /** Which connector produced this, and in which mode, as provenance. */
  connector: string;
  connectorVersion: string;
  mode: ConnectorMode;
  latencyMs: number;
  /**
   * The rules that were applied to the read-back, so a reader can see what
   * "confirmed" actually meant here rather than taking the word for it.
   */
  checked: DeterministicCheck[];
}

/**
 * `read_only` connectors may only look. A `test_write` connector — one that creates a
 * fixture to observe — needs explicit authorisation, idempotency, a preview, a
 * confirmation step, audit logging and cleanup. That is a project, not a mode flag,
 * and nothing here implements it yet.
 */
export type ConnectorMode = "read_only" | "test_write";

export interface VerificationInput {
  /** Scenario-supplied path or query, appended to the configured base. */
  path?: string;
  /** What must hold in the read-back for the effect to count as confirmed. */
  expect: DeterministicCheck[];
  /** The case id, for provenance only. Never sent to the customer's system. */
  caseId: string;
}

export interface ValidationResult {
  ok: boolean;
  detail: string;
}

export interface VerificationConnector {
  id: string;
  version: string;
  mode: ConnectorMode;
  /** Proves the configuration works before a suite is ever trusted to use it. */
  validate(): Promise<ValidationResult>;
  verify(input: VerificationInput): Promise<VerificationObservation>;
}
