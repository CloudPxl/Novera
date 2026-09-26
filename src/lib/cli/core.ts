import { contentHash, type Json } from "../report/hash.ts";
import { CI_EXIT } from "../report/ci.ts";
import type { ReportPayload } from "../report/payload.ts";

/**
 * The parts of the `novera` CLI that decide something, kept free of I/O so they can be
 * tested. The CLI itself (`bin/novera.mts`) only reads files, fetches and prints.
 *
 * It reuses the product's own rules — the canonical hash, the suite validator, the CI
 * exit codes — rather than restating them: a verifier with its own copy of the hash
 * would be a second opinion that could disagree with the first.
 */

export const DEFAULT_BASE = "https://www.nover.space";
export const EXPORT_FORMATS = ["md", "csv", "json", "junit"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ReportTarget {
  base: string;
  token: string;
}

/**
 * A report link, or a bare token plus a base. Only `/report/<token>` paths are
 * accepted, and only over https (or http to localhost), so the CLI is never pointed at
 * an arbitrary endpoint with a token attached.
 */
export function parseTarget(arg: string, base = DEFAULT_BASE): ReportTarget | { error: string } {
  const value = arg.trim();
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { error: "That is not a valid report link." };
    }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) return { error: "A report link must use https." };
    const match = url.pathname.match(/^\/report\/([A-Za-z0-9_-]{16,})\/?$/);
    if (!match) return { error: "A report link looks like https://www.nover.space/report/<token>." };
    return { base: url.origin, token: match[1] };
  }
  if (!/^[A-Za-z0-9_-]{16,}$/.test(value)) {
    return { error: "Pass a report link, or the token at the end of one." };
  }
  return { base: base.replace(/\/+$/, ""), token: value };
}

/** The token is the capability; CI logs are not a place to print it whole. */
export function redactToken(token: string): string {
  return `${token.slice(0, 4)}…`;
}

export function exportUrl(target: ReportTarget, format: ExportFormat): string {
  return `${target.base}/api/reports/${encodeURIComponent(target.token)}/export?format=${format}`;
}

/** A refusal from the server, as the exit code a pipeline acts on. */
export function exitForStatus(status: number): 3 | 4 {
  // 404 no such report, 410 revoked or expired, 400 a bad request: none is fixed by
  // retrying. Everything else — 5xx, a rate limit, a proxy page — is infrastructure.
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410
    ? CI_EXIT.configuration
    : CI_EXIT.infrastructure;
}

export function describeStatus(status: number): string {
  if (status === 404) return "No such report. Check the link.";
  if (status === 410) return "This report has been withdrawn or its link has expired.";
  if (status === 400) return "The server refused the request.";
  if (status === 429) return "Rate limited. Try again shortly.";
  return `The server answered ${status}.`;
}

export type Verification =
  | { ok: true; payload: ReportPayload; hash: string; url: string | null }
  | { ok: false; code: 2 | 3; message: string };

/**
 * Checks a JSON export: the payload inside it must hash to the digest it states. That
 * proves the copy is internally intact. Whether it is the report Novera sealed is a
 * second question, answered by comparing against the server (`matchesServer`).
 */
export function verifyExport(value: unknown): Verification {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.content_hash !== "string" || !v.payload || typeof v.payload !== "object") {
    return { ok: false, code: CI_EXIT.configuration, message: "Not a Novera JSON export (no payload or content_hash)." };
  }
  const computed = contentHash(v.payload as Json);
  if (computed !== v.content_hash) {
    return {
      ok: false,
      code: CI_EXIT.incomplete,
      message: `NOT VERIFIED. The payload hashes to ${computed}, but the file states ${v.content_hash}. It was changed after sealing.`,
    };
  }
  return {
    ok: true,
    payload: v.payload as ReportPayload,
    hash: computed,
    url: typeof v.url === "string" ? v.url : null,
  };
}
