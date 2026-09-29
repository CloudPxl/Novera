/**
 * When a scheduled run is due, in UTC and nothing else.
 *
 * A schedule's time is stated in UTC on screen, in the database and here. A local-time
 * schedule moves by an hour twice a year in most of the EU, and "why did Tuesday's run
 * start at 07:00?" is not a question worth creating.
 *
 * Browser-safe: the form previews the next run with the same function the clock uses.
 */

export type Cadence = "daily" | "weekly";

export interface ScheduleTiming {
  cadence: Cadence;
  /** 0–23. */
  hourUtc: number;
  /** 0 = Sunday … 6 = Saturday, as `getUTCDay`. Weekly only. */
  weekday: number | null;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** At most this many schedules not cancelled, per workspace. Each one spends runs. */
export const MAX_ACTIVE_SCHEDULES = 5;

export function validTiming(t: { cadence: string; hourUtc: number; weekday: number | null }): t is ScheduleTiming {
  if (t.cadence !== "daily" && t.cadence !== "weekly") return false;
  if (!Number.isInteger(t.hourUtc) || t.hourUtc < 0 || t.hourUtc > 23) return false;
  if (t.cadence === "daily") return t.weekday === null;
  return t.weekday !== null && Number.isInteger(t.weekday) && t.weekday >= 0 && t.weekday <= 6;
}

/**
 * The first occurrence strictly after `after`. Missed occurrences are not caught up:
 * a clock that was down for three days runs the schedule once when it returns, not
 * three times in a row.
 */
export function nextOccurrence(t: ScheduleTiming, after: Date): Date {
  const candidate = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), t.hourUtc));
  while (
    candidate.getTime() <= after.getTime() ||
    (t.cadence === "weekly" && candidate.getUTCDay() !== t.weekday)
  ) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

export function hourLabel(hourUtc: number): string {
  return `${String(hourUtc).padStart(2, "0")}:00 UTC`;
}

/** "Daily at 06:00 UTC" · "Mondays at 06:00 UTC". */
export function describeTiming(t: ScheduleTiming): string {
  return t.cadence === "daily"
    ? `Daily at ${hourLabel(t.hourUtc)}`
    : `${WEEKDAYS[t.weekday ?? 0]}s at ${hourLabel(t.hourUtc)}`;
}

/** "Tue 29 Sep, 06:00 UTC" — the date spelled out, so no reader has to guess the order. */
export function formatUtc(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const day = WEEKDAYS[d.getUTCDay()].slice(0, 3);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${day} ${d.getUTCDate()} ${month}, ${time} UTC`;
}

export type ScheduleState = "active" | "paused" | "cancelled";

export function scheduleState(s: { paused_at: string | null; cancelled_at: string | null }): ScheduleState {
  if (s.cancelled_at) return "cancelled";
  if (s.paused_at) return "paused";
  return "active";
}
