import { publicOnlyDispatcher } from "../net/public-url.ts";
import { discardBody } from "../net/read-body.ts";
import type { ScrubbedEvent } from "./scrub.ts";

/**
 * Where a scrubbed error event goes. A reporter only ever receives an event that has
 * already been through `scrubEvent`; none of them sees the error itself.
 *
 * The console line is always on (Vercel keeps function logs; a local run prints them).
 * A vendor is opt-in by environment variable and off by default, and is called from the
 * server only — the browser never sends to it, so the page's CSP does not change.
 */
export interface Reporter {
  name: string;
  send(event: ScrubbedEvent): Promise<void>;
}

/** One JSON line, prefixed so it can be searched for in the Vercel log view. */
export const consoleReporter: Reporter = {
  name: "console",
  async send(event) {
    console.error(`[novera:error] ${JSON.stringify(event)}`);
  },
};

/** A vendor call must not hold up the response it is reporting on for long. */
const VENDOR_DEADLINE_MS = 3_000;

async function post(url: string, body: string, headers: Record<string, string>): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    body,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(VENDOR_DEADLINE_MS),
    dispatcher: publicOnlyDispatcher({ allowLoopback: process.env.NODE_ENV !== "production" }),
  } as RequestInit);
  // The answer is never read beyond its status: a sink has nothing to tell the app.
  await discardBody(response);
  if (!response.ok) throw new Error(`sink answered ${response.status}`);
}

/**
 * A generic JSON webhook: the event as the body, an optional bearer token. Any receiver —
 * a log drain, an alerting webhook, a self-hosted collector — can take this.
 */
export function webhookReporter(url: string, token?: string): Reporter {
  return {
    name: "webhook",
    send: (event) => post(url, JSON.stringify(event), {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    }),
  };
}

/** `https://<public key>@<host>/<project id>`, Sentry's DSN format. Null when malformed. */
export function parseSentryDsn(dsn: string): { endpoint: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, "");
    if (url.protocol !== "https:" || !url.username || !/^\d+$/.test(project)) return null;
    return { endpoint: `https://${url.host}/api/${project}/envelope/`, publicKey: url.username };
  } catch {
    return null;
  }
}

/**
 * Sentry (or a Sentry-compatible collector such as GlitchTip) through its HTTP envelope
 * endpoint, without the SDK: one request per event, the event already scrubbed. No user,
 * no server name, no breadcrumbs, no request body — fields the SDK would add are simply
 * never built.
 */
export function sentryReporter(dsn: string): Reporter | null {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return null;
  return {
    name: "sentry",
    send: (event) => post(parsed.endpoint, sentryEnvelope(event, dsn), {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=novera-observability/1.0`,
    }),
  };
}

export function sentryEnvelope(event: ScrubbedEvent, dsn: string): string {
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const payload = {
    event_id: eventId,
    timestamp: event.timestamp,
    platform: "node",
    level: "error",
    environment: event.environment,
    ...(event.release ? { release: event.release } : {}),
    exception: {
      values: [{
        type: event.name,
        value: event.message,
        ...(event.stack ? { stacktrace: { frames: event.stack.slice().reverse().map((f) => ({ function: f.slice(3, 200) })) } } : {}),
      }],
    },
    ...(event.request ? { request: { method: event.request.method, url: event.request.path, headers: event.request.headers } } : {}),
    tags: { ...(event.context ?? {}), ...(event.digest ? { digest: event.digest } : {}) },
    ...(event.detail ? { extra: event.detail } : {}),
  };
  return [
    JSON.stringify({ event_id: eventId, dsn, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(payload),
  ].join("\n");
}
