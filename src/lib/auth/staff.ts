import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { requireUser } from "./session.ts";

/**
 * Who may see the inbound queue.
 *
 * A list of addresses in the server environment rather than a role column: there are
 * two of us, the list changes about never, and a column would invite a UI for editing
 * it that nobody needs. If this ever grows past a handful of people it should become
 * a real role — at which point this function is the only thing that has to change.
 */
export function staffEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.NOVERA_STAFF_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isStaff(email: string | undefined, env?: NodeJS.ProcessEnv): boolean {
  if (!email) return false;
  return staffEmails(env).includes(email.toLowerCase());
}

export async function requireStaff(): Promise<User> {
  const user = await requireUser();
  // Not a 403 page: someone who is signed in but not staff has no business knowing
  // this route exists.
  if (!isStaff(user.email)) redirect("/dashboard");
  return user;
}
