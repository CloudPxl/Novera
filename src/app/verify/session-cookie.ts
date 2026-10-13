import { cookies } from "next/headers";

/**
 * Whether a Supabase session cookie is present, for the header's "dashboard" or "sign in" link.
 * No network call: the receipt page makes exactly one database read, and a header link is not
 * worth an auth round trip. A stale cookie only means the dashboard link asks for a sign-in.
 */
export async function hasSessionCookie(): Promise<boolean> {
  return (await cookies()).getAll().some((c) => c.name.startsWith("sb-"));
}
