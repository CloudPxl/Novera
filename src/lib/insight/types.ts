/**
 * Row shapes for the public-demo insight scan (0082). Read-only views of what the database
 * holds; nothing here is computed. The card (`card.ts`) is computed from these.
 */

export type Category = "A" | "B" | "C" | "D";

export type ScanStatus = "queued" | "running" | "graded" | "aborted" | "error";

/** Why a scan ended without being graded. One meaning each; the worker may report the second group. */
export type ScanErrorKind =
  | "robots_disallowed"
  | "address_refused"
  | "target_refused"
  | "lease_expired"
  | "page_load_failed"
  | "redirected_offsite"
  | "blocked_challenge"
  | "widget_not_found"
  | "blocked_login"
  | "blocked_payment"
  | "worker_error";

export const SCAN_ERROR_KINDS: readonly ScanErrorKind[] = [
  "robots_disallowed", "address_refused", "target_refused", "lease_expired", "page_load_failed", "redirected_offsite",
  "blocked_challenge", "widget_not_found", "blocked_login", "blocked_payment", "worker_error",
];

/** The kinds a worker may report; the rest are decided by the server or the database. */
export const WORKER_ERROR_KINDS: readonly ScanErrorKind[] = [
  "robots_disallowed", "page_load_failed", "redirected_offsite", "blocked_challenge", "widget_not_found",
  "blocked_login", "blocked_payment", "worker_error",
];

export const SCAN_ERROR_LABEL: Record<ScanErrorKind, string> = {
  robots_disallowed: "The site's robots.txt does not allow Novera's worker on this page.",
  address_refused: "The address resolves to a private or reserved network and is never visited.",
  target_refused: "The target was no longer scannable when the scan was claimed.",
  lease_expired: "The browser worker stopped reporting before the scan finished.",
  page_load_failed: "The page did not load within the time allowed.",
  redirected_offsite: "The page sent the browser to another site, which is never followed.",
  blocked_challenge: "The site showed a bot challenge. Novera stops there; it never attempts to pass one.",
  widget_not_found: "No chat widget was found on the page.",
  blocked_login: "The widget asked for a login, so the scan ended before any prompt was sent.",
  blocked_payment: "The widget showed a payment field, so the scan ended before any prompt was sent.",
  worker_error: "The browser worker failed while running the scan.",
};

export interface InsightTargetRow {
  id: string;
  workspace_id: string;
  name: string;
  demo_url: string;
  sector: string | null;
  facts: Record<string, unknown>;
  category: Category;
  category_reasons: string[];
  authorisation_basis: "published_public_demo";
  authorised_by: string;
  authorised_by_role: string;
  do_not_contact: boolean;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InsightScanRow {
  id: string;
  workspace_id: string;
  target_id: string;
  suite_key: string;
  suite_version: number;
  suite_digest: string;
  scenario_ids: string[];
  status: ScanStatus;
  claimed_by: string | null;
  lease_token: string | null;
  lease_until: string | null;
  last_turn_at: string | null;
  turns_recorded: number;
  robots: Record<string, unknown> | null;
  page: Record<string, unknown> | null;
  error_kind: ScanErrorKind | null;
  error_detail: string | null;
  aborted_reason: string | null;
  started_by: string;
  started_by_role: string;
  created_at: string;
  finished_at: string | null;
}

export interface ObservationCapture {
  method: "dom_delta";
  selector_path: string | null;
  frame_origin: string | null;
  typed_at: string | null;
  captured_at: string | null;
  stabilised_ms: number | null;
  nav_ms: number | null;
  partial: boolean;
}

export interface InsightObservationRow {
  id: string;
  workspace_id: string;
  scan_id: string;
  scenario_id: string;
  prompt_text: string;
  response_text: string | null;
  redaction: Record<string, unknown>;
  capture: Partial<ObservationCapture>;
  status: "pass" | "fail" | "error";
  rationale: string | null;
  failed_assertions: string[];
  judge_model: string | null;
  judge_votes: Array<{ model: string; status: "pass" | "fail" | "error"; rationale: string | null }>;
  judge_agreement: "agreed" | "majority" | "unconfirmed" | "unresolved" | null;
  settled_by: "deterministic" | "models" | null;
  error: string | null;
  judge_funding: "trial_free" | "workspace_key" | "plan_managed" | null;
  worker_id: string;
  created_at: string;
}
