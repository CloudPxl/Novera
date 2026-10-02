import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionClient } from "../supabase/server.ts";
import { serviceClient } from "../supabase/service.ts";
import { can, isRole, permissionsOf, refusalFor, type Capability, type Role } from "./permissions.ts";

export interface Workspace {
  id: string;
  name: string;
  plan: "trial" | "paid";
}

export type AccountMode = "personal" | "agency" | "enterprise";

/** A person's preferences (0054). Never credentials, replies, customer data or conclusions. */
export interface UserProfile {
  user_id: string;
  account_mode: AccountMode;
  display_name: string | null;
  job_title: string | null;
  company_name: string | null;
  locale: string;
  timezone: string;
  reduced_motion: "system" | "reduce" | "allow";
  notifications: Record<string, boolean>;
  onboarding_status: "not_started" | "skipped" | "completed";
  primary_goal: "own_agent" | "client_delivery" | "governance" | null;
  channels: string[];
  default_workspace_id: string | null;
  default_agent_id: string | null;
  preferred_suite_key: string | null;
  report_format: "link" | "pdf" | "markdown" | "json" | "junit" | "csv";
  assistant_memory: boolean;
}

export interface Membership {
  workspace: Workspace;
  role: Role;
  joinedAt: string;
}

/**
 * Everything a page, an action or the assistant needs to know about who is asking and where —
 * resolved once per request from the verified session, never from a value the browser sent
 * without a membership check.
 */
export interface UserContext {
  user: User;
  profile: UserProfile;
  accountMode: AccountMode;
  workspace: Workspace;
  role: Role;
  permissions: Capability[];
  memberships: Membership[];
}

/** The workspace a person chose, remembered per browser. Always checked against membership. */
export const ACTIVE_WORKSPACE_COOKIE = "nv_ws";

/** An invitation opened before signing in, held in the invitee's own browser until they are. */
export const INVITE_COOKIE = "nv_invite";

/** The signed-in user, verified against Supabase rather than trusted from a cookie. */
export const currentUser = cache(async (): Promise<User | null> => {
  const { data } = await (await sessionClient()).auth.getUser();
  return data.user ?? null;
});

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

async function membershipsOf(client: SupabaseClient, userId: string, afterWrite = false): Promise<Membership[]> {
  let query = client
    .from("workspace_members")
    .select("role, created_at, workspaces(id, name, plan, created_at)")
    .eq("user_id", userId);
  // Next memoizes identical GET requests within one render. The read right after creating a
  // workspace is otherwise byte-identical to the empty read before it, and was answered from
  // that memo: every new account failed with "no membership was recorded" (found 2026-10-02 by
  // the identity walk). A different request shape is a different memo entry.
  if (afterWrite) query = query.order("workspace_id");
  const { data, error } = await query;
  if (error) throw new Error(`Could not read your workspaces: ${error.message}`);
  return (data ?? [])
    .filter((m) => m.workspaces && isRole(m.role))
    .map((m) => {
      const w = m.workspaces as unknown as Workspace & { created_at: string };
      return { workspace: { id: w.id, name: w.name, plan: w.plan }, role: m.role as Role, joinedAt: w.created_at };
    })
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

/**
 * The person's context, created on first use when `create` is set (a page), never as a side
 * effect of an API call (`create` unset): an expired session once ended up owning an empty
 * second workspace that way.
 *
 * The active workspace is, in order: the one this browser chose (cookie) if the person still
 * belongs to it; their profile's default if they still belong to it; their oldest. A removed
 * member's cookie therefore points nowhere and falls through — it can never reopen access.
 */
const loadContext = cache(async (create: boolean): Promise<UserContext | null> => {
  const user = await currentUser();
  if (!user) return null;
  const client = await sessionClient();

  let memberships = await membershipsOf(client, user.id);
  if (memberships.length === 0) {
    if (!create) return null;
    // Check-and-create in one locked database call (0029).
    const { error } = await client.rpc("ensure_workspace", { p_name: defaultWorkspaceName(user) }).single();
    if (error) throw new Error(`Could not create your workspace: ${error.message}`);
    memberships = await membershipsOf(client, user.id, true);
    if (memberships.length === 0) throw new Error("Could not create your workspace: no membership was recorded.");
  }

  const { data: profile, error: profileError } = await client.rpc("ensure_profile").single();
  if (profileError || !profile) throw new Error(`Could not load your profile: ${profileError?.message ?? "no row returned"}`);
  const p = profile as UserProfile;

  const chosen = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const active =
    memberships.find((m) => m.workspace.id === chosen) ??
    memberships.find((m) => m.workspace.id === p.default_workspace_id) ??
    memberships[0];

  return {
    user,
    profile: p,
    accountMode: p.account_mode,
    workspace: active.workspace,
    role: active.role,
    permissions: permissionsOf(active.role),
    memberships,
  };
});

export async function requireContext(): Promise<UserContext> {
  const user = await requireUser();
  void user;
  const ctx = await loadContext(true);
  if (!ctx) redirect("/sign-in");
  return ctx;
}

/** The user and their active workspace, created on first use. Pages and server actions. */
export async function requireWorkspace(): Promise<{ user: User; workspace: Workspace; role: Role; context: UserContext }> {
  const ctx = await requireContext();
  return { user: ctx.user, workspace: ctx.workspace, role: ctx.role, context: ctx };
}

function defaultWorkspaceName(user: User): string {
  // Strip plus-addressing and separators: "ada+novera-test@x.com" should not become
  // "Ada+novera-test's workspace".
  const local = (user.email ?? "workspace").split("@")[0].split("+")[0];
  const name = local.replace(/[._-]+/g, " ").trim() || "My";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}'s workspace`;
}

/**
 * The signed-in user and their active workspace, or null — never a redirect, never a creation.
 *
 * `requireWorkspace` redirects, which is right for a page and wrong for a route handler: `fetch`
 * follows the 307 transparently, so a client polling an API got the sign-in page's HTML with
 * status 200, read `res.ok` as success, and left the run sitting at "running" forever.
 */
export async function currentWorkspace(): Promise<{ user: User; workspace: Workspace; role: Role } | null> {
  const ctx = await loadContext(false);
  return ctx ? { user: ctx.user, workspace: ctx.workspace, role: ctx.role } : null;
}

/** A refusal on permission, worded for the person; actions return its message as their error. */
export class PermissionDenied extends Error {}

/**
 * Gate for every server action that writes.
 *
 * Writes use the service role, which bypasses RLS — so membership, and the role's permission
 * for this capability, are proven here against the live row rather than assumed from the fact
 * that a page rendered. A role changed or a member removed a second ago is already in force.
 */
export async function assertMembership(userId: string, workspaceId: string, capability?: Capability): Promise<SupabaseClient> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not check workspace membership: ${error.message}`);
  if (!data) throw new PermissionDenied("You do not have access to this workspace.");
  if (capability && !can(isRole(data.role) ? data.role : null, capability)) throw new PermissionDenied(refusalFor(capability));
  return admin;
}

/** The same gate, answering in the shape a form action returns. */
export async function gate(userId: string, workspaceId: string, capability: Capability): Promise<{ admin: SupabaseClient } | { error: string }> {
  try {
    return { admin: await assertMembership(userId, workspaceId, capability) };
  } catch (e) {
    if (e instanceof PermissionDenied) return { error: e.message };
    throw e;
  }
}
