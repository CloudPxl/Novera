/**
 * Where a run's time went, and what is holding it up now (2026-11-13). Read from stored rows only:
 * the run's `created_at` and `started_at`, each case's `usage.timing` (`CaseTiming` in
 * `src/lib/runner/execute.ts`) and, for a case recorded before timing was stored, its agent
 * `latency_ms`. Browser-safe: the live run page and the server-rendered overview read the same
 * function, so the two never disagree about whose side the delay is on.
 */

/** A case's error that says the agent's platform asked Novera to slow down (the runner's own words). */
export const AGENT_LIMIT_ERROR = /over a limit|^Agent returned HTTP 429\b/;

export interface TimedCase {
  status?: string | null;
  created_at?: string | null;
  latency_ms?: number | null;
  error?: string | null;
  timing?: { agent_ms?: unknown; grading_ms?: unknown; grading_wait_ms?: unknown } | null;
}

export interface TimingSummary {
  /** From the run's creation to its first slice; null before it started. */
  queuedMs: number | null;
  /** Cases with an agent time. */
  agentCases: number;
  agentAvgMs: number | null;
  agentTotalMs: number;
  /** Cases a model graded (rule- and read-back-settled cases spent no grading time). */
  gradedCases: number;
  gradingAvgMs: number | null;
  gradingTotalMs: number;
  /** The part of the grading time spent waiting for a grader's rate limit. */
  gradingWaitMs: number;
  /** Cases whose agent said it was over a limit. */
  agentLimited: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export function summariseTiming(cases: readonly TimedCase[], run: { createdAt?: string | null; startedAt?: string | null }): TimingSummary {
  let agentCases = 0, agentTotalMs = 0, gradedCases = 0, gradingTotalMs = 0, gradingWaitMs = 0, agentLimited = 0;
  for (const c of cases) {
    const agent = num(c.timing?.agent_ms) ?? num(c.latency_ms);
    if (agent !== null && agent > 0) { agentCases += 1; agentTotalMs += agent; }
    const grading = num(c.timing?.grading_ms);
    if (grading !== null && grading > 0) {
      gradedCases += 1;
      gradingTotalMs += grading;
      gradingWaitMs += Math.min(grading, num(c.timing?.grading_wait_ms) ?? 0);
    }
    if (typeof c.error === "string" && AGENT_LIMIT_ERROR.test(c.error)) agentLimited += 1;
  }
  const created = run.createdAt ? Date.parse(run.createdAt) : NaN;
  const started = run.startedAt ? Date.parse(run.startedAt) : NaN;
  return {
    queuedMs: Number.isFinite(created) && Number.isFinite(started) ? Math.max(0, started - created) : null,
    agentCases,
    agentAvgMs: agentCases ? Math.round(agentTotalMs / agentCases) : null,
    agentTotalMs,
    gradedCases,
    gradingAvgMs: gradedCases ? Math.round(gradingTotalMs / gradedCases) : null,
    gradingTotalMs,
    gradingWaitMs,
    agentLimited,
  };
}

/** The newest `n` cases, for the live view: what is slow now, not what was slow at the start. */
export function recentCases<T extends TimedCase>(cases: readonly T[], n = 8): T[] {
  return [...cases].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, n);
}

/** Above this average reply time, the agent is named as the slow part. */
export const SLOW_AGENT_MS = 3_000;

export type BottleneckKind = "queued_slots" | "queued_agent" | "agent_limited" | "agent_slow" | "grading_wait" | "normal" | "starting";

export interface Bottleneck {
  kind: BottleneckKind;
  /** Whose side the delay is on: the agent's, Novera's, or nobody's. */
  side: "agent" | "novera" | "none";
  sentence: string;
}

export function seconds(ms: number | null): string {
  if (ms === null) return "–";
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

/**
 * What is holding a running run up, in one sentence. `recent` is the summary of the newest cases;
 * `queue` is what the last request for a slice said; `regrading` how many answered scenarios wait
 * for a grader.
 */
export function bottleneck(recent: TimingSummary, live: { queue?: { reason: "slots" | "agent"; position: number } | null; regrading?: number }): Bottleneck {
  const q = live.queue;
  if (q?.reason === "slots") {
    return { kind: "queued_slots", side: "novera", sentence: `Queued: position ${q.position} for one of Novera's grading slots. It starts on its own when a running slice hands back; nothing has been sent to your agent yet.` };
  }
  if (q?.reason === "agent") {
    return { kind: "queued_agent", side: "none", sentence: `Waiting: other runs are testing this agent right now, and Novera limits how many send to one agent at once. This run is ${q.position === 1 ? "next" : `number ${q.position}`} in line and starts on its own.` };
  }
  if (recent.agentLimited > 0) {
    return { kind: "agent_limited", side: "agent", sentence: `Slowest part: your agent's platform. It said it was over a limit on ${recent.agentLimited} of the latest scenarios, so Novera waits as asked and sends one at a time.` };
  }
  const waiting = live.regrading ?? 0;
  if (waiting > 0 || (recent.gradingTotalMs > 0 && recent.gradingWaitMs / recent.gradingTotalMs > 0.3)) {
    return {
      kind: "grading_wait", side: "novera",
      sentence: waiting > 0
        ? `Slowest part: Novera's AI graders. ${waiting} answered ${waiting === 1 ? "scenario waits" : "scenarios wait"} for a grading model's rate limit and will be graded on their own; nothing is sent to your agent again.`
        : `Slowest part: Novera's AI graders, which spent ${seconds(recent.gradingWaitMs)} of the latest ${seconds(recent.gradingTotalMs)} of grading waiting for a model's rate limit.`,
    };
  }
  if (recent.agentAvgMs !== null && recent.agentAvgMs > SLOW_AGENT_MS) {
    return { kind: "agent_slow", side: "agent", sentence: `Slowest part: your agent, at ${seconds(recent.agentAvgMs)} a reply on average. Novera's grading takes ${seconds(recent.gradingAvgMs)} a scenario.` };
  }
  if (recent.agentCases === 0 && recent.gradedCases === 0) {
    return { kind: "starting", side: "none", sentence: "Starting: checking that your agent answers before the first scenario." };
  }
  return { kind: "normal", side: "none", sentence: `Running normally: your agent ${seconds(recent.agentAvgMs)} a reply, Novera's grading ${seconds(recent.gradingAvgMs)} a scenario.` };
}
