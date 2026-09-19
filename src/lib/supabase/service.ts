import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client. Bypasses RLS, so it is the only way the server can write
 * evidence — and the reason every write path validates the workspace itself.
 *
 * `server-only` makes importing this from a client component a build error rather
 * than a leaked key.
 */
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
