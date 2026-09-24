import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionClient } from "../supabase/server.ts";
import { serviceClient } from "../supabase/service.ts";

export interface Workspace {
  id: string;
  name: string;
  plan: "trial" | "paid";
}

/** The signed-in user, verified against Supabase rather than trusted from a cookie. */
export async function currentUser(): Promise<User | null> {
  const { data } = await (await sessionClient()).auth.getUser();
  return data.user ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * The user's workspace, created on first use.
 *
 * One workspace per user for now. Multi-workspace membership is already in the
 * schema; adding a switcher later needs no migration.
 */
export async function requireWorkspace(): Promise<{ user: User; workspace: Workspace }> {
  const user = await requireUser();
  const client = await sessionClient();

  const { data: existing } = await client
    .from("workspaces")
    .select("id, name, plan")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) return { user, workspace: existing as Workspace };

  // The database trigger adds the owner as a member, so this one insert is enough.
  const { data: created, error } = await client
    .from("workspaces")
    .insert({ name: defaultWorkspaceName(user), owner_id: user.id })
    .select("id, name, plan")
    .single();

  if (error) throw new Error(`Could not create your workspace: ${error.message}`);
  return { user, workspace: created as Workspace };
}

function defaultWorkspaceName(user: User): string {
  // Strip plus-addressing and separators: "ada+novera-test@x.com" should not become
  // "Ada+novera-test's workspace".
  const local = (user.email ?? "workspace").split("@")[0].split("+")[0];
  const name = local.replace(/[._-]+/g, " ").trim() || "My";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}'s workspace`;
}

/**
 * Gate for every server action that writes.
 *
 * Writes use the service role, which bypasses RLS — so membership has to be proven
 * here, explicitly, rather than assumed from the fact that a page rendered.
 */
/**
 * The signed-in user and their workspace, or null — never a redirect.
 *
 * `requireWorkspace` redirects, which is right for a page and wrong for a route
 * handler: `fetch` follows the 307 transparently, so a client polling an API got the
 * sign-in page's HTML with status 200, read `res.ok` as success, and left the run
 * sitting at "running" forever with nothing said. A route that declines has to say so
 * in the shape its caller is reading.
 *
 * It also never *creates* a workspace. Creating one as a side effect of an API call is
 * how an expired session ends up owning an empty second workspace.
 */
export async function currentWorkspace(): Promise<{ user: User; workspace: Workspace } | null> {
  const user = await currentUser();
  if (!user) return null;

  const client = await sessionClient();
  const { data } = await client
    .from("workspaces")
    .select("id, name, plan")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ? { user, workspace: data as Workspace } : null;
}

export async function assertMembership(userId: string, workspaceId: string): Promise<SupabaseClient> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not check workspace membership: ${error.message}`);
  if (!data) throw new Error("You do not have access to this workspace.");
  return admin;
}
