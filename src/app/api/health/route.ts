import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/service.ts";

/**
 * A liveness answer for an external checker: two booleans and the time they were checked.
 * Nothing else — no version, no region, no counts, no error text — because anyone can call it.
 *
 *   app       always true when this answers at all
 *   database  a head-only count on the built-in suites answered within two seconds
 *
 * The database answer is reused for 30 seconds per instance, so calling this in a loop does
 * not become load on the database.
 */
export const dynamic = "force-dynamic";

const CACHE_MS = 30_000;
const DEADLINE_MS = 2_000;
let cached: { database: boolean; checkedAt: string; at: number } | null = null;

async function databaseReachable(): Promise<boolean> {
  try {
    const query = serviceClient().from("suites").select("id", { count: "exact", head: true }).is("workspace_id", null)
      .abortSignal(AbortSignal.timeout(DEADLINE_MS));
    const { error } = await query;
    return !error;
  } catch {
    return false;
  }
}

export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) {
    cached = { database: await databaseReachable(), checkedAt: new Date(now).toISOString(), at: now };
  }
  return NextResponse.json(
    { app: true, database: cached.database, checked_at: cached.checkedAt },
    { status: cached.database ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
