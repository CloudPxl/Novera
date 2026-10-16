/**
 * Errors that are a visitor leaving, not a fault in Novera.
 *
 * When a browser closes a tab, loses signal or navigates away mid-response, Node and Next raise
 * an error on the server side of that connection: "The destination stream errored while writing
 * data", an `AbortError`, `ECONNRESET`, a premature close. Reported as `[novera:error]` they
 * bury real failures, and sent to a vendor they spend its quota on noise.
 *
 * The rule is narrow on purpose. It matches the error's name, its Node `code`, and a short list
 * of exact message shapes, following `cause` up to three levels (Next wraps them). It does not
 * match the bare word "aborted": a run Novera aborted, a transaction the database aborted and
 * `The operation was aborted due to timeout` (a `TimeoutError`: a deadline we set was missed,
 * which is a finding, not a disconnect) must all still be reported.
 *
 * Pure and dependency-free so a test can prove both directions.
 */

const CODES = new Set(["ECONNRESET", "ECONNABORTED", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END", "UND_ERR_ABORTED", "ABORT_ERR"]);

const MESSAGES: RegExp[] = [
  /destination stream errored while writing data/i,
  /\bpremature close\b/i,
  /^aborted$/i,
  /^(?:the )?request (?:was )?aborted\b/i,
  /^(?:the )?(?:client|connection) (?:was )?(?:disconnected|closed|reset)\b/i,
  /^read ECONNRESET\b/,
  /^write (?:ECONNRESET|EPIPE)\b/,
];

function one(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  if (e.name === "AbortError") return true;
  if (typeof e.code === "string" && CODES.has(e.code)) return true;
  if (typeof e.message === "string") {
    const message = e.message.trim();
    if (MESSAGES.some((m) => m.test(message))) return true;
  }
  return false;
}

/** True when `error`, or something it was caused by, is a client disconnect. */
export function isBenignDisconnect(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth++) {
    if (one(current)) return true;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/** What may be logged about one: its class and code, never its message. */
export function benignLabel(error: unknown): string {
  const e = (typeof error === "object" && error !== null ? error : {}) as { name?: unknown; code?: unknown };
  const name = typeof e.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(e.name) ? e.name : "Error";
  const code = typeof e.code === "string" && /^[A-Z0-9_]{1,40}$/.test(e.code) ? ` ${e.code}` : "";
  return `${name}${code}`;
}
