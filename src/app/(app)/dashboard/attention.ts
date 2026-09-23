/**
 * What is actually waiting for the person who just signed in.
 *
 * The dashboard used to answer "what exists here" — agents, runs, a count of reports.
 * That is an inventory, and an inventory is what you read when you already know what
 * you came for. The first screen should answer the question someone actually has:
 * *is anything broken, and is anything waiting for me?*
 *
 * Three rules hold this honest:
 *
 * Every item is a stored fact with somewhere to go. Nothing here is a suggestion, a
 * score or an inference about what the operator probably wants.
 *
 * Nothing renders when there is nothing. An "all clear" panel that is always on screen
 * stops being read within a week — and then the week it matters, it is not read either.
 *
 * A run that has not finished is never described by its counts. A partial count shown
 * as a result is the exact thing this product exists not to do.
 */

export type AttentionTone = "fail" | "high" | "medium";

export interface AttentionItem {
  text: string;
  href: string;
  action: string;
  tone: AttentionTone;
}

export interface AttentionInput {
  agents: Array<{ id: string; name: string; attested_at: string | null }>;
  runs: Array<{ id: string; status: string; agent_id: string }>;
  /** Per-run verdict counts, for completed runs only. */
  outcomes: Map<string, { pass: number; fail: number; error: number }>;
  /** The most recent probe for each agent, by agent id. */
  latestProbe: Map<string, { error: string | null }>;
  draftCount: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const nameOf = new Map(input.agents.map((a) => [a.id, a.name]));

  // A run left mid-flight. Vercel kills a function at 60 seconds and runs resume in
  // slices, so an unfinished run is normal for a minute and a problem after that —
  // either way the operator is the one who can tell, and only if they are told.
  const unfinished = input.runs.find((r) => r.status === "running" || r.status === "queued");
  if (unfinished) {
    items.push({
      text: `A run against ${nameOf.get(unfinished.agent_id) ?? "an agent"} has not finished.`,
      href: `/runs/${unfinished.id}`,
      action: "Open it",
      tone: "high",
    });
  }

  for (const agent of input.agents) {
    // A broken connection is invisible until someone opens the agent, and by then
    // they are usually opening it to ask why a run failed.
    if (input.latestProbe.get(agent.id)?.error) {
      items.push({
        text: `${agent.name} did not answer the last connection check.`,
        href: `/agents/${agent.id}`,
        action: "See why",
        tone: "fail",
      });
    }
    if (!agent.attested_at) {
      items.push({
        text: `${agent.name} has no recorded authorisation to test it.`,
        href: `/agents/${agent.id}`,
        action: "Open",
        tone: "fail",
      });
    }
  }

  if (input.draftCount > 0) {
    items.push({
      text: `${input.draftCount} drafted ${plural(input.draftCount, "scenario", "scenarios")} waiting for a decision.`,
      href: "/scenarios",
      action: "Review",
      tone: "medium",
    });
  }

  // Only the most recent completed run. Every earlier one has either been dealt with
  // or been superseded, and a list of every failing run ever is a list nobody reads.
  const lastCompleted = input.runs.find((r) => r.status === "completed");
  const outcome = lastCompleted ? input.outcomes.get(lastCompleted.id) : undefined;
  if (lastCompleted && outcome && outcome.fail + outcome.error > 0) {
    const failed = outcome.fail > 0
      ? `${outcome.fail} failing ${plural(outcome.fail, "scenario", "scenarios")}`
      : "";
    const errored = outcome.error > 0
      ? `${outcome.error} with no result`
      : "";
    items.push({
      text: `The last completed run found ${[failed, errored].filter(Boolean).join(" and ")}.`,
      href: `/runs/${lastCompleted.id}`,
      action: "Inspect",
      tone: "high",
    });
  }

  return items;
}
