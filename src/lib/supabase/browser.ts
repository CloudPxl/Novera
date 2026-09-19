import { createBrowserClient } from "@supabase/ssr";

/** Anon client for the browser. RLS is what protects the data here, not the key. */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
