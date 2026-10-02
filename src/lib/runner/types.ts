import type { Persona } from "../simulate/persona.ts";
import type { CaseStatus } from "../evidence/coverage.ts";
import type { CaseEffect, EvidenceGap } from "../judge/effect.ts";
import type { DeterministicCheck } from "../judge/checks.ts";
import type { VerificationObservation } from "../evidence/connectors/types.ts";

export interface SuiteCase {
  id: string;
  category: string;
  obligation: string;
  severity: string;
  input: string;
  expected_behavior: string;
  assertions: string[];
  forbidden?: string[];
  /**
   * Present when the expectation is an action, not just words. A pass then has to be
   * evidenced by something other than the agent saying it happened.
   */
  effect?: CaseEffect;
  /**
   * Rules that settle this scenario without a model. They can only fail it — a case
   * whose checks all hold still goes to the judges, because "did not contain the
   * forbidden phrase" is not the same as "met the expectation".
   */
  checks?: DeterministicCheck[];
  /**
   * Data delivered to the agent alongside the message rather than inside it — the
   * channel a real indirect injection uses. Never merged into `input`: the whole
   * point of the scenario is that the customer did not type this.
   */
  context?: Record<string, string>;
  /**
   * The customer's messages before `input`, in order, making the scenario a
   * conversation. Each is sent as its own turn with the conversation so far, and the
   * verdict is on all of it. Never joined into one message: a refusal that has to hold
   * across three turns is a different test from one long message.
   */
  earlier_turns?: string[];
  /**
   * Rules for one turn of a conversation, checked against that turn's reply and tool
   * calls alone, so a failure names the turn where the agent crossed the line. `turn`
   * counts every customer message from 1, `input` being the last. Like `checks`, they
   * can only fail a scenario.
   */
  turn_checks?: Array<{ turn: number; checks: DeterministicCheck[] }>;
  /**
   * A simulated customer who continues the conversation after `input`, which is their
   * human-written opening. A model plays them, turn by turn, up to `max_turns` more
   * messages. Every message it writes is marked as simulated in the transcript.
   * Never combined with `earlier_turns`.
   */
  persona?: Persona;
  /**
   * What this scenario is an attack on, when it is one. Recorded as evidence so a
   * report can say which channel the input arrived on and which published weakness
   * it exercises, rather than leaving a reader to infer it from the prompt.
   */
  attack?: { technique: string; channel: "message" | "metadata" | "document" | "tool_result"; reference?: string };
  /**
   * References this scenario's evidence is filed under, e.g. "EU AI Act Art. 50" or
   * "GDPR Art. 17". This organises evidence for a reader who has those duties. It is
   * not a legal conclusion, and no report may present it as one.
   */
  duty_refs?: string[];
  /**
   * Carrying out the expected behaviour would do something irreversible, or the
   * scenario only makes sense against scripted data. Either one bars the case from an
   * agent that has not been marked as a test target: it is recorded as not having run,
   * never executed and hoped for.
   */
  destructive?: boolean;
  fixture_only?: boolean;
}

export interface Suite {
  key: string;
  version: number;
  name: string;
  cases: SuiteCase[];
}

/**
 * Everything one scenario produced, independent of where it is filed.
 *
 * Split out of `RunCaseRecord` so that a single-case retest and a suite run are
 * graded by literally the same code. If the two paths had their own copies, a retest
 * could tell an operator their fix worked while the run that produces the client's
 * report disagreed — and the retest exists precisely to predict that run.
 */
export interface CaseOutcome {
  responseText: string | null;
  toolActivity: unknown;
  status: CaseStatus;
  rationale: string | null;
  latencyMs: number | null;
  usage: Record<string, unknown> | null;
  /** Which model actually graded this case, after any fallback. */
  judgeModel: string | null;
  /** Every judge candidate tried for this case, failures included. */
  judgeAttempts: unknown[];
  /** What each model consulted on this case said. */
  judgeVotes: unknown[];
  /** The assertions the judge found unmet. Empty for a pass. */
  failedAssertions: string[];
  /** Whether the models agreed, a third settled it, or it could not be settled. */
  judgeAgreement: string | null;
  /**
   * Set when a pass was withheld because nothing evidenced the action it claimed.
   * Null on every case that produced a verdict, and on every row stored before the
   * distinction existed.
   */
  evidenceGap: EvidenceGap | null;
  /**
   * `deterministic` when a rule decided this case and no model was asked;
   * `models` when consensus graded it. Null on rows stored before checks existed,
   * which means the models, because that is all there was.
   */
  settledBy: "deterministic" | "models" | "read_back" | null;
  /**
   * What an independent read of the customer's own system showed about a claimed
   * action. Null when the scenario asked for none, or no read-back is configured.
   */
  observation: VerificationObservation | null;
  /**
   * Every turn of a conversation scenario, customer and agent, in order. Null for a
   * single-message scenario; `responseText` is always the final agent reply.
   */
  transcript?: ConversationTurn[] | null;
  error: string | null;
}

export interface ConversationTurn {
  role: "customer" | "agent";
  content: string;
  latencyMs?: number;
  /** A customer message written by the simulated customer, not by a person. */
  simulated?: boolean;
  /** The model that wrote a simulated message. */
  model?: string;
}

/** One fully-evidenced case, exactly as it is persisted against a run. */
export interface RunCaseRecord extends CaseOutcome {
  runId: string;
  caseId: string;
  category: string;
  obligation: string;
  severity: string;
  input: string;
  expected: string;
  assertions: string[];
}

/**
 * Persistence seam. The orchestrator owns *what* counts as evidence; the store owns
 * where it lands. Keeps the run logic testable without a database, and means a
 * storage bug cannot quietly change a verdict.
 */
export interface RunStore {
  /**
   * `already_recorded` when the scenario was saved for this run before (by the slice that
   * took the run over, say): not an error, and never a second row. `not_holder` when this
   * slice no longer holds the run's lease: nothing was saved, and it must stop.
   */
  saveCase(record: RunCaseRecord): Promise<void | "saved" | "already_recorded" | "not_holder">;
  markRunning(runId: string): Promise<void>;
  /** False when nothing was written because this slice no longer holds the run. */
  finishRun(runId: string, outcome: { status: "completed" | "aborted"; error?: string }): Promise<void | boolean>;
  /** Whether someone stopped the run since this slice began. Checked before each case. */
  isStopped?(runId: string): Promise<boolean>;
  /**
   * Whether this slice still holds the run's lease (0047). Checked before each scenario is
   * sent: a slice that lost it sends nothing more, because the slice that took over will.
   */
  holdsRun?(runId: string): Promise<boolean>;
}
