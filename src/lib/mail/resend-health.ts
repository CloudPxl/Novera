import { EXPECTED_FROM_DOMAIN } from "./diagnostics.ts";

/**
 * Whether the Resend key this server holds still works, and whether Resend has verified the
 * sending domain — read live from `GET https://api.resend.com/domains`, which sends nothing and
 * costs no email quota. Cached for five minutes per process so /readiness and verify:launch can
 * ask freely.
 *
 * A revoked or mistyped key used to fail silently until someone noticed a missing confirmation
 * email. Resend answers a *sending-only* key with 401 `restricted_api_key` on this endpoint: that
 * key works for mail and simply cannot list domains, so it is reported as such, never as invalid.
 * The answer carries no key, no part of one and no response body beyond the domain's status.
 */
export type ResendHealthStatus = "unconfigured" | "verified" | "send_only" | "invalid_key" | "domain_unverified" | "domain_missing" | "unreachable";

export interface ResendHealth {
  status: ResendHealthStatus;
  detail: string;
  checkedAt: number;
}

export const RESEND_HEALTH_TTL_MS = 5 * 60 * 1000;
let cached: { key: string; value: ResendHealth } | null = null;

/** Clears the five-minute cache (tests). */
export function resetResendHealthCache(): void {
  cached = null;
}

export function classifyResendDomains(status: number, body: unknown, domain = EXPECTED_FROM_DOMAIN): Omit<ResendHealth, "checkedAt"> {
  const b = (body ?? {}) as { name?: unknown; data?: unknown };
  if (status === 401 || status === 403) {
    if (b.name === "restricted_api_key") {
      return { status: "send_only", detail: "The key is accepted and restricted to sending, so it cannot list domains; delivery is shown by a message arriving." };
    }
    return { status: "invalid_key", detail: `Resend refused the key (${status}). Email sign-up, reset and invitation messages will not be sent until RESEND_API_KEY is replaced.` };
  }
  if (status === 400 && b.name === "validation_error") {
    return { status: "invalid_key", detail: "Resend says the key is not valid. Replace RESEND_API_KEY." };
  }
  if (status < 200 || status >= 300) return { status: "unreachable", detail: `Resend answered ${status}.` };
  const list = Array.isArray(b.data) ? (b.data as Array<{ name?: unknown; status?: unknown }>) : [];
  const own = list.find((d) => typeof d.name === "string" && d.name.toLowerCase() === domain);
  if (!own) return { status: "domain_missing", detail: `${domain} is not a domain of this Resend account.` };
  if (own.status !== "verified") return { status: "domain_unverified", detail: `${domain} is ${typeof own.status === "string" ? own.status : "not verified"} at Resend.` };
  return { status: "verified", detail: `The key works and ${domain} is verified at Resend.` };
}

export async function resendHealth(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<ResendHealth> {
  const key = (env.RESEND_API_KEY ?? "").trim();
  if (!key) return { status: "unconfigured", detail: "No RESEND_API_KEY on this server.", checkedAt: now() };
  // Cached per key without holding it: only whether the same key is still in place.
  const marker = `${key.length}:${key.slice(-4)}`;
  if (cached && cached.key === marker && now() - cached.value.checkedAt < RESEND_HEALTH_TTL_MS) return cached.value;
  let value: ResendHealth;
  try {
    const response = await fetchImpl("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json().catch(() => null);
    value = { ...classifyResendDomains(response.status, body), checkedAt: now() };
  } catch {
    value = { status: "unreachable", detail: "Resend did not answer within 5 s.", checkedAt: now() };
  }
  cached = { key: marker, value };
  return value;
}
