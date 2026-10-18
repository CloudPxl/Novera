import { createHmac, randomInt } from "node:crypto";
import { sharedAcross } from "./entitlement.ts";

/**
 * Pilot codes (0075): what a code may look like, how it is hashed, how one is generated, and
 * what a person is told about an attempt. Shared by the redeem action on Settings → Billing and
 * by the operator's CLI (scripts/pilot-code.mts), so the code the founder creates and the code
 * an agency types hash to the same value.
 *
 * A code is never stored. The database keeps an HMAC-SHA256 of its normalised form under the
 * server secret, labelled apart from every other use of that secret, and a hint too short to
 * rebuild it from.
 *
 * Pure apart from reading NOVERA_ENCRYPTION_KEY. Never imported by a client component: the
 * form receives its limits from the server page.
 */

export const PILOT_CODE_MIN_LENGTH = 8;
export const PILOT_CODE_MAX_LENGTH = 64;
/** What the input field accepts before the server normalises it: room for pasted spaces. */
export const PILOT_CODE_INPUT_MAX = 100;

/**
 * Attempts, counted in Postgres (0024's throttle) before a code is hashed or looked up: five in
 * fifteen minutes per person, per workspace, and per (salted, hashed) network address — each
 * counted separately, and any one of them refuses. A redemption is something one types once.
 */
export const PILOT_ATTEMPT_LIMIT = { max: 5, windowSeconds: 15 * 60 } as const;

export const PILOT_DEFAULTS = { runs: 50, days: 30, maxRedemptions: 1 } as const;
export const PILOT_LIMITS = { runs: { min: 1, max: 500 }, days: { min: 1, max: 365 } } as const;

/** Typographic dashes a mail client or a PDF may put where the founder typed "-". */
const DASHES = /[‐-―−﹘﹣－]/g;

/**
 * The code as it is hashed: trimmed, every space removed, typographic dashes read as "-", in
 * capitals. Anything other than letters, digits and dashes, or a length outside 8–64, is refused
 * here, before any hashing or database call. Letters are checked as ASCII before they are put in
 * capitals, so no locale's casing rule can turn a foreign letter into an accepted one.
 */
export function normalisePilotCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input.replace(/\s+/g, "").replace(DASHES, "-");
  if (!/^[A-Za-z0-9-]+$/.test(compact)) return null;
  const code = compact.toUpperCase();
  if (code.length < PILOT_CODE_MIN_LENGTH || code.length > PILOT_CODE_MAX_LENGTH) return null;
  return code;
}

function secret(raw = process.env.NOVERA_ENCRYPTION_KEY): string {
  // No fallback, as for API keys: a code hashed under a default secret is a code anyone with
  // the source can test guesses against offline.
  if (!raw) throw new Error("NOVERA_ENCRYPTION_KEY is not set, so pilot codes cannot be created or checked.");
  return raw;
}

/** HMAC-SHA256 (hex) of a normalised code, under the server secret labelled "pilot-codes:v1". */
export function hashPilotCode(normalised: string, raw?: string): string {
  if (normalisePilotCode(normalised) !== normalised) throw new Error("hashPilotCode takes a normalised code.");
  return createHmac("sha256", `${secret(raw)}:pilot-codes:v1`).update(normalised, "utf8").digest("hex");
}

/**
 * What the founder's listing and the grant's reason show: at most a third of the code's start
 * and a sixth of its end ("PILOT-EXAMPLE-30" → "PILOT…30"), so at most half of it, and for the
 * documented formats only the prefix and the days.
 */
export function pilotCodeHint(normalised: string): string {
  const n = normalised.length;
  const head = normalised.slice(0, Math.min(6, Math.floor(n / 3)));
  const tail = normalised.slice(n - Math.min(2, Math.floor(n / 6)));
  return `${head}…${tail}`;
}

/** Crockford's base32: no I, L, O or U, so a code read aloud or retyped survives. */
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The name part of a generated code: capitals and digits only. */
export function sanitiseCodeName(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A new code, `PILOT-<NAME>-<4 random base32 characters>-<days>`. The four characters (20 bits,
 * from the operating system's randomness) are what a guess cannot know, so a generated code is
 * not guessable from the name and the days alone, as a hand-written PILOT-<NAME>-30 is.
 */
export function generatePilotCode(name: string, days: number = PILOT_DEFAULTS.days): string {
  const safe = sanitiseCodeName(name);
  if (!safe) throw new Error("The name must contain at least one letter or digit.");
  if (!Number.isInteger(days) || days < PILOT_LIMITS.days.min || days > PILOT_LIMITS.days.max) {
    throw new Error(`Days must be a whole number from ${PILOT_LIMITS.days.min} to ${PILOT_LIMITS.days.max}.`);
  }
  const random = Array.from({ length: 4 }, () => BASE32[randomInt(BASE32.length)]).join("");
  const fixed = `PILOT--${random}-${days}`.length;
  const code = `PILOT-${safe.slice(0, PILOT_CODE_MAX_LENGTH - fixed)}-${random}-${days}`;
  const normalised = normalisePilotCode(code);
  if (!normalised) throw new Error("Could not generate a valid code from that name.");
  return normalised;
}

// ------------------------------------------------------------------ outcomes

/**
 * What `redeem_pilot_code` answers (0076). `owner_has_pilot`: the workspace's owner already
 * redeemed a code, in this workspace or another they own — one pilot per owner, covering every
 * workspace they own. It replaced 0075's `workspace_has_pilot`, which is no longer answered.
 */
export type PilotOutcome =
  | { outcome: "redeemed"; grant_id: string; runs_allowed: number; ends_at: string }
  | { outcome: "owner_has_pilot" }
  | { outcome: "invalid" }
  | { outcome: "used_up" };

/** The RPC's answer, read defensively: anything unexpected is not a redemption. */
export function readPilotOutcome(data: unknown): PilotOutcome | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  switch (d.outcome) {
    case "redeemed":
      return typeof d.grant_id === "string" && typeof d.runs_allowed === "number" && typeof d.ends_at === "string"
        ? { outcome: "redeemed", grant_id: d.grant_id, runs_allowed: d.runs_allowed, ends_at: d.ends_at }
        : null;
    case "owner_has_pilot":
    case "invalid":
    case "used_up":
      return { outcome: d.outcome };
    default:
      return null;
  }
}

/** A date as "16 November 2026", in the person's timezone. */
export function longDate(iso: string, timezone = "UTC"): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
  }
}

export interface PilotMessage {
  /** "notice" for a redemption, "error" for everything else. */
  tone: "notice" | "error";
  text: string;
  /** A phrase inside `text` that links somewhere, if the sentence offers a next step. */
  link?: { href: string; phrase: string };
}

export const PILOT_MESSAGES = {
  used_up: "This code has already been used.",
  owner_has_pilot: "You already have a pilot; it covers every workspace you own. Ask us through Support if you need more runs.",
  owner_has_pilot_other: "This workspace's owner already has a pilot; it covers every workspace they own. Ask us through Support if you need more runs.",
  invalid: "That code is not valid. Check it, or request a pilot.",
  empty: "Enter the pilot code you were given.",
  uncounted: "Novera could not check this attempt against its limits just now, so the code was not tried. Try again in a minute.",
  failed: "The code could not be checked just now. Nothing changed; try again in a minute.",
} as const;

/**
 * Where a redeemed pilot's runs go (0076): every workspace the owner owns, said to the person who
 * typed the code — the owner ("you own"), or an admin ("the owner's").
 */
export function pilotScope(ownerViewing: boolean): string {
  return ownerViewing ? "shared across every workspace you own" : "shared across all of the owner's workspaces";
}

/**
 * What a person is told about a redemption attempt. `ownerViewing`: the person owns the workspace;
 * an admin who typed the code is told whose workspaces the pilot covers.
 */
export function pilotOutcomeMessage(outcome: PilotOutcome, timezone = "UTC", ownerViewing = true): PilotMessage {
  switch (outcome.outcome) {
    case "redeemed":
      return { tone: "notice", text: `Pilot unlocked: ${outcome.runs_allowed} runs until ${longDate(outcome.ends_at, timezone)}, ${pilotScope(ownerViewing)}.` };
    case "used_up":
      return { tone: "error", text: PILOT_MESSAGES.used_up };
    case "owner_has_pilot":
      return { tone: "error", text: ownerViewing ? PILOT_MESSAGES.owner_has_pilot : PILOT_MESSAGES.owner_has_pilot_other, link: { href: "/support", phrase: "Support" } };
    case "invalid":
      return { tone: "error", text: PILOT_MESSAGES.invalid, link: { href: "/apply", phrase: "request a pilot" } };
  }
}

/** Too many attempts: when to try again, never "rate limited". */
export function pilotAttemptsRefusal(retryAfterMinutes: number): string {
  const when = retryAfterMinutes <= 1 ? "in a minute" : `in about ${retryAfterMinutes} minutes`;
  return `That is more pilot code attempts than Novera accepts at once. Try again ${when}.`;
}

/**
 * The active pilot grant as one line: "Pilot · 47 of 50 runs left · ends 16 November 2026", and
 * for an owner-wide pilot (0076) "Pilot · 47 of 50 runs left (shared across your workspaces) ·
 * ends 16 November 2026" — the same words the top bar's funding line uses.
 */
export function pilotGrantLine(g: { runsAllowed: number; runsUsed: number; endsAt: string | null; shared?: boolean }, timezone = "UTC", ownerViewing = false): string {
  const left = Math.max(0, g.runsAllowed - g.runsUsed);
  const shared = g.shared ? ` (${sharedAcross(ownerViewing)})` : "";
  return `Pilot · ${left} of ${g.runsAllowed} runs left${shared}${g.endsAt ? ` · ends ${longDate(g.endsAt, timezone)}` : ""}`;
}
