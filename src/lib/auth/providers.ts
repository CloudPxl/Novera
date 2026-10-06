import "server-only";
import { OAUTH_PROVIDERS, type OAuthProvider } from "./redirects.ts";

/**
 * The social sign-in methods Supabase reports as switched on, read from its public settings
 * endpoint. A button for a provider nobody configured is a button that fails after the
 * person has already left for Google; so a provider appears only once it is enabled there,
 * and no code change is needed the day it is.
 *
 * Cached for five minutes. When the endpoint cannot be read, no social button is shown —
 * email and password still are.
 */
export async function enabledProviders(): Promise<OAuthProvider[]> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return [];
  try {
    const res = await fetch(`${base}/auth/v1/settings`, {
      headers: { apikey: key },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { external?: Record<string, unknown> };
    return OAUTH_PROVIDERS.filter((p) => body.external?.[p] === true);
  } catch {
    return [];
  }
}
