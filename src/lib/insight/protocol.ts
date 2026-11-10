import { SCAN_ERROR_KINDS, WORKER_ERROR_KINDS, type ObservationCapture, type ScanErrorKind } from "./types.ts";

/**
 * The contract between the browser worker and the server. Shared by both sides, so one change
 * is one change. Hand-written validators: the worker is a trusted process holding one secret,
 * but its input still reaches the database and a model, so every field is bounded here.
 */

/** At least this long between two prompts to the same widget. The server refuses an earlier turn. */
export const PACING_MS = 12_000;
/** How long the worker waits for a reply to stop changing before it gives up on it. */
export const REPLY_TIMEOUT_MS = 45_000;
/** How long the page gets to load. */
export const NAV_TIMEOUT_MS = 30_000;
/** How long a claim is held without a heartbeat before another claim may end it. */
export const LEASE_MS = 120_000;
export const HEARTBEAT_MS = 20_000;
export const REPLY_LIMIT_BYTES = 64 * 1024;
export const CAPTURE_LIMIT_BYTES = 4_000;
export const PROMPT_LIMIT_CHARS = 4_000;

/** How the worker introduces itself. `/bot` says what it does and how to opt out. */
export const BOT_TOKEN = "NoveraInsightBot";
export const USER_AGENT = `${BOT_TOKEN}/1.0 (+https://www.nover.space/bot)`;

export interface ClaimRequest {
  worker_id: string;
  host_label?: string;
  version?: string;
}

export interface ClaimedScan {
  id: string;
  lease_token: string;
  lease_ms: number;
  heartbeat_ms: number;
  pacing_ms: number;
  reply_timeout_ms: number;
  nav_timeout_ms: number;
  user_agent: string;
  target: { url: string; name: string };
  scenarios: Array<{ id: string; input: string }>;
  robots: { allowed: true; crawl_delay_ms: number | null };
}

export type ClaimAnswer =
  | { scan: ClaimedScan }
  /** Nothing queued, or the claimed scan was refused on the server; `retry` says to ask again at once. */
  | { scan: null; retry?: boolean };

export type WorkerEvent =
  | { kind: "heartbeat" }
  | {
      kind: "page";
      final_url: string;
      title: string | null;
      widget: { vendor: string | null; selector_path: string; frame_origin: string | null } | null;
      consent_clicked: boolean;
    }
  | { kind: "robots"; allowed: boolean; crawl_delay_ms: number | null; status: number | null }
  | { kind: "turn"; scenario_id: string; prompt_text: string; response_text: string | null; capture: ObservationCapture }
  | { kind: "error"; error_kind: ScanErrorKind; detail: string };

export interface EventRequest {
  worker_id: string;
  lease_token: string;
  event: WorkerEvent;
}

export type EventAnswer =
  | { ok: true; next: string | null; wait_ms: number }
  | { ok: false; status: number; error: string; retry_after_ms?: number; stop: boolean };

const WORKER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

export function parseClaimRequest(raw: unknown): ClaimRequest | { error: string } {
  if (!isObject(raw)) return { error: "Send a JSON object: { \"worker_id\": \"…\" }." };
  const worker_id = str(raw.worker_id, 64);
  if (!worker_id || !WORKER_ID.test(worker_id)) return { error: "worker_id: lowercase letters, digits, dots, dashes; 1 to 64 characters." };
  const out: ClaimRequest = { worker_id };
  if (raw.host_label !== undefined && raw.host_label !== null) {
    const host_label = str(raw.host_label, 100);
    if (host_label === null) return { error: "host_label: at most 100 characters." };
    out.host_label = host_label;
  }
  if (raw.version !== undefined && raw.version !== null) {
    const version = str(raw.version, 40);
    if (version === null) return { error: "version: at most 40 characters." };
    out.version = version;
  }
  return out;
}

function parseCapture(raw: unknown): ObservationCapture | { error: string } {
  if (!isObject(raw)) return { error: "capture must be an object." };
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > CAPTURE_LIMIT_BYTES) return { error: `capture is larger than ${CAPTURE_LIMIT_BYTES} bytes.` };
  if (raw.method !== "dom_delta") return { error: "capture.method must be \"dom_delta\"." };
  const num = (v: unknown) => (v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
  const stabilised_ms = num(raw.stabilised_ms);
  const nav_ms = num(raw.nav_ms);
  if (stabilised_ms === undefined || nav_ms === undefined) return { error: "capture timings must be non-negative numbers." };
  const selector_path = raw.selector_path === null || raw.selector_path === undefined ? null : str(raw.selector_path, 500);
  const frame_origin = raw.frame_origin === null || raw.frame_origin === undefined ? null : str(raw.frame_origin, 200);
  if (selector_path === undefined || frame_origin === undefined) return { error: "capture selector_path and frame_origin must be short strings." };
  const typed_at = raw.typed_at === null || raw.typed_at === undefined ? null : str(raw.typed_at, 40);
  const captured_at = raw.captured_at === null || raw.captured_at === undefined ? null : str(raw.captured_at, 40);
  if (typed_at === undefined || captured_at === undefined) return { error: "capture timestamps must be strings." };
  if (typeof raw.partial !== "boolean") return { error: "capture.partial must be true or false." };
  return { method: "dom_delta", selector_path, frame_origin, typed_at, captured_at, stabilised_ms, nav_ms, partial: raw.partial };
}

export function parseWorkerEvent(raw: unknown): WorkerEvent | { error: string } {
  if (!isObject(raw)) return { error: "event must be an object." };
  switch (raw.kind) {
    case "heartbeat":
      return { kind: "heartbeat" };
    case "page": {
      const final_url = str(raw.final_url, 2048);
      if (!final_url) return { error: "page.final_url is required." };
      const title = raw.title === null || raw.title === undefined ? null : str(raw.title, 300);
      if (title === undefined) return { error: "page.title: at most 300 characters." };
      let widget: Extract<WorkerEvent, { kind: "page" }>["widget"] = null;
      if (raw.widget !== null && raw.widget !== undefined) {
        if (!isObject(raw.widget)) return { error: "page.widget must be an object or null." };
        const selector_path = str(raw.widget.selector_path, 500);
        if (!selector_path) return { error: "page.widget.selector_path is required." };
        const vendor = raw.widget.vendor === null || raw.widget.vendor === undefined ? null : str(raw.widget.vendor, 60);
        const frame_origin = raw.widget.frame_origin === null || raw.widget.frame_origin === undefined ? null : str(raw.widget.frame_origin, 200);
        if (vendor === undefined || frame_origin === undefined) return { error: "page.widget fields must be short strings." };
        widget = { vendor, selector_path, frame_origin };
      }
      return { kind: "page", final_url, title, widget, consent_clicked: raw.consent_clicked === true };
    }
    case "robots": {
      if (typeof raw.allowed !== "boolean") return { error: "robots.allowed must be true or false." };
      const crawl = raw.crawl_delay_ms === null || raw.crawl_delay_ms === undefined ? null : typeof raw.crawl_delay_ms === "number" && raw.crawl_delay_ms >= 0 ? Math.round(raw.crawl_delay_ms) : undefined;
      const status = raw.status === null || raw.status === undefined ? null : typeof raw.status === "number" && raw.status >= 100 && raw.status < 600 ? Math.round(raw.status) : undefined;
      if (crawl === undefined || status === undefined) return { error: "robots.crawl_delay_ms and robots.status must be numbers or null." };
      return { kind: "robots", allowed: raw.allowed, crawl_delay_ms: crawl, status };
    }
    case "turn": {
      const scenario_id = str(raw.scenario_id, 32);
      if (!scenario_id || !/^[A-Za-z0-9_-]+$/.test(scenario_id)) return { error: "turn.scenario_id is required." };
      const prompt_text = str(raw.prompt_text, PROMPT_LIMIT_CHARS);
      if (!prompt_text) return { error: "turn.prompt_text is required." };
      let response_text: string | null;
      if (raw.response_text === null || raw.response_text === undefined) response_text = null;
      else if (typeof raw.response_text === "string") {
        if (Buffer.byteLength(raw.response_text, "utf8") > REPLY_LIMIT_BYTES) return { error: `turn.response_text is larger than ${REPLY_LIMIT_BYTES} bytes.` };
        response_text = raw.response_text;
      } else return { error: "turn.response_text must be a string or null." };
      const capture = parseCapture(raw.capture);
      if ("error" in capture) return capture;
      if (response_text === null && !capture.partial && capture.captured_at !== null) {
        // Nothing arrived: the capture says so by having no captured_at.
        return { error: "turn with no response_text must not carry captured_at." };
      }
      return { kind: "turn", scenario_id, prompt_text, response_text, capture };
    }
    case "error": {
      const kind = str(raw.error_kind, 40);
      if (!kind || !WORKER_ERROR_KINDS.includes(kind as ScanErrorKind)) {
        return { error: `error.error_kind must be one of ${WORKER_ERROR_KINDS.join(", ")}.` };
      }
      const detail = str(raw.detail, 500);
      if (detail === null) return { error: "error.detail: a string of at most 500 characters." };
      return { kind: "error", error_kind: kind as ScanErrorKind, detail };
    }
    default:
      return { error: "event.kind must be heartbeat, page, robots, turn or error." };
  }
}

export function parseEventRequest(raw: unknown): EventRequest | { error: string } {
  if (!isObject(raw)) return { error: "Send a JSON object: { \"worker_id\", \"lease_token\", \"event\" }." };
  const worker_id = str(raw.worker_id, 64);
  if (!worker_id || !WORKER_ID.test(worker_id)) return { error: "worker_id: lowercase letters, digits, dots, dashes; 1 to 64 characters." };
  const lease_token = str(raw.lease_token, 36);
  if (!lease_token || !UUID.test(lease_token)) return { error: "lease_token must be the uuid the claim returned." };
  const event = parseWorkerEvent(raw.event);
  if ("error" in event) return event;
  return { worker_id, lease_token, event };
}

export function isScanErrorKind(value: unknown): value is ScanErrorKind {
  return typeof value === "string" && SCAN_ERROR_KINDS.includes(value as ScanErrorKind);
}

/** How long the worker must wait before its next turn, given when the last one was recorded. */
export function waitBeforeNextTurn(lastTurnAt: string | null, now: Date, pacingMs = PACING_MS): number {
  if (!lastTurnAt) return 0;
  const elapsed = now.getTime() - Date.parse(lastTurnAt);
  return Math.max(0, pacingMs - elapsed);
}
