import { runChecks, describeFailures, type DeterministicCheck } from "../../judge/checks.ts";
import { redactCredentials } from "../../providers/types.ts";
import { assertPublicUrl, publicOnlyDispatcher, refusedAddress } from "../../net/public-url.ts";
import type {
  ConnectorMode, ValidationResult, VerificationConnector, VerificationInput, VerificationObservation,
} from "./types.ts";

/**
 * A read-only HTTP endpoint the customer already has: an order lookup, a status
 * endpoint, a read replica behind an API.
 *
 * GET only, and that is a rule rather than a default. A verification that can change
 * state is not a verification — it is a second actor in the test, and a POST to
 * "confirm" a refund is indistinguishable from making one.
 */
export interface HttpVerificationConfig {
  kind: "http_read";
  /** Base URL. The scenario's path is appended; nothing else is interpolated. */
  url: string;
  headers?: Record<string, string>;
  /** Header the sealed credential is injected into, if the endpoint needs one. */
  authHeaderName?: string;
  timeoutMs?: number;
}

const VERSION = "1.0.0";

/** Never let a scenario's path escape the configured base. */
function resolve(base: string, path?: string): URL | null {
  try {
    const url = new URL(base);
    if (!path) return url;
    const merged = new URL(path, url);
    // A scenario is authored data. Without this, `path: "https://elsewhere"` would
    // point the read-back at a host the customer never authorised.
    if (merged.origin !== url.origin) return null;
    return merged;
  } catch {
    return null;
  }
}

export function httpVerificationConnector(
  config: HttpVerificationConfig,
  secret?: string,
): VerificationConnector {
  const mode: ConnectorMode = "read_only";

  async function fetchBody(path?: string): Promise<{ ok: true; text: string } | { ok: false; why: string }> {
    const url = resolve(config.url, path);
    if (!url) return { ok: false, why: "The scenario's verification path does not resolve inside the configured endpoint." };

    const headers: Record<string, string> = { accept: "application/json, text/plain;q=0.9", ...config.headers };
    if (secret && config.authHeaderName) headers[config.authHeaderName] = secret;

    try {
      await assertPublicUrl(url.toString());
    } catch (error) {
      return { ok: false, why: `Not called: ${error instanceof Error ? error.message : String(error)}` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
    try {
      // Never followed: a redirect would carry the read-back — and its credential —
      // outside the endpoint the customer configured, which this connector promises not
      // to leave.
      const response = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "manual", dispatcher: publicOnlyDispatcher() } as RequestInit);
      const text = await response.text();
      if (response.status >= 300 && response.status < 400) {
        return { ok: false, why: `The verification endpoint answered ${response.status} (a redirect), and redirects are not followed.` };
      }
      if (!response.ok) {
        return { ok: false, why: `The verification endpoint answered ${response.status}.` };
      }
      return { ok: true, text };
    } catch (error) {
      const why = refusedAddress(error) ?? (error instanceof Error ? error.message : String(error));
      return { ok: false, why: `The verification endpoint could not be reached: ${why}` };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: "http_read",
    version: VERSION,
    mode,

    async validate(): Promise<ValidationResult> {
      const started = Date.now();
      const result = await fetchBody();
      return result.ok
        ? { ok: true, detail: `Answered in ${Date.now() - started}ms.` }
        : { ok: false, detail: redactCredentials(result.why, secret) };
    },

    async verify(input: VerificationInput): Promise<VerificationObservation> {
      const started = Date.now();
      const result = await fetchBody(input.path);
      const latencyMs = Date.now() - started;
      const base = { connector: "http_read", connectorVersion: VERSION, mode, latencyMs, checked: input.expect };

      if (!result.ok) {
        // Could not look. Not the agent's failure, and not a pass either.
        return { ...base, status: "unavailable", detail: redactCredentials(result.why, secret) };
      }

      const failures = runChecks(input.expect, {
        responseText: result.text,
        toolActivity: null,
        latencyMs: null,
      });

      return failures.length === 0
        ? {
            ...base,
            status: "confirmed",
            detail: `The customer's own system shows the expected state (${describeExpectation(input.expect)}).`,
          }
        : {
            ...base,
            status: "contradicted",
            // The read-back body is never quoted: it is the customer's data, and this
            // sentence travels into a report.
            detail: `The customer's own system does not show the expected state. ${describeFailures(failures)}`,
          };
    },
  };
}

/** What was looked for, in words, so "confirmed" is not taken on trust. */
function describeExpectation(checks: DeterministicCheck[]): string {
  return checks
    .map((c) => {
      switch (c.type) {
        case "must_contain": return `contains "${c.value}"`;
        case "must_not_contain": return `does not contain "${c.value}"`;
        case "must_match": return `matches /${c.pattern}/`;
        case "must_not_match": return `does not match /${c.pattern}/`;
        default: return c.type;
      }
    })
    .join("; ");
}
