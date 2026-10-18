/**
 * The one address production answers on, decided before anything else runs (`src/proxy.ts`).
 *
 * Vercel serves production on the apex (`nover.space`) and on `*.vercel.app` aliases too. A
 * cookie set on one host is invisible on another, so a sign-in, a PKCE verifier or a workspace
 * choice made on the apex would sit beside a different set on `www` — and an emailed link
 * returns to `www`. So in production every other host is sent to the same path and query on the
 * canonical host with a 308, before a session is read or a cookie written. Preview deployments
 * are left alone: they exist to be looked at on their own URL.
 */
export const CANONICAL_HOST = process.env.CANONICAL_HOST ?? "www.nover.space";

/** The URL to send this request to, or null when it is already where it should be. */
export function canonicalRedirect(
  url: { pathname: string; search: string },
  host: string | null,
  env: Record<string, string | undefined> = process.env,
  canonical: string = CANONICAL_HOST,
): string | null {
  if (env.VERCEL_ENV !== "production" || !host || host === canonical) return null;
  return new URL(url.pathname + url.search, `https://${canonical}`).toString();
}
