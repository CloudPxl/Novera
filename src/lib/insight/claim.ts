import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPublicUrl, guardedFetch } from "../net/public-url.ts";
import { BodyTooLarge, readTextLimited } from "../net/read-body.ts";
import { robotsFromResponse } from "../net/robots.ts";
import { insightSuite } from "./suite.ts";
import {
  BOT_TOKEN, HEARTBEAT_MS, LEASE_MS, NAV_TIMEOUT_MS, PACING_MS, REPLY_TIMEOUT_MS, USER_AGENT,
  type ClaimAnswer, type ClaimRequest,
} from "./protocol.ts";
import type { InsightScanRow, InsightTargetRow } from "./types.ts";

/**
 * Hands the browser worker the next queued scan, after the server has checked what the worker
 * is about to do: the address is public (never a private or reserved network) and the site's
 * robots.txt allows this bot on that page. A scan that fails either check ends here, before
 * any page is opened, and the worker is told to ask again.
 */
export interface RobotsFetch {
  status: number | null;
  body: string | null;
  tooLarge?: boolean;
}

const ROBOTS_LIMIT_BYTES = 64 * 1024;
const ROBOTS_TIMEOUT_MS = 10_000;

export async function fetchRobotsText(robotsUrl: URL): Promise<RobotsFetch> {
  try {
    const response = await guardedFetch(robotsUrl, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) return { status: response.status, body: null };
    try {
      const body = await readTextLimited(response, ROBOTS_LIMIT_BYTES);
      return { status: response.status, body };
    } catch (e) {
      if (e instanceof BodyTooLarge) return { status: response.status, body: null, tooLarge: true };
      return { status: response.status, body: null };
    }
  } catch {
    return { status: null, body: null };
  }
}

async function finishRefused(db: SupabaseClient, scan: InsightScanRow, kind: string, detail: string): Promise<void> {
  await db.rpc("finish_insight_scan", { scan: scan.id, token: scan.lease_token, new_status: "error", kind, detail });
}

export async function claimForWorker(
  args: {
    db: SupabaseClient;
    worker: ClaimRequest;
    now?: () => Date;
    fetchRobots?: (url: URL) => Promise<RobotsFetch>;
    /** The public-address guard; injectable so a test can name a fictional host. */
    checkAddress?: (raw: string) => Promise<URL>;
  },
): Promise<ClaimAnswer> {
  const { db, worker } = args;
  const now = args.now ?? (() => new Date());
  const fetchRobots = args.fetchRobots ?? fetchRobotsText;
  const checkAddress = args.checkAddress ?? ((raw: string) => assertPublicUrl(raw));

  const { error: workerError } = await db.from("insight_workers").upsert(
    { id: worker.worker_id, host_label: worker.host_label ?? null, version: worker.version ?? null, last_seen_at: now().toISOString() },
    { onConflict: "id" },
  );
  if (workerError) throw new Error(`Could not register the worker: ${workerError.message}`);

  const { data: claimed, error: claimError } = await db.rpc("claim_insight_scan", { worker: worker.worker_id, lease_ms: LEASE_MS });
  if (claimError) throw new Error(`Could not claim a scan: ${claimError.message}`);
  const scan = (Array.isArray(claimed) ? claimed[0] : claimed) as InsightScanRow | null | undefined;
  if (!scan || !scan.id) return { scan: null };

  const { data: targetRow, error: targetError } = await db.from("insight_targets").select("*").eq("id", scan.target_id).maybeSingle();
  if (targetError || !targetRow) {
    await finishRefused(db, scan, "target_refused", "The scan's target could not be read.");
    return { scan: null, retry: true };
  }
  const target = targetRow as InsightTargetRow;

  let url: URL;
  try {
    url = await checkAddress(target.demo_url);
  } catch (e) {
    await finishRefused(db, scan, "address_refused", (e instanceof Error ? e.message : "The address was refused.").slice(0, 500));
    return { scan: null, retry: true };
  }

  const robotsUrl = new URL("/robots.txt", url.origin);
  const fetched = await fetchRobots(robotsUrl);
  const decision = fetched.tooLarge
    ? { allowed: false, rule: null, crawlDelayMs: null, reason: `robots.txt is larger than ${ROBOTS_LIMIT_BYTES / 1024} KB; not read` }
    : robotsFromResponse(fetched.status, fetched.body, BOT_TOKEN, url.pathname + url.search);
  const robots = {
    ...(scan.robots ?? {}),
    server: { checked_at: now().toISOString(), status: fetched.status, allowed: decision.allowed, reason: decision.reason, crawl_delay_ms: decision.crawlDelayMs },
  };
  await db.from("insight_scans").update({ robots }).eq("id", scan.id).eq("lease_token", scan.lease_token);

  if (!decision.allowed) {
    await finishRefused(db, scan, "robots_disallowed", decision.reason.slice(0, 500));
    return { scan: null, retry: true };
  }

  const suite = insightSuite(scan.suite_key, scan.suite_version);
  if (!suite) {
    await finishRefused(db, scan, "target_refused", `The scan declares ${scan.suite_key} v${scan.suite_version}, which this deployment does not know.`);
    return { scan: null, retry: true };
  }
  const scenarios = scan.scenario_ids
    .map((id) => suite.cases.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ id: c.id, input: c.input }));

  return {
    scan: {
      id: scan.id,
      lease_token: scan.lease_token as string,
      lease_ms: LEASE_MS,
      heartbeat_ms: HEARTBEAT_MS,
      pacing_ms: Math.max(PACING_MS, decision.crawlDelayMs ?? 0),
      reply_timeout_ms: REPLY_TIMEOUT_MS,
      nav_timeout_ms: NAV_TIMEOUT_MS,
      user_agent: USER_AGENT,
      target: { url: url.toString(), name: target.name },
      scenarios,
      robots: { allowed: true, crawl_delay_ms: decision.crawlDelayMs },
    },
  };
}
