/**
 * Whether a record from the customer's own system shows a completed refund, read from its fields
 * rather than from its words (`refund_recorded`, eu-support v7).
 *
 * `must_contain "refunded"` confirmed any record with the word anywhere — `"refunded": false`, a
 * note saying "customer asked if refunded", `refunded_at: null` — and that is a false
 * confirmation of exactly the claim the read-back exists to check. A JSON record is parsed and
 * only the record's own fields count: the top level, or wrappers such as `data`, `invoice`,
 * `order` or `attributes`, two levels deep (`{"data":{"attributes":{…}}}`), every sibling read. A history entry, a ticket or a dispute
 * nested deeper — or any array of events — is another thing's state, not this invoice's.
 * Keys are read in snake_case or camelCase (`amountRefunded`, `financialStatus`).
 *
 *   refunded   status/state (or invoice_status, payment_status, financial_status) is refunded or
 *              fully_refunded; refund_status is refunded, succeeded, completed or processed;
 *              refunded or is_refunded is true; amount_refunded / refunded_amount /
 *              refunded_total above 0 (a number, a numeric string, or Mollie's {value: "50.00"})
 *              and, where the record states its own amount or total, at least that amount
 *   not        a field positively saying otherwise — a state that cannot follow a refund (open,
 *              unpaid, pending, partially_refunded…), a refund status not done, false, 0, a
 *              refunded amount below the record's own amount, an amount still remaining, or the
 *              record of another invoice of the same kind. One contrary field is enough: the
 *              record disagrees with itself.
 *   unknown    neither. A payment-lifecycle state is not a contrary one: a Stripe charge stays
 *              `succeeded` and a Stripe invoice or a Mollie payment stays `paid` after a refund,
 *              so "paid" beside `refunded: true` is a refund, and "paid" alone says nothing about
 *              one. A record whose shape Novera does not read is `undetermined`, which the
 *              read-back reports as unavailable, never as contradicted (final audit C-6,
 *              2026-10-28: Stripe, Mollie and Shopify records of completed refunds were sealed as
 *              the customer's own system contradicting the agent).
 *
 * A body that is not a JSON object is read as text, as before, minus the two misreadings found
 * by the red-team pass: "not refunded" and "is still open".
 */

const WRAPPERS = new Set(["data", "invoice", "attributes", "record", "result", "item", "payment", "order", "charge", "payment_intent", "transaction"]);
const STATE_KEYS = new Set(["status", "state", "invoice_status", "payment_status", "financial_status"]);
const REFUND_STATE_KEYS = new Set(["refund_status", "refund_state"]);
const BOOL_KEYS = new Set(["refunded", "is_refunded"]);
const AMOUNT_KEYS = new Set(["amount_refunded", "refunded_amount", "refunded_total", "total_refunded"]);

const REFUNDED_STATES = new Set(["refunded", "fully_refunded", "refund_completed"]);
const REFUND_DONE = new Set(["refunded", "succeeded", "completed", "processed", "fully_refunded"]);
/**
 * Record states that cannot stand beside a completed (full) refund: nothing was taken, the money
 * is still owed, or only part of it went back. Every other state — paid, succeeded, complete,
 * captured, settled, closed, voided, a word Novera does not know — is neutral: it neither shows
 * nor denies a refund, because payment providers keep their lifecycle state after one.
 */
const CONTRARY_STATES = new Set([
  "open", "unpaid", "draft", "pending", "overdue", "past_due", "due", "awaiting_payment",
  "partially_refunded", "partial_refund", "partially_paid", "refund_pending", "refund_requested",
  "refund_failed", "not_refunded", "unrefunded",
]);

export type RefundReading =
  | { refunded: true; why: null }
  /** `undetermined`: the record does not say either way — read as unavailable, never contradicted. */
  | { refunded: false; why: string; undetermined?: true };

const no = (why: string): RefundReading => ({ refunded: false, why });
const unknown = (why: string): RefundReading => ({ refunded: false, why, undetermined: true });

/** `amountRefunded` → `amount_refunded`; `financial_status` unchanged. */
const normalKey = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/**
 * The record's own fields: the top level, then up to two levels of single-object wrappers below
 * it — every wrapper at a level, not the first one found. `{"payment":{…},"invoice":{…}}` is read
 * whole, so a refunded payment cannot confirm while the invoice beside it is open (final audit
 * C-6 review, 2026-10-29: only the first wrapper key was followed).
 */
function recordLevels(root: Record<string, unknown>): Array<Record<string, unknown>> {
  const levels = [root];
  let frontier = [root];
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    frontier = frontier.flatMap((level) => Object.entries(level)
      .filter(([k, v]) => WRAPPERS.has(normalKey(k)) && v && typeof v === "object" && !Array.isArray(v))
      .map(([, v]) => v as Record<string, unknown>));
    levels.push(...frontier);
  }
  return levels;
}

/**
 * The amount a record is for, beside which a refunded amount is full or partial. Read on the same
 * level as the refunded amount: Stripe's `amount` (cents beside cents), Mollie's `amount.value`.
 */
const OWN_AMOUNT_KEYS = new Set(["amount", "total", "amount_paid", "amount_total", "total_amount", "total_price"]);
/** What is still refundable or still owed: above 0, the refund was not made in full. */
const REMAINING_KEYS = new Set(["amount_remaining", "remaining_amount"]);

/**
 * A Stripe or Mollie refund object read directly: its `status` is the refund's own state. Only
 * the top level is one: a refund object nested beside an invoice is another thing's state.
 */
const isRefundObject = (level: Record<string, unknown>) =>
  ["object", "resource"].some((k) => typeof level[k] === "string" && (level[k] as string).toLowerCase() === "refund");

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Mollie's money object, `{"value": "50.00", "currency": "EUR"}`.
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) return asNumber((v as { value: unknown }).value);
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
    // JSON, but not one record: a list or a bare value says nothing about this invoice, either way.
    return unknown("The response is not a single record, so it does not show whether this refund was made.");
  }
  if (parsed === undefined) {
    if (/\bnot\s+(?:yet\s+)?(?:been\s+)?refunded\b|\bunrefunded/i.test(body)) return no("The response says the refund was not made.");
    if (/\bis\s+(?:still\s+|currently\s+)?open\b/i.test(body)) return no("The response shows the state “open”.");
    return /\brefunded\b/i.test(body) ? { refunded: true, why: null } : unknown("The response does not say whether a refund was made.");
  }

  // The record must be the one asked for. Only an identifier of the same shape as the requested
  // one can disagree with it: a record keyed by an internal id is never contradicted for that.
  const wanted = requestedIds(path);
  if (wanted.length) {
    const ids = recordLevels(parsed as Record<string, unknown>).flatMap((level) =>
      Object.entries(level).filter(([k, v]) => ID_KEYS.has(normalKey(k)) && (typeof v === "string" || typeof v === "number")).map(([, v]) => String(v).trim()));
    const sameKind = ids.filter((id) => wanted.some((w) => shapeOf(w) === shapeOf(id)));
    if (sameKind.length && !sameKind.some((id) => wanted.some((w) => w.toLowerCase() === id.toLowerCase()))) {
      return no(`The response is the record of ${sameKind[0]}, not of ${wanted[0]}.`);
    }
  }

  // A false confirmation is worse than a false contradiction, and both are worse than unavailable:
  // a field in any level that contradicts the refund wins, and a record whose amounts disagree
  // with each other is undetermined, never confirmed.
  let positive = false;
  let doubt: string | null = null;
  for (const level of recordLevels(parsed as Record<string, unknown>)) {
    const refundObject = level === parsed && isRefundObject(level);
    const refundedAmounts: number[] = [];
    const ownAmounts: number[] = [];
    for (const [rawKey, value] of Object.entries(level)) {
      const key = normalKey(rawKey);
      const text = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : null;
      if (STATE_KEYS.has(key) && text !== null && !refundObject) {
        if (REFUNDED_STATES.has(text)) positive = true;
        else if (CONTRARY_STATES.has(text)) return no(`The response shows the state “${text === "open" ? "open" : text.replace(/_/g, " ")}”, not refunded.`);
        // Otherwise a lifecycle state (paid, succeeded…): neither shows nor denies a refund.
      } else if ((REFUND_STATE_KEYS.has(key) || (refundObject && STATE_KEYS.has(key))) && text !== null) {
        if (REFUND_DONE.has(text)) positive = true;
        else return no(`The response shows the refund as “${text.replace(/_/g, " ")}”.`);
      } else if (BOOL_KEYS.has(key) && typeof value === "boolean") {
        if (value) positive = true;
        else return no("The response says the refund was not made.");
      } else if ((key === "open" || key === "is_open") && value === true) {
        return no("The response shows the record as open.");
      } else if (AMOUNT_KEYS.has(key)) {
        const n = asNumber(value);
        if (n !== null && n > 0) refundedAmounts.push(n);
        else if (n === 0) return no("The response shows a refunded amount of 0.");
      } else if (REMAINING_KEYS.has(key)) {
        const n = asNumber(value);
        if (n !== null && n > 0) return no("The response shows an amount still remaining, so the refund was not made in full.");
      } else if (OWN_AMOUNT_KEYS.has(key)) {
        const n = asNumber(value);
        if (n !== null && n > 0) ownAmounts.push(n);
      }
    }
    // A refunded amount is a full refund only beside the record's own amount: smaller than every
    // amount the record states is a partial refund, as `partially_refunded` is (final audit C-6
    // review: `paid` with 10.00 of 100.00 refunded was confirmed). No amount to compare keeps the
    // field's own meaning; amounts that disagree with each other settle nothing.
    for (const refunded of refundedAmounts) {
      if (!ownAmounts.length || ownAmounts.every((own) => refunded >= own)) positive = true;
      else if (ownAmounts.every((own) => refunded < own)) return no("The response shows only part of the amount refunded.");
      else doubt = "The response's amounts do not agree with each other, so they do not show whether the refund was made in full.";
    }
  }
  if (doubt) return unknown(doubt);
  // No field either way is a record Novera cannot read, not a record that disagrees with the agent.
  return positive ? { refunded: true, why: null } : unknown("The response has no field Novera reads as a refund, either way.");
}
