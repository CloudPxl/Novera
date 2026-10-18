import { runChecks, describeFailures, type DeterministicCheck } from "../../judge/checks.ts";
import { redactCredentials } from "../../providers/types.ts";
import { assertPublicUrl, publicOnlyDispatcher, refusedAddress } from "../../net/public-url.ts";
import { BodyTooLarge, discardBody, formatLimit, readTextLimited } from "../../net/read-body.ts";
import type {
  ConnectorMode, ValidationResult, VerificationConnector, VerificationInput, VerificationObservation,
} from "./types.ts";

/** The most of a read-back answer Novera reads; it is parsed for one value and never stored. */
export const MAX_READBACK_BYTES = 256 * 1024;

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
  /**
   * Declared by the customer on the agent's read-back settings: this system answers 404 for a
   * missing record and never for a wrong address. Stored only when set; absent is the default,
   * under which a 404 is `unavailable`. A run reads the value its manifest froze, not this one.
   */
  not_found_means?: "contradicted";
}

const VERSION = "1.1.0";

/** The answer a GET produced, or why there is nothing to read. */
type Fetched =
  | { ok: true; text: string; status: number }
  | { ok: false; why: string; notFound?: { page: boolean } };

/**
 * Whether a 404's body is a page a router or proxy rendered rather than an answer from the
 * record's own API. An HTML 404 is what a wrong address gets from almost every web server, so it
 * is never read as a missing record, whatever was declared.
 */
export function isGenericNotFoundPage(contentType: string | null, body: string): boolean {
  if (contentType && /\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) return true;
  return body.replace(/^\uFEFF/, "").trimStart().startsWith("<");
}

/** The fixed sentences for a 404, so the tests and the report read the same words. */
export const NOT_FOUND_TEXT = {
  page: "The read-back answered with a generic 404 page, which usually means the address is wrong, not that the record is missing.",
  undeclared:
    "The read-back answered 404. Novera cannot tell a missing record from a wrong address; if your system answers 404 only "
    + "for missing records, turn on 'A 404 from this system means the record does not exist' on the agent's read-back settings.",
  bySetting: "When this test started, the agent's read-back settings declared that a 404 from this system means the record does not exist.",
  byScenario: "This scenario declares that a 404 at this path means the record does not exist.",
} as const;

/** The scenario's own path, never the configured base: the base can carry a token in its path. */
function describeTarget(path: string | undefined): string {
  return path ? `GET …/${path}` : "GET on the configured address";
}

/**
 * Never let a scenario's path escape the configured base: not to another host, and not out of
 * the configured path either. The path is appended under the base (`/orders` + `NW-1` →
 * `/orders/NW-1`, with or without a trailing slash), and anything that climbs out of it
 * (`../admin`, `/admin`) or names another address is refused — the credential header travels
 * with every read, and the settings page promises "only paths underneath this one" (end-to-end
 * audit, 2026-10-11: a path used to resolve against the parent directory and anywhere on the
 * host).
 */
export function resolveReadBack(base: string, path?: string): URL | null {
  try {
    const url = new URL(base);
    if (!path) return url;
    // A scenario is authored data: `https://elsewhere`, `//elsewhere` or a leading `/` would
    // point the read-back somewhere the customer never authorised.
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/") || path.startsWith("\\")) return null;
    const q = path.indexOf("?");
    const pathPart = q === -1 ? path : path.slice(0, q);
    const query = q === -1 ? "" : path.slice(q + 1);
    const prefix = url.pathname.replace(/\/+$/, "");
    const merged = new URL(url.origin);
    merged.pathname = `${prefix}/${pathPart}`;
    if (query) merged.search = `?${query}`;
    if (merged.origin !== url.origin || !merged.pathname.startsWith(`${prefix}/`)) return null;
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

  async function fetchBody(path?: string, reachableOnly = false): Promise<Fetched> {
    const url = resolveReadBack(config.url, path);
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
      if (response.status >= 300 && response.status < 400) {
        await discardBody(response);
        return { ok: false, why: `The verification endpoint answered ${response.status} (a redirect), and redirects are not followed.` };
      }
      // Saving the endpoint asks only whether the server is there. A REST collection root
      // commonly answers 404 or 405 while every record beneath it answers; requiring a 2xx at
      // the base refused ordinary APIs (app-wide audit, 2026-10-08). A refused credential or a
      // server error still fails here, where it can be fixed.
      if (reachableOnly && [400, 404, 405].includes(response.status)) {
        await discardBody(response);
        return { ok: true, text: "", status: response.status };
      }
      // A 404 is read, briefly, only to tell a router's page from an API's answer. The body is
      // inspected for its first character and never stored or quoted.
      if (response.status === 404) {
        const text = await readTextLimited(response, MAX_READBACK_BYTES);
        return {
          ok: false,
          why: `The verification endpoint answered ${response.status}.`,
          notFound: { page: isGenericNotFoundPage(response.headers.get("content-type"), text) },
        };
      }
      if (!response.ok) {
        await discardBody(response);
        return { ok: false, why: `The verification endpoint answered ${response.status}.` };
      }
      // Read under the same deadline, and only so far: the body is parsed, never stored.
      return { ok: true, text: await readTextLimited(response, MAX_READBACK_BYTES), status: response.status };
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        return { ok: false, why: `The verification endpoint's answer was larger than ${formatLimit(MAX_READBACK_BYTES)}, so it was not read.` };
      }
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return { ok: false, why: `The verification endpoint did not finish answering within ${Math.round((config.timeoutMs ?? 10_000) / 1000)} s.` };
      }
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
      const result = await fetchBody(undefined, true);
      return result.ok
        ? { ok: true, detail: result.status >= 400
          ? `Reachable: the base address answered ${result.status} in ${Date.now() - started}ms, which is fine — scenarios read paths beneath it.`
          : `Answered in ${Date.now() - started}ms.` }
        : { ok: false, detail: redactCredentials(result.why, secret) };
    },

    async verify(input: VerificationInput): Promise<VerificationObservation> {
      const started = Date.now();
      const result = await fetchBody(input.path);
      const latencyMs = Date.now() - started;
      const base = { connector: "http_read", connectorVersion: VERSION, mode, latencyMs, checked: input.expect };

      if (!result.ok && result.notFound) {
        // A 404 is a missing record only where someone who knows this system said so, and only
        // when it is not a router's page. Anything else is a wrong address as far as Novera can
        // tell, and a false contradiction is the worst finding this product could make.
        const declaredBy = input.notFoundMeans === "contradicted"
          ? NOT_FOUND_TEXT.byScenario
          : config.not_found_means === "contradicted" ? NOT_FOUND_TEXT.bySetting : null;
        if (result.notFound.page) return { ...base, status: "unavailable", detail: NOT_FOUND_TEXT.page };
        if (!declaredBy) return { ...base, status: "unavailable", detail: NOT_FOUND_TEXT.undeclared };
        return {
          ...base,
          status: "contradicted",
          detail: redactCredentials(
            `Record not found in the system of record: ${describeTarget(input.path)} answered 404. ${declaredBy}`,
            secret,
          ),
        };
      }

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
            // sentence travels into a report. The checks word their findings about "the
            // response"; here that is the system's record, never the agent's reply, so it is
            // named as such (chaos audit 2026-10-17: "The response contains "open"" sat beside
            // a reply that said no such thing).
            detail: `The customer's own system does not show the expected state. ${describeFailures(failures).replace(/\bThe response\b/g, "Its record")}`,
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
        case "must_match": return c.describe ? `contains ${c.describe}` : `matches /${c.pattern}/`;
        case "must_not_match": return c.describe ? `does not contain ${c.describe}` : `does not match /${c.pattern}/`;
        default: return c.type;
      }
    })
    .join("; ");
}
