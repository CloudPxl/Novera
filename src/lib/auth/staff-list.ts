/**
 * Who is staff: a list of addresses in the server environment rather than a role column. There
 * are two of us, the list changes about never, and a column would invite a UI for editing it that
 * nobody needs. If this ever grows past a handful of people it should become a real role — at
 * which point these two functions are the only thing that has to change.
 *
 * Pure, apart from reading the environment, so the tests can hand it any list; the redirect that
 * enforces it is `requireStaff` (./staff.ts).
 */
export function staffEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.NOVERA_STAFF_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isStaff(email: string | undefined, env?: Record<string, string | undefined>): boolean {
  if (!email) return false;
  return staffEmails(env).includes(email.toLowerCase());
}
