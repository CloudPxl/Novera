/**
 * Where an authentication flow may send a person afterwards, and which address its links
 * point at. Pure, so the rules are tested rather than trusted.
 *
 * A post-login destination is a fixed list, never "any path that starts with a slash": an
 * OAuth callback or a confirmation link is a URL a stranger can construct, and the place it
 * lands is the first page a freshly signed-in person trusts. `//evil.example`, `/\evil`,
 * an encoded scheme or a workspace id smuggled in a query string all fall back to the
 * dashboard.
 */

const EXACT = new Set(["/dashboard", "/welcome", "/reset-password"]);
const INVITE = /^\/invite\/[A-Za-z0-9_-]{16,128}$/;
// The operator sections and up to two id-shaped segments beneath them (`/runs/<uuid>`,
// `/settings/members`). Five fixed pages were too few: a signed-out person opening a run lost
// where they were going and landed on the dashboard (app-wide audit, 2026-10-08). Still path
// only, from a fixed set of first segments, with nothing but ids after them.
const SECTION = /^\/(?:agents|runs|reports|review|scenarios|regressions|builder|workspaces|settings|inbox)(?:\/[A-Za-z0-9-]{1,64}){0,2}$/;

export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || typeof raw !== "string" || raw.length > 300) return fallback;
  // Reject before parsing: a URL parser normalises `/\host` and `//host` into another origin.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let path: string;
  try {
    const url = new URL(raw, "http://novera.invalid");
    if (url.origin !== "http://novera.invalid") return fallback;
    path = url.pathname;
  } catch {
    return fallback;
  }
  // Only the path survives: no query string, so nothing (a workspace, a token) rides along.
  return EXACT.has(path) || INVITE.test(path) || SECTION.test(path) ? path : fallback;
}

/**
 * The origin an emailed or provider link points back at.
 *
 * The request's own origin when it is one this deployment answers on — the canonical host,
 * the configured app URL, or localhost outside production — and otherwise the canonical
 * host. A preview deployment or a forged `Origin` therefore never becomes the address in a
 * confirmation email. Supabase checks the same address against its own redirect allow list
 * and falls back to its Site URL when it is not there.
 */
export function appOrigin(candidate: string | null | undefined, env: Record<string, string | undefined> = process.env): string {
  const canonical = `https://${env.CANONICAL_HOST ?? "www.nover.space"}`;
  const allowed = new Set<string>([canonical]);
  for (const configured of [env.NEXT_PUBLIC_SITE_URL, env.NEXT_PUBLIC_APP_URL]) {
    const origin = originOf(configured);
    if (origin && (env.VERCEL_ENV !== "production" || origin.startsWith("https://"))) allowed.add(origin);
  }
  const origin = originOf(candidate);
  if (origin && allowed.has(origin)) return origin;
  if (origin && env.VERCEL_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) return origin;
  return canonical;
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The providers Novera offers. Each appears only once Supabase reports it enabled. */
export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const PROVIDER_LABEL: Record<OAuthProvider | "email", string> = { google: "Google", github: "GitHub", email: "Email and password" };

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}
