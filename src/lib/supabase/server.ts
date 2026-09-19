import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The signed-in user's client, for reads in server components.
 *
 * Uses the anon key, so RLS decides what comes back. Reads go through this;
 * writes go through a server action holding the service role, which checks
 * membership explicitly — see `src/lib/auth/session.ts`.
 *
 * A fresh client per render, never shared across requests.
 */
export async function sessionClient(): Promise<SupabaseClient> {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) store.set(name, value, options);
          } catch {
            // Server components cannot set cookies. Token refresh is handled in
            // proxy.ts, so this is safe to ignore here.
          }
        },
      },
    },
  );
}
