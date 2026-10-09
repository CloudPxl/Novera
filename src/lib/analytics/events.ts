/**
 * The product events Novera counts, and what each may carry. Pure, so the guard is tested
 * without a database; `track.ts` is the server-only half that stores them.
 *
 * The rule is an allow list per event: a property not named here, or a value outside its
 * enum or range, refuses the whole event rather than being stripped — a caller passing
 * something unexpected is a bug to notice, not data to quietly half-keep. The same secret
 * and identifier shapes are refused again by the database (0062), so a mistake here cannot
 * store one.
 */

export const PRODUCT_EVENTS = [
  "landing_cta_click",
  "signup_started",
  "signup_confirmed",
  "agent_probed",
  "policy_saved",
  "run_created",
  "run_completed",
  "report_viewed",
  "report_shared",
  "billing_checkout_started",
  "billing_checkout_completed",
] as const;
export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

type Rule =
  | { type: "enum"; values: readonly string[] }
  | { type: "boolean" }
  | { type: "int"; min: number; max: number }
  | { type: "slug" };

const SIGN_IN_METHOD = { type: "enum", values: ["email", "google", "github"] } as const;
const PLAN = { type: "slug" } as const;

/** What each event may carry. Nothing about the person, the content, or an identifier. */
export const EVENT_PROPERTIES: Record<ProductEvent, Record<string, Rule>> = {
  landing_cta_click: { placement: { type: "slug" } },
  signup_started: { method: SIGN_IN_METHOD },
  signup_confirmed: { method: SIGN_IN_METHOD },
  agent_probed: { ok: { type: "boolean" } },
  policy_saved: { version: { type: "int", min: 1, max: 10_000 } },
  run_created: {
    source: { type: "enum", values: ["button", "rerun", "api", "mcp", "schedule", "builder_scan"] },
    judge_source: { type: "enum", values: ["trial_free", "workspace_key"] },
  },
  // Only a run marked completed; a stopped run is not a completion.
  run_completed: { cases: { type: "int", min: 0, max: 10_000 } },
  report_viewed: {},
  report_shared: { channel: { type: "enum", values: ["link", "json", "junit", "csv", "markdown", "pdf"] } },
  billing_checkout_started: { plan: PLAN },
  billing_checkout_completed: { plan: PLAN },
};

/** Shapes never stored, whatever key they arrive under. Mirrors 0062's CHECK. */
const FORBIDDEN_VALUE = /(sk-[a-z0-9_-]{6,}|sk_(live|test)_|rk_(live|test)_|gsk_|nvk_|whsec_|sb_secret_|bearer\s|eyJ[a-z0-9_-]{8,}|-----BEGIN|[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}|[a-z0-9_-]{32,})/i;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const PROPERTIES_BYTE_LIMIT = 1024;

export type Properties = Record<string, string | number | boolean>;
export type Checked = { ok: true; properties: Properties } | { ok: false; reason: string };

export function isProductEvent(value: unknown): value is ProductEvent {
  return typeof value === "string" && (PRODUCT_EVENTS as readonly string[]).includes(value);
}

/** Pure: the properties as they would be stored, or why the event is refused. */
export function checkProperties(event: string, properties: Record<string, unknown> = {}): Checked {
  if (!isProductEvent(event)) return { ok: false, reason: `unknown event "${String(event).slice(0, 40)}"` };
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return { ok: false, reason: "properties must be an object" };
  const rules = EVENT_PROPERTIES[event];
  const out: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    const rule = rules[key];
    if (!rule) return { ok: false, reason: `property "${key.slice(0, 40)}" is not allowed on ${event}` };
    switch (rule.type) {
      case "enum":
        if (typeof value !== "string" || !rule.values.includes(value)) return { ok: false, reason: `${key} must be one of ${rule.values.join(", ")}` };
        break;
      case "boolean":
        if (typeof value !== "boolean") return { ok: false, reason: `${key} must be a boolean` };
        break;
      case "int":
        if (typeof value !== "number" || !Number.isInteger(value) || value < rule.min || value > rule.max) return { ok: false, reason: `${key} must be an integer from ${rule.min} to ${rule.max}` };
        break;
      case "slug":
        if (typeof value !== "string" || !SLUG.test(value)) return { ok: false, reason: `${key} must be a short lowercase slug` };
        break;
    }
    if (typeof value === "string" && FORBIDDEN_VALUE.test(value)) return { ok: false, reason: `${key} looks like a key, token, email or identifier` };
    out[key] = value as string | number | boolean;
  }
  const serialised = JSON.stringify(out);
  if (Buffer.byteLength(serialised) > PROPERTIES_BYTE_LIMIT) return { ok: false, reason: "properties are too large" };
  if (FORBIDDEN_VALUE.test(serialised)) return { ok: false, reason: "properties look like a key, token, email or identifier" };
  return { ok: true, properties: out };
}
