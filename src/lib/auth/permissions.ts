/**
 * Who may do what in a workspace — the matrix in docs/audits/2026-10-02-identity-and-tenancy.md,
 * as the one table every server action asks.
 *
 * Writes go through the service role, which bypasses RLS, so this check is what stands between
 * a reviewer and a policy edit. The three tables a client may write directly carry the same
 * rules in their RLS policies (0054); the two must agree, and `tests/permissions.test.ts` holds
 * them to the audit's table.
 *
 * A personal account is one owner holding every permission: the same checks run and pass.
 */

export const ROLES = ["owner", "admin", "operator", "reviewer", "auditor"] as const;
export type Role = (typeof ROLES)[number];

/** Roles an invitation or a role change may grant. Ownership is never handed out this way. */
export const GRANTABLE_ROLES = ["admin", "operator", "reviewer", "auditor"] as const satisfies readonly Role[];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  operator: "Operator",
  reviewer: "Reviewer",
  auditor: "Auditor",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: "Everything, including retention and erasing the workspace. One per workspace.",
  admin: "Everything except retention and erasure: members, keys, webhooks, the model key.",
  operator: "Connects agents, writes policy, runs suites and schedules. Cannot approve.",
  reviewer: "Reads evidence, asks why, approves or rejects drafts and proposals, records findings.",
  auditor: "Reads everything, including the audit log. Changes nothing.",
};

const ALL: Role[] = ["owner", "admin", "operator", "reviewer", "auditor"];
const BUILD: Role[] = ["owner", "admin", "operator"];
const APPROVE: Role[] = ["owner", "admin", "reviewer"];
const CONTRIBUTE: Role[] = ["owner", "admin", "operator", "reviewer"];
const ADMIN: Role[] = ["owner", "admin"];

export const PERMISSIONS = {
  "workspace.view": ALL,
  "agent.write": BUILD,
  // Marking an agent as a test target lets destructive and fixture-only scenarios reach it.
  "agent.environment": ADMIN,
  "policy.write": BUILD,
  "run.start": BUILD,
  "run.stop": BUILD,
  "schedule.write": BUILD,
  "suite.import": BUILD,
  "case.retest": BUILD,
  "diagnosis.request": CONTRIBUTE,
  "diagnosis.decide": APPROVE,
  "finding.record": APPROVE,
  "report.reissue": APPROVE,
  "scenario.draft": CONTRIBUTE,
  "regression.record": CONTRIBUTE,
  "scenario.decide": APPROVE,
  "scenario.promote": APPROVE,
  "apikey.manage": ADMIN,
  "apikey.grant_responses": ADMIN,
  "webhook.manage": ADMIN,
  "judgekey.manage": ADMIN,
  "retention.change": ["owner"],
  "report.withdraw": ADMIN,
  "report.export": ALL,
  "member.invite": ADMIN,
  "member.manage": ADMIN,
  "audit.view": ["owner", "admin", "auditor"],
  "workspace.erase": ["owner"],
  // A copy of everything in the workspace leaves Novera: the people who manage it (0061).
  "workspace.export": ADMIN,
  "workspace.rename": ADMIN,
  "memory.workspace": BUILD,
  // Starting a checkout, opening the billing portal, scheduling a cancellation (0060).
  "billing.manage": ADMIN,
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, capability: Capability): boolean {
  return Boolean(role) && (PERMISSIONS[capability] as readonly Role[]).includes(role as Role);
}

export function permissionsOf(role: Role | null | undefined): Capability[] {
  return (Object.keys(PERMISSIONS) as Capability[]).filter((c) => can(role, c));
}

/** The sentence a refusal says. Names the capability in words and who has it. */
export function refusalFor(capability: Capability): string {
  const who = (PERMISSIONS[capability] as readonly Role[]).map((r) => ROLE_LABEL[r].toLowerCase());
  const list = who.length === 1 ? who[0] : `${who.slice(0, -1).join(", ")} or ${who.at(-1)}`;
  return `Your role in this workspace cannot do that. It needs the ${list} role.`;
}

/**
 * Whether `actor` may give `target` a role, or remove them. An admin manages operators,
 * reviewers and auditors; only the owner manages admins; nobody manages the owner here.
 */
export function canManageMember(actor: Role, target: Role, nextRole?: Role): boolean {
  if (target === "owner" || nextRole === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target !== "admin" && nextRole !== "admin";
  return false;
}
