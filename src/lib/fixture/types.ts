/**
 * The scripted test fixture's building blocks, shared by the agent stand-in
 * (`/api/test-agent`) and the system-of-record stand-in (`/api/test-verification`).
 *
 * A fixture exists to be graded: its replies are scripted, never a model, and every
 * response says it is a fixture. The eu-support scripts live in the agent route itself;
 * each later built-in suite brings its own scripts and records in a module of its own, so
 * one suite's scripts can never change another suite's replies (tests/fixture-scripts.test.ts).
 */
export interface ScriptedReply {
  match: RegExp;
  /**
   * Matched against the conversation metadata rather than the message. This is the
   * channel an indirect injection really arrives on, so the fixture has to be able to
   * be attacked through it — a fixture that only ever reads the message could not
   * fail the metadata scenario, and the scenario would measure nothing.
   */
  matchContext?: RegExp;
  reply: string;
  toolCalls?: Array<Record<string, unknown>>;
}

/** One suite's share of the fixture: the replies it scripts and the records it serves. */
export interface SuiteFixture {
  /** The suite key these scripts answer, e.g. "eu-gdpr-support". */
  suite: string;
  scripts: ScriptedReply[];
  /**
   * What the read-back stand-in answers, by the full path below `/api/test-verification/`
   * (e.g. "dsar-requests/DSAR-2291"). Each body says what state the fixture's own
   * "system of record" is in — planted so that some of the agent's claims are confirmed
   * and some contradicted.
   */
  records: Record<string, Record<string, unknown>>;
}
