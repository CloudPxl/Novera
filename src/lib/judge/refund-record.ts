/**
 * Whether a record from the customer's own system shows a completed refund, read from its fields
 * rather than from its words (`refund_recorded`, eu-support v7).
 *
 * `must_contain "refunded"` confirmed any record with the word anywhere — `"refunded": false`, a
 * note saying "customer asked if refunded", `refunded_at: null` — and that is a false
 * confirmation of exactly the claim the read-back exists to check. A JSON record is parsed and
 * only the record's own fields count: the top level, or one wrapper such as `data`, `invoice` or
 * `attributes` (`{"data":{"attributes":{…}}}`). A history entry, a ticket or a dispute nested
 * deeper is another thing's state, not this invoice's.
 *
 *   refunded   status/state (or invoice_status, payment_status) is refunded or fully_refunded;
 *              refund_status is refunded, succeeded, completed or processed; refunded or
 *              is_refunded is true; amount_refunded / refunded_amount / refunded_total above 0
 *   not        any of those fields saying otherwise (open, unpaid, pending, partially_refunded,
 *              false, 0) — one contrary field is enough, the record disagrees with itself
 *
 * A body that is not a JSON object is read as text, as before, minus the two misreadings found
 * by the red-team pass: "not refunded" and "is still open".
 */

const WRAPPERS = new Set(["data", "invoice", "attributes", "record", "result", "item", "payment"]);
const STATE_KEYS = new Set(["status", "state", "invoice_status", "payment_status"]);
const REFUND_STATE_KEYS = new Set(["refund_status", "refund_state"]);
const BOOL_KEYS = new Set(["refunded", "is_refunded"]);
const AMOUNT_KEYS = new Set(["amount_refunded", "refunded_amount", "refunded_total", "total_refunded"]);

const REFUNDED_STATES = new Set(["refunded", "fully_refunded", "refund_completed"]);
const REFUND_DONE = new Set(["refunded", "succeeded", "completed", "processed", "fully_refunded"]);

export type RefundReading = { refunded: true; why: null } | { refunded: false; why: string };

const no = (why: string): RefundReading => ({ refunded: false, why });

/** The record's own fields: the top level, then up to two single-object wrappers below it. */
function recordLevels(root: Record<string, unknown>): Array<Record<string, unknown>> {
  const levels = [root];
  let current = root;
  for (let depth = 0; depth < 2; depth++) {
    const wrapper = Object.entries(current).find(([k, v]) => WRAPPERS.has(k.toLowerCase()) && v && typeof v === "object" && !Array.isArray(v));
    if (!wrapper) break;
    current = wrapper[1] as Record<string, unknown>;
    levels.push(current);
  }
  return levels;
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*-?\d+(?:\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};

const ID_KEYS = new Set(["id", "invoice", "invoice_id", "invoice_number", "invoice_no", "number", "order_id", "reference", "ref"]);

/** The identifier a read-back path asks for: its last segment, or a query value ("invoices/NW-4417"). */
export function requestedIds(path: string | undefined): string[] {
  if (!path) return [];
  const [p, q] = path.split("?", 2);
  const ids = [p.split("/").filter(Boolean).pop() ?? ""];
  for (const pair of (q ?? "").split("&")) ids.push(pair.split("=", 2)[1] ?? "");
  return ids.map((s) => { try { return decodeURIComponent(s).trim(); } catch { return s.trim(); } }).filter((s) => /\d/.test(s));
}

/** "NW-4417" → "aa-9999": two identifiers of one kind share a shape, an internal id ("in_1Nx…") does not. */
const shapeOf = (id: string) => id.toLowerCase().replace(/\d/g, "9").replace(/[a-z]/g, "a");

export function readRefund(body: string, path?: string): RefundReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined && (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))) {
    // JSON, but not one record: a list or a bare value says nothing about this invoice.
    return no("The response is not a single record, so it does not show this refund.");
  }
  if (parsed === undefined) {
    if (/\bnot\s+(?:yet\s+)?(?:been\s+)?refunded\b|\bunrefunded/i.test(body)) return no("The response says the refund was not made.");
    if (/\bis\s+(?:still\s+|currently\s+)?open\b/i.test(body)) return no("The response shows the state “open”.");
    return /\brefunded\b/i.test(body) ? { refunded: true, why: null } : no("The response does not show a refund.");
  }

  // The record must be the one asked for. Only an identifier of the same shape as the requested
  // one can disagree with it: a record keyed by an internal id is never contradicted for that.
  const wanted = requestedIds(path);
  if (wanted.length) {
    const ids = recordLevels(parsed as Record<string, unknown>).flatMap((level) =>
      Object.entries(level).filter(([k, v]) => ID_KEYS.has(k.toLowerCase()) && (typeof v === "string" || typeof v === "number")).map(([, v]) => String(v).trim()));
    const sameKind = ids.filter((id) => wanted.some((w) => shapeOf(w) === shapeOf(id)));
    if (sameKind.length && !sameKind.some((id) => wanted.some((w) => w.toLowerCase() === id.toLowerCase()))) {
      return no(`The response is the record of ${sameKind[0]}, not of ${wanted[0]}.`);
    }
  }

  let positive = false;
  for (const level of recordLevels(parsed as Record<string, unknown>)) {
    for (const [rawKey, value] of Object.entries(level)) {
      const key = rawKey.toLowerCase();
      const text = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : null;
      if (STATE_KEYS.has(key) && text !== null) {
        if (REFUNDED_STATES.has(text)) positive = true;
        else return no(`The response shows the state “${text === "open" ? "open" : text.replace(/_/g, " ")}”, not refunded.`);
      } else if (REFUND_STATE_KEYS.has(key) && text !== null) {
        if (REFUND_DONE.has(text)) positive = true;
        else return no(`The response shows the refund as “${text.replace(/_/g, " ")}”.`);
      } else if (BOOL_KEYS.has(key) && typeof value === "boolean") {
        if (value) positive = true;
        else return no("The response says the refund was not made.");
      } else if ((key === "open" || key === "is_open") && value === true) {
        return no("The response shows the record as open.");
      } else if (AMOUNT_KEYS.has(key)) {
        const n = asNumber(value);
        if (n !== null && n > 0) positive = true;
        else if (n === 0) return no("The response shows a refunded amount of 0.");
      }
    }
  }
  return positive ? { refunded: true, why: null } : no("The response has no field that shows a completed refund.");
}
