/**
 * How the graders behaved during one run, counted from the attempts stored on its cases.
 *
 * `run_cases.judge_attempts` keeps every request the router made or declined for a
 * case, including the ones that failed. Summed per vendor, they answer the question a
 * verdict count cannot: did the grading go smoothly, or were verdicts reached by
 * falling back past rate limits and timeouts? Nothing is estimated — a request that
 * was not stored is not counted, and a failure recorded before failures were typed
 * (2026-09-29) is counted as unclassified rather than guessed from its message.
 */

type Reason =
  | "rate_limited" | "timed_out" | "provider_error" | "unauthorized" | "invalid_output"
  | "refused_data_class" | "no_credential" | "out_of_time" | "skipped_open_circuit";

/** Not sent to the vendor at all: passed over before any request left Novera. */
const NOT_SENT: ReadonlySet<string> = new Set(["refused_data_class", "no_credential", "out_of_time", "skipped_open_circuit"]);

export interface VendorHealth {
  vendor: string;
  /** Requests that reached the vendor. */
  sent: number;
  /** Answered with a readable verdict. */
  answered: number;
  /** Answered, but not with a verdict Novera could read. */
  unreadable: number;
  rateLimited: number;
  timedOut: number;
  /** Errors, refused keys, and failures stored before reasons were typed. */
  failed: number;
  /** Passed over without a request: skipped after repeated failures, out of time, not allowed the data, or no key. */
  notSent: number;
  /** The slowest answer, in milliseconds; null when nothing answered. */
  slowestMs: number | null;
}

export interface GradingHealth {
  vendors: VendorHealth[];
  /** Cases where a grader request failed and the case still reached a verdict. */
  absorbed: number;
  /** Failures stored before reasons were typed, so the line can say why it cannot be more specific. */
  unclassified: number;
}

interface AttemptLike {
  connection?: unknown;
  ok?: unknown;
  ms?: unknown;
  reason?: unknown;
}

export function gradingHealth(cases: Array<{ status: unknown; judge_attempts: unknown }>): GradingHealth {
  const byVendor = new Map<string, VendorHealth>();
  let absorbed = 0;
  let unclassified = 0;

  for (const c of cases) {
    const attempts = Array.isArray(c.judge_attempts) ? (c.judge_attempts as AttemptLike[]) : [];
    let sentFailure = false;
    for (const a of attempts) {
      if (!a || typeof a.connection !== "string") continue;
      const v = byVendor.get(a.connection) ?? {
        vendor: a.connection, sent: 0, answered: 0, unreadable: 0, rateLimited: 0, timedOut: 0, failed: 0, notSent: 0, slowestMs: null,
      };
      byVendor.set(a.connection, v);
      const reason = typeof a.reason === "string" ? (a.reason as Reason) : undefined;

      if (reason && NOT_SENT.has(reason)) {
        v.notSent++;
        continue;
      }
      v.sent++;
      if (a.ok === true) {
        if (reason === "invalid_output") {
          v.unreadable++;
          sentFailure = true;
        } else {
          v.answered++;
        }
        if (typeof a.ms === "number" && Number.isFinite(a.ms)) v.slowestMs = Math.max(v.slowestMs ?? 0, a.ms);
        continue;
      }
      sentFailure = true;
      if (reason === "rate_limited") v.rateLimited++;
      else if (reason === "timed_out") v.timedOut++;
      else {
        v.failed++;
        if (!reason) unclassified++;
      }
    }
    if (sentFailure && (c.status === "pass" || c.status === "fail")) absorbed++;
  }

  const vendors = [...byVendor.values()].sort((a, b) => b.sent - a.sent || a.vendor.localeCompare(b.vendor));
  return { vendors, absorbed, unclassified };
}

function seconds(ms: number): string {
  return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
}

/** One vendor in words: "groq: 40 requests, 32 answered, 8 rate-limited, slowest answer 3.1 s". */
export function describeVendor(v: VendorHealth): string {
  const parts = [`${v.sent} ${v.sent === 1 ? "request" : "requests"}`, `${v.answered} answered`];
  if (v.unreadable) parts.push(`${v.unreadable} unreadable`);
  if (v.rateLimited) parts.push(`${v.rateLimited} rate-limited`);
  if (v.timedOut) parts.push(`${v.timedOut} timed out`);
  if (v.failed) parts.push(`${v.failed} failed`);
  if (v.notSent) parts.push(`${v.notSent} not sent`);
  if (v.slowestMs !== null) parts.push(`slowest answer ${seconds(v.slowestMs)}`);
  return `${v.vendor}: ${parts.join(", ")}`;
}
