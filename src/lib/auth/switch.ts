import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_WORKSPACE_COOKIE } from "./session.ts";
import { sessionClient } from "../supabase/server.ts";

/**
 * Ends whatever session this browser already holds before another one starts (2026-10-18).
 *
 * Live testing found a browser signed in as one person that signed up a second account: the
 * first session and its workspace cookie stayed in place while the second waited for its email,
 * and a confirmation link that could not be spent left the browser in the first account. So a
 * sign-up, a password sign-in or a provider sign-in starts from no session, and a callback that
 * fails leaves none behind. `scope: "local"` ends this browser's session only, never the
 * person's sessions elsewhere. The workspace cookie goes with it; membership is checked on every
 * request anyway (`pickActiveWorkspace`), so this is about never carrying one person's choice
 * into another's first page.
 */
export async function endBrowserSession(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
}

/** Forgets the workspace choice without touching the session: a new person's first page. */
export async function forgetWorkspaceChoice(): Promise<void> {
  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
}

/**
 * `endBrowserSession` for a route that otherwise never touches this browser's session
 * (`/auth/confirm`): it only ever ends one, never starts one.
 */
export async function endThisBrowserSession(): Promise<void> {
  await endBrowserSession(await sessionClient());
}
