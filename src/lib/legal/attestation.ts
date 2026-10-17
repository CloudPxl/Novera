/**
 * Who declared that an agent may be tested, as the stored attestation sentence names them.
 *
 * The sentence is frozen on the agent when it is connected (0057), copied onto each run, and sealed
 * into every report of that agent's runs as `subject.authorisation`. Until 2026-10-16 it named the
 * member's email address, which then reached everyone holding a report link and outlived the
 * member's account. The founder's memo of 2026-10-16 proposes binding attestations to a workspace
 * role and an id instead of personal data where feasible, so new attestations name the member's
 * role and user id (counsel question 35, awaiting confirmation).
 *
 * What does not change: an agent connected earlier keeps its frozen text, so its new runs still
 * carry the email; a sealed report never changes; the report payload's field stays a string, so
 * no format bump or absence branch is needed. The workspace can still resolve the id to a member
 * (`agents.attested_by` holds the same id), and after an account is deleted the id names nobody.
 *
 * Pure, so it is tested without a database.
 */
import { ROLES, type Role } from "../auth/permissions.ts";

/** "A workspace admin (user id 3f2a…)", the subject of an attestation sentence. */
export function attestationActor(userId: string, role: Role | null | undefined): string {
  const who = role && ROLES.includes(role) ? `workspace ${role}` : "workspace member";
  return `A ${who} (user id ${userId})`;
}

/** The sentence stored on an agent a member connects. `date` is YYYY-MM-DD. */
export function agentAttestation(args: { userId: string; role: Role | null | undefined; date: string }): string {
  return `${attestationActor(args.userId, args.role)} confirmed on ${args.date} that this agent is owned by their organisation or tested with permission.`;
}
