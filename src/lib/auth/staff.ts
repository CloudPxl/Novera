import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { requireUser } from "./session.ts";
import { isStaff } from "./staff-list.ts";

/** Who may see the inbound queue and the launch-readiness page: the list in ./staff-list.ts. */
export { isStaff, staffEmails } from "./staff-list.ts";

export async function requireStaff(): Promise<User> {
  const user = await requireUser();
  // Not a 403 page: someone who is signed in but not staff has no business knowing
  // this route exists.
  if (!isStaff(user.email)) redirect("/dashboard");
  return user;
}
