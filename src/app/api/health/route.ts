import { NextResponse } from "next/server";
import { getHealth } from "@/lib/observability/health.ts";

/**
 * A liveness answer for an external checker. Anyone can call it, so it carries status words and
 * one latency figure, nothing else — no version, region, count, name or error text:
 *
 *   app, database, checked_at   from the first version, unchanged
 *   status                      "ok" | "degraded" | "down"
 *   checks.database             status and how long the answer took, in milliseconds
 *   checks.runner               "degraded" when a run has made no progress for over 15 minutes
 *   checks.grading              "degraded" when fewer than two grading vendors are configured
 *
 * 503 only when the database is unreachable; a degraded platform still answers 200. The
 * check is src/lib/observability/health.ts, shared with /status, and is reused for 30 seconds
 * per instance, so calling this in a loop does not become load on the database.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await getHealth();
  return NextResponse.json(report, {
    status: report.database ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
