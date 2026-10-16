/**
 * Whether a run in flight has stopped moving, from its stored rows only.
 *
 * A run executes in slices (`advanceRun`, src/lib/workflow/start-run.ts). A run started from
 * the app is driven by its open run page, a scheduled one by the clock, an API one by its
 * caller; when that driver goes away mid-run — a closed tab, a caller that gave up — the run
 * simply waits. Nothing is lost: every scenario already recorded stays, and the next slice
 * skips it. This says when that has happened, so a person can be told and continue it.
 *
 * "Last progress" is the same moment the idle-run sweep reads (0040): the newest of the run's
 * creation, its start and its newest recorded scenario. Never an estimate: a run with no
 * stored movement is described by the timestamps it has.
 *
 * A held lease (0047) means a slice is working on the run right now, however long it has been
 * since a scenario was recorded; that is "another process is advancing it", never "stalled".
 */

/** A run that has recorded nothing for longer than this, with no slice holding it, is stalled. */
export const STALL_AFTER_MS = 3 * 60_000;

export interface RunProgress {
  status: string;
  createdAt: string;
  startedAt: string | null;
  /** The newest `run_cases.created_at` for the run, or null when none is recorded yet. */
  lastCaseAt: string | null;
  /** `runs.lease_until`: a slice holds the run while this is in the future. */
  leaseUntil: string | null;
}

export type StallState =
  /** Completed or aborted: nothing left to continue. */
  | { kind: "settled" }
  /** In flight and recorded something within the last three minutes, or a slice holds it. */
  | { kind: "moving"; idleMs: number }
  /** Nothing recorded for over three minutes, but a slice holds the lease right now. */
  | { kind: "held"; idleMs: number; minutes: number }
  /** Nothing recorded for over three minutes and nothing holds it: it waits for someone to continue it. */
  | { kind: "stalled"; idleMs: number; minutes: number };

const at = (iso: string | null | undefined): number => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** The run's last stored movement, in epoch milliseconds — as 0040's idle sweep computes it. */
export function lastProgressAt(p: Pick<RunProgress, "createdAt" | "startedAt" | "lastCaseAt">): number {
  return Math.max(at(p.createdAt), at(p.startedAt), at(p.lastCaseAt));
}

export function stallState(p: RunProgress, now: number = Date.now()): StallState {
  if (p.status !== "queued" && p.status !== "running") return { kind: "settled" };
  const last = lastProgressAt(p);
  // A run with no readable timestamp at all is not described as stalled: there is nothing to measure.
  if (!Number.isFinite(last)) return { kind: "moving", idleMs: 0 };
  const idleMs = Math.max(0, now - last);
  const held = at(p.leaseUntil) > now;
  if (idleMs <= STALL_AFTER_MS) return { kind: "moving", idleMs };
  const minutes = Math.floor(idleMs / 60_000);
  return held ? { kind: "held", idleMs, minutes } : { kind: "stalled", idleMs, minutes };
}

/** "4 minutes", "1 hour", "3 hours" — how long a run has not moved, in whole units. */
export function idleWords(minutes: number): string {
  if (minutes < 90) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** The sentence shown wherever a stalled run is mentioned: the run page and the dashboard. */
export const NOTHING_LOST = "Nothing is lost: every scenario recorded so far is kept.";

export function stalledSentence(minutes: number, subject = "This run"): string {
  return `${subject} has not moved for ${idleWords(minutes)}. ${NOTHING_LOST}`;
}

export function heldSentence(minutes: number, subject = "This run"): string {
  return `${subject} has recorded nothing for ${idleWords(minutes)}, but another process is advancing it right now. It continues on its own.`;
}

/** The clock, read once per request by a server page and handed down, so every sentence on it measures from one moment. */
export function readClock(): number {
  return Date.now();
}
