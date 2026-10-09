import { scrubEvent, type RawRequest, type ScrubbedEvent } from "./scrub.ts";
import { consoleReporter, sentryReporter, webhookReporter, type Reporter } from "./reporter.ts";

/**
 * The one way the server reports an error: build the event from an allow list, scrub it,
 * hand it to every configured reporter. Never throws — a failure to report must not become
 * a second failure of the request — and never waits longer than a vendor's deadline.
 *
 * Server-side only (it reaches the network through the public-address guard, which needs
 * Node's DNS). Not marked `server-only`, because `instrumentation.ts` imports it outside the
 * react-server layer, where that marker throws.
 *
 * Configuration (all optional; docs/setup/monitoring.md):
 *   NOVERA_ERROR_REPORTING=off        nothing at all, not even the console line
 *   NOVERA_ERROR_SENTRY_DSN=…         also send to Sentry or a Sentry-compatible collector
 *   NOVERA_ERROR_WEBHOOK_URL=…        also POST the JSON event here
 *   NOVERA_ERROR_WEBHOOK_TOKEN=…      sent as `Authorization: Bearer …` to that webhook
 */

/** A burst of identical failures must not become a burst of vendor calls. Per instance. */
const VENDOR_SENDS_PER_MINUTE = 30;
let windowStart = 0;
let windowSends = 0;

function vendorAllowance(now: number): boolean {
  if (now - windowStart > 60_000) { windowStart = now; windowSends = 0; }
  windowSends++;
  return windowSends <= VENDOR_SENDS_PER_MINUTE;
}

export function configuredReporters(env: Record<string, string | undefined> = process.env): { console: boolean; vendors: Reporter[]; problems: string[] } {
  if (env.NOVERA_ERROR_REPORTING === "off") return { console: false, vendors: [], problems: [] };
  const vendors: Reporter[] = [];
  const problems: string[] = [];
  if (env.NOVERA_ERROR_SENTRY_DSN) {
    const sentry = sentryReporter(env.NOVERA_ERROR_SENTRY_DSN);
    if (sentry) vendors.push(sentry);
    else problems.push("NOVERA_ERROR_SENTRY_DSN is not a DSN of the form https://<key>@<host>/<project id>");
  }
  if (env.NOVERA_ERROR_WEBHOOK_URL) {
    if (/^https:\/\//.test(env.NOVERA_ERROR_WEBHOOK_URL) || (env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.NOVERA_ERROR_WEBHOOK_URL))) {
      vendors.push(webhookReporter(env.NOVERA_ERROR_WEBHOOK_URL, env.NOVERA_ERROR_WEBHOOK_TOKEN || undefined));
    } else {
      problems.push("NOVERA_ERROR_WEBHOOK_URL must be an https address");
    }
  }
  return { console: true, vendors, problems };
}

export interface CaptureInput {
  request?: RawRequest;
  context?: Record<string, unknown>;
  /** Short enum-like values only (see `scrubDetail`); anything else is dropped. */
  detail?: Record<string, unknown>;
}

/** Reports `error`. Returns the event that left, or null when reporting is off or failed. */
export async function captureError(error: unknown, input: CaptureInput = {}): Promise<ScrubbedEvent | null> {
  try {
    const { console: toConsole, vendors, problems } = configuredReporters();
    if (!toConsole) return null;
    const event = scrubEvent({
      error,
      request: input.request,
      context: input.context,
      detail: input.detail,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
    });
    await consoleReporter.send(event);
    for (const problem of problems) console.error(`[novera:error] reporter not configured: ${problem}`);
    if (vendors.length && vendorAllowance(Date.now())) {
      const results = await Promise.allSettled(vendors.map((r) => r.send(event)));
      results.forEach((r, i) => {
        // The reason is ours (status code, timeout), never the event; still scrubbed.
        if (r.status === "rejected") console.error(`[novera:error] ${vendors[i].name} reporter failed: ${r.reason instanceof Error ? r.reason.name : "error"}`);
      });
    }
    return event;
  } catch {
    return null;
  }
}
