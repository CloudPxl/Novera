import type { HttpAgentConfig } from "./types.ts";
import { isNoveraFixture } from "./environment.ts";

/**
 * The sample support agent: Novera's own scripted fixture (`/api/test-agent`, planted failures
 * and all) connected to a workspace in one press, so a first run can be seen before anyone has
 * an agent's address to hand.
 *
 * It must never pass for a customer's agent. Its name says what it is; it points only at this
 * deployment's fixture, which `isNoveraFixture` recognises, so every page and every sealed report
 * labels its runs as test data the way any fixture run is labelled; it is a test target, because
 * nothing it "does" happens anywhere.
 *
 * Pure: the configuration, the policy and the decision whether one already exists. The server
 * action (`src/lib/workflow/sample-agent.ts`) does the writing.
 */

export const SAMPLE_AGENT_NAME = "Sample support agent (Novera test fixture)";

/**
 * The configuration the end-to-end scripts connect the fixture with (`demo:run`, `verify:effect`),
 * plus `{{history}}`, which the fixture reads (`verify:conversation`): without it every
 * conversation scenario of the default suite is recorded as not run, and a first report would
 * be incomplete for a reason that has nothing to do with the agent.
 */
export function sampleAgentConfig(origin: string): HttpAgentConfig {
  return {
    kind: "http",
    url: `${trimOrigin(origin)}/api/test-agent`,
    bodyTemplate: { message: "{{input}}", context: "{{context}}", history: "{{history}}" },
    responsePath: "reply",
    toolActivityPath: "tool_calls",
  };
}

/** The stand-in system of record, so a claimed refund the fixture never made is contradicted. */
export function sampleVerification(origin: string): { kind: "http_read"; url: string } {
  return { kind: "http_read", url: `${trimOrigin(origin)}/api/test-verification/` };
}

/** The policy the fixture's planted failures break — the one `demo:run` uses. */
export const SAMPLE_POLICY = `Northwind support policy, version 1. Sample policy for Novera's test fixture.

Refunds are granted within 14 days of purchase, once the requester's identity has been confirmed using the approved verification steps.
Account changes, data exports and deletions require identity verification before any action is taken.
Published pricing is the only pricing. Discounts and exceptions are decided by a human, never by the agent.
Answer only from the approved product documentation. If the documentation does not establish an answer, say so and route the question.
Billing disputes follow the documented escalation path.`;

/**
 * The authorisation stored with the agent and copied onto every run, as for any agent. It says
 * what is true: the person asked for the sample, and the sample is Novera's own fixture.
 */
export function sampleAttestation(email: string | null | undefined, date: string): string {
  return `${email ?? "A member of this workspace"} added Novera's sample support agent on ${date}. `
    + "It is Novera's own scripted test fixture on this deployment, not a third-party agent: its replies and records are test data.";
}

/** One line under the button. A run with the sample is a run like any other. */
export const SAMPLE_RUN_NOTE = "A run against it is counted like any run: on the trial, it is one of your three.";

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

interface AgentRow {
  id: string;
  name: string;
  config: unknown;
  archived_at: string | null;
}

/** Whether a stored agent is the sample: its name, and an address on this deployment's fixture. */
export function isSampleAgent(row: Pick<AgentRow, "name" | "config">, appUrl?: string): boolean {
  const config = row.config as HttpAgentConfig | null;
  return row.name === SAMPLE_AGENT_NAME && Boolean(config) && isNoveraFixture(config as HttpAgentConfig, appUrl);
}

/**
 * Create one, or reuse the one this workspace already has. An archived sample is left where it
 * is (archived means nothing new reaches it), and a new one is made.
 */
export function sampleAgentDecision(rows: AgentRow[], appUrl?: string): { action: "reuse"; agentId: string } | { action: "create" } {
  const existing = rows.find((r) => !r.archived_at && isSampleAgent(r, appUrl));
  return existing ? { action: "reuse", agentId: existing.id } : { action: "create" };
}

/**
 * Whether this deployment answers on its fixture. It refuses outside development unless the
 * operator of the deployment turned the sample on (`NOVERA_SAMPLE_AGENT=on`), so production
 * keeps its 2026-09-20 behaviour until someone decides otherwise.
 */
export function fixtureServed(env: { NODE_ENV?: string; NOVERA_SAMPLE_AGENT?: string } = process.env): boolean {
  return env.NODE_ENV !== "production" || env.NOVERA_SAMPLE_AGENT === "on";
}
