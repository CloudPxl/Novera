"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireContext, assertMembership, gate, ACTIVE_WORKSPACE_COOKIE, INVITE_COOKIE, type AccountMode } from "@/lib/auth/session.ts";
import { canManageMember, GRANTABLE_ROLES, isRole, ROLE_LABEL, type Role } from "@/lib/auth/permissions.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { mailProblem, sendEmail } from "@/lib/mail/send.ts";
import { appOrigin } from "@/lib/auth/redirects.ts";
import { fingerprint, rateLimit } from "@/lib/support/rate-limit.ts";
import { isMemoryKey } from "@/lib/assistant/memory.ts";
import { saveMemory } from "./memory.ts";
import { actorHash } from "@/lib/analytics/track.ts";

export interface IdentityState {
  error?: string;
  notice?: string;
  /** An invitation link, shown once to the person who created it. */
  link?: string;
}

const MODES: AccountMode[] = ["personal", "agency", "enterprise"];
const ONE_YEAR = 60 * 60 * 24 * 365;

/** A path on this site, never another origin: `//evil.example` and `/\evil` are refused. */
function safeNext(raw: unknown, fallback = "/dashboard"): string {
  const s = String(raw ?? "");
  return /^\/(?![/\\])[\w\-./?=&%#]*$/.test(s) ? s : fallback;
}

async function setActiveWorkspace(id: string) {
  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, id, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ONE_YEAR,
  });
}

const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ================================================================= workspaces

/**
 * Makes another of the person's workspaces the active one. The id comes from the browser, so it
 * is honoured only if the person belongs to that workspace now.
 */
export async function switchWorkspace(form: FormData): Promise<void> {
  const ctx = await requireContext();
  const id = String(form.get("workspaceId") ?? "");
  const target = ctx.memberships.find((m) => m.workspace.id === id);
  if (!target) redirect("/dashboard");
  if (target.workspace.id !== ctx.workspace.id) {
    await setActiveWorkspace(target.workspace.id);
    await recordAudit(serviceClient(), { workspaceId: null, actorId: ctx.user.id, action: "workspace.switched", detail: { to: target.workspace.id } });
  }
  revalidatePath("/", "layout");
  redirect(safeNext(form.get("next")));
}

/** A new workspace — for an agency, usually one per client — owned by the person, made active. */
export async function createWorkspace(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const ctx = await requireContext();
  const name = text(form, "name", 120);
  if (name.length < 2) return { error: "Give the workspace a name — usually the client's." };
  if (ctx.memberships.filter((m) => m.role === "owner").length >= 25) {
    return { error: "You own 25 workspaces, the most one account can own for now. Write to support if you need more." };
  }
  const db = await sessionClient();
  // Through the person's own session: ws_insert allows exactly "owner is me", and the
  // workspaces_add_owner trigger makes them its owner member.
  const { data, error } = await db.from("workspaces").insert({ name, owner_id: ctx.user.id }).select("id").single();
  if (error || !data) return { error: `Could not create the workspace: ${error?.message ?? "no row"}` };
  await recordAudit(serviceClient(), { workspaceId: data.id as string, actorId: ctx.user.id, action: "workspace.created", detail: {} });
  await setActiveWorkspace(data.id as string);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function renameWorkspace(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user, workspace } = await requireContext();
  const gated = await gate(user.id, workspace.id, "workspace.rename");
  if ("error" in gated) return { error: gated.error };
  const name = text(form, "name", 120);
  if (name.length < 2) return { error: "A workspace needs a name." };
  const { error } = await gated.admin.from("workspaces").update({ name }).eq("id", workspace.id);
  if (error) return { error: `Could not rename it: ${error.message}` };
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "workspace.renamed", detail: {} });
  revalidatePath("/", "layout");
  return { notice: "Renamed. New reports carry the new name; sealed reports keep the name they were sealed with." };
}

// =================================================================== profile

/**
 * The person's preferences. Each one has an effect on screen or in Ask Novera, and none is
 * read by grading, suites, policies or reports.
 */
export async function saveProfile(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const ctx = await requireContext();
  const admin = serviceClient();
  const defaultWorkspace = String(form.get("defaultWorkspaceId") ?? "") || null;
  const defaultAgent = String(form.get("defaultAgentId") ?? "") || null;
  const update = {
    display_name: text(form, "displayName", 80) || null,
    job_title: text(form, "jobTitle", 80) || null,
    company_name: text(form, "companyName", 120) || null,
    timezone: text(form, "timezone", 64) || "UTC",
    locale: ["en-GB", "en-US", "de-DE", "fr-FR", "ro-RO"].includes(String(form.get("locale"))) ? String(form.get("locale")) : "en-GB",
    reduced_motion: ["system", "reduce", "allow"].includes(String(form.get("reducedMotion"))) ? String(form.get("reducedMotion")) : "system",
    report_format: ["link", "pdf", "markdown", "json", "junit", "csv"].includes(String(form.get("reportFormat"))) ? String(form.get("reportFormat")) : "link",
    preferred_suite_key: text(form, "preferredSuiteKey", 64) || null,
    // Checked by the database too (0054): a default can only point where the person belongs.
    default_workspace_id: defaultWorkspace && ctx.memberships.some((m) => m.workspace.id === defaultWorkspace) ? defaultWorkspace : null,
    default_agent_id: defaultAgent,
    assistant_memory: form.get("assistantMemory") === "on",
  };
  const { error } = await admin.from("user_profiles").update(update).eq("user_id", ctx.user.id);
  if (error) return { error: /timezone/i.test(error.message) ? "That timezone is not one Novera recognises. Use a name like Europe/Bucharest." : /default agent/i.test(error.message) ? "The default agent must be one in a workspace you belong to." : `Could not save: ${error.message}` };
  await recordAudit(admin, { workspaceId: null, actorId: ctx.user.id, action: "account.profile_updated", detail: { fields: Object.keys(update) } });
  revalidatePath("/", "layout");
  return { notice: "Saved." };
}

/**
 * How Novera presents itself: personal, agency or enterprise. Presentation only — no data
 * moves, is copied or is deleted, and no permission changes; switching back hides what this
 * showed, it removes nothing.
 */
export async function setAccountMode(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const ctx = await requireContext();
  const mode = String(form.get("mode")) as AccountMode;
  if (!MODES.includes(mode)) return { error: "Choose personal, agency or enterprise." };
  if (mode === ctx.accountMode) return { notice: "Nothing changed." };
  const admin = serviceClient();
  const { error } = await admin.from("user_profiles").update({ account_mode: mode }).eq("user_id", ctx.user.id);
  if (error) return { error: `Could not change it: ${error.message}` };
  await recordAudit(admin, { workspaceId: null, actorId: ctx.user.id, action: "account.mode_changed", detail: { from: ctx.accountMode, to: mode } });
  revalidatePath("/", "layout");
  return { notice: `Now in ${mode} mode. Nothing was moved or deleted.` };
}

/** The three onboarding answers. Each is stored and each changes something (docs/audits). */
export async function completeOnboarding(form: FormData): Promise<void> {
  const ctx = await requireContext();
  const who = String(form.get("who") ?? "");
  const mode: AccountMode = who === "agency" ? "agency" : who === "company" ? "enterprise" : "personal";
  const goal = ["own_agent", "client_delivery", "governance"].includes(String(form.get("goal"))) ? String(form.get("goal")) : null;
  const channels = form.getAll("channels").map(String).filter((c) => ["web", "voice", "email"].includes(c));
  const admin = serviceClient();
  await admin.from("user_profiles").update({
    account_mode: mode, primary_goal: goal, channels, onboarding_status: "completed",
    display_name: text(form, "displayName", 80) || ctx.profile.display_name,
  }).eq("user_id", ctx.user.id);
  if (mode !== ctx.accountMode) {
    await recordAudit(admin, { workspaceId: null, actorId: ctx.user.id, action: "account.mode_changed", detail: { from: ctx.accountMode, to: mode, via: "onboarding" } });
  }
  revalidatePath("/", "layout");
  redirect(goal === "client_delivery" ? "/workspaces" : ctx.memberships.length && (await hasAgent(ctx.workspace.id)) ? "/dashboard" : "/agents/new");
}

async function hasAgent(workspaceId: string): Promise<boolean> {
  const { count } = await serviceClient().from("agents").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  return (count ?? 0) > 0;
}

export async function skipOnboarding(): Promise<void> {
  const ctx = await requireContext();
  await serviceClient().from("user_profiles").update({ onboarding_status: "skipped" }).eq("user_id", ctx.user.id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/** Back to defaults: preferences and memory. Workspaces, evidence and reports are untouched. */
export async function resetPersonalization(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const ctx = await requireContext();
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  const admin = serviceClient();
  await admin.from("user_profiles").update({
    display_name: null, job_title: null, company_name: null, timezone: "UTC", locale: "en-GB", reduced_motion: "system",
    report_format: "link", preferred_suite_key: null, default_workspace_id: null, default_agent_id: null, assistant_memory: false,
    notifications: {}, primary_goal: null, channels: [],
  }).eq("user_id", ctx.user.id);
  await admin.from("assistant_memory").delete().eq("user_id", ctx.user.id).is("workspace_id", null);
  await recordAudit(admin, { workspaceId: null, actorId: ctx.user.id, action: "account.personalization_reset", detail: {} });
  revalidatePath("/", "layout");
  return { notice: "Your preferences and personal memory were reset. Workspaces, runs and reports were not touched." };
}

// =================================================================== members

const INVITE_LIMIT = { max: 20, windowSeconds: 60 * 60 };

export async function inviteMember(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const ctx = await requireContext();
  const { user, workspace, role: actorRole } = ctx;
  const gated = await gate(user.id, workspace.id, "member.invite");
  if ("error" in gated) return { error: gated.error };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = String(form.get("role") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return { error: "Enter the email address they sign in with." };
  if (!isRole(role) || !(GRANTABLE_ROLES as readonly string[]).includes(role)) return { error: "Choose a role." };
  if (!canManageMember(actorRole, "auditor", role as Role)) return { error: `Only the owner can invite an ${ROLE_LABEL[role as Role].toLowerCase()}.` };
  if (email === (user.email ?? "").toLowerCase()) return { error: "You are already in this workspace." };

  const { count: open } = await gated.admin.from("workspace_invitations").select("*", { count: "exact", head: true })
    .eq("workspace_id", workspace.id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString());
  if ((open ?? 0) >= 20) return { error: "This workspace has 20 open invitations. Revoke some first." };
  // Revoking and inviting again sent an email each time, unbounded, carrying a workspace name the
  // inviter chose. Counted per person; refused when the count cannot be read, because each one is mail.
  const invites = await rateLimit(fingerprint(["invite", user.id]), INVITE_LIMIT, { onError: "refuse" });
  if (!invites.allowed) {
    return { error: invites.counted ? `That is ${INVITE_LIMIT.max} invitations in an hour. Try again in about ${invites.retryAfterMinutes} minutes.` : "Novera could not check the invitation limit just now. Try again in a minute." };
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: inv, error } = await gated.admin.from("workspace_invitations")
    .insert({ workspace_id: workspace.id, email, role, token_hash: tokenHash, invited_by: user.id }).select("id, expires_at").single();
  if (error || !inv) return { error: `Could not create the invitation: ${error?.message ?? "no row"}` };
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "member.invited", detail: { invitation: inv.id, role } });

  // Only this deployment's own address, as every other emailed link (src/lib/auth/redirects.ts).
  const link = `${appOrigin((await headers()).get("origin"))}/invite/${token}`;
  const sent = await sendEmail({
    to: email,
    subject: `You are invited to ${workspace.name} on Novera`,
    text: [
      `${ctx.profile.display_name ?? user.email} invited you to the workspace "${workspace.name}" on Novera, as ${ROLE_LABEL[role as Role].toLowerCase()}.`,
      "",
      `Accept: ${link}`,
      "",
      `The link works once, for ${email}, and expires in seven days. If you did not expect this, ignore it.`,
    ].join("\n"),
  });
  revalidatePath("/settings/members");
  return {
    notice: sent.ok
      ? `Invitation sent to ${email}. The link is also below, once — it works only for that address.`
      : `Invitation created, but the email was not sent — ${mailProblem(sent.error)} Send them this link yourself. It is shown once and works only for ${email}.`,
    link,
  };
}

export async function revokeInvitation(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user, workspace } = await requireContext();
  const gated = await gate(user.id, workspace.id, "member.invite");
  if ("error" in gated) return { error: gated.error };
  const id = String(form.get("invitationId") ?? "");
  const { data, error } = await gated.admin.from("workspace_invitations")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", id).eq("workspace_id", workspace.id).is("accepted_at", null).is("revoked_at", null).select("id");
  if (error) return { error: `Could not revoke it: ${error.message}` };
  if (!data?.length) return { error: "That invitation is not open any more." };
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "member.invitation_revoked", detail: { invitation: id } });
  revalidatePath("/settings/members");
  return { notice: "Revoked. The link no longer works." };
}

const INVITE_PROBLEM: Record<string, string> = {
  invitation_not_found: "That invitation link is not valid.",
  invitation_revoked: "That invitation was revoked by the workspace.",
  invitation_used: "That invitation has already been used.",
  invitation_expired: "That invitation has expired. Ask for a new one.",
  invitation_other_email: "That invitation is for a different email address. Sign in with the address it was sent to.",
};

/**
 * Signed out on an invitation link: the token is kept in this browser only (httpOnly, seven
 * days, this site), so after signing in or confirming a new account the operator shell can
 * offer it back. Holding it grants nothing; accepting is still checked in the database.
 */
export async function holdInvitation(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  if (/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    (await cookies()).set(INVITE_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7,
    });
  }
  redirect("/sign-in");
}

/** Accepted as the signed-in person, in the database (0054 accept_invitation), in one step. */
export async function acceptInvitation(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  await requireContext();
  const token = String(form.get("token") ?? "");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = await sessionClient();
  const { data, error } = await db.rpc("accept_invitation", { p_token_hash: tokenHash }).single();
  if (error || !data) {
    const code = Object.keys(INVITE_PROBLEM).find((k) => error?.message.includes(k));
    return { error: code ? INVITE_PROBLEM[code] : "The invitation could not be accepted." };
  }
  (await cookies()).delete(INVITE_COOKIE);
  await setActiveWorkspace((data as { workspace_id: string }).workspace_id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function changeRole(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user, workspace, role: actorRole } = await requireContext();
  const gated = await gate(user.id, workspace.id, "member.manage");
  if ("error" in gated) return { error: gated.error };
  const target = String(form.get("userId") ?? "");
  const next = String(form.get("role") ?? "");
  if (!isRole(next)) return { error: "Choose a role." };
  const { data: member } = await gated.admin.from("workspace_members").select("role").eq("workspace_id", workspace.id).eq("user_id", target).maybeSingle();
  if (!member || !isRole(member.role)) return { error: "That person is not in this workspace." };
  if (member.role === next) return { notice: "Nothing changed." };
  if (!canManageMember(actorRole, member.role, next)) return { error: "Your role cannot make that change. Only the owner manages admins, and nobody changes the owner here." };
  const { error } = await gated.admin.from("workspace_members").update({ role: next }).eq("workspace_id", workspace.id).eq("user_id", target);
  if (error) return { error: `Could not change the role: ${error.message}` };
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, subjectUserId: target, action: "member.role_changed", detail: { from: member.role, to: next } });
  revalidatePath("/settings/members");
  return { notice: `Now ${ROLE_LABEL[next].toLowerCase()}. It applies to their next action.` };
}

/** Removal takes effect on the member's next request, and revokes the API keys they created. */
export async function removeMember(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user, workspace, role: actorRole } = await requireContext();
  const gated = await gate(user.id, workspace.id, "member.manage");
  if ("error" in gated) return { error: gated.error };
  const target = String(form.get("userId") ?? "");
  if (target === user.id) return { error: "To leave, use Leave this workspace." };
  const { data: member } = await gated.admin.from("workspace_members").select("role").eq("workspace_id", workspace.id).eq("user_id", target).maybeSingle();
  if (!member || !isRole(member.role)) return { error: "That person is not in this workspace." };
  if (!canManageMember(actorRole, member.role)) return { error: "Your role cannot remove them." };
  const { data: keys, error } = await gated.admin.rpc("remove_workspace_member", { p_ws: workspace.id, p_user: target, p_actor: user.id });
  if (error) return { error: `Could not remove them: ${error.message}` };
  revalidatePath("/settings/members");
  return { notice: `Removed.${(keys as number) > 0 ? ` ${keys} API key${keys === 1 ? "" : "s"} they created ${keys === 1 ? "was" : "were"} revoked.` : ""}` };
}

export async function leaveWorkspace(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user, workspace, role } = await requireContext();
  if (role === "owner") return { error: "The owner cannot leave. Erase the workspace instead." };
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  const admin = await assertMembership(user.id, workspace.id);
  const { error } = await admin.rpc("remove_workspace_member", { p_ws: workspace.id, p_user: user.id, p_actor: user.id });
  if (error) return { error: `Could not leave: ${error.message}` };
  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// =================================================================== erasure

/**
 * Erases the active workspace — everything in it, for everyone in it — after the owner types
 * its name. The one way evidence leaves before its retention (0005); erasure_log records it.
 */
export async function eraseWorkspace(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user, workspace } = await requireContext();
  const gated = await gate(user.id, workspace.id, "workspace.erase");
  if ("error" in gated) return { error: gated.error };
  if (text(form, "confirmName", 120) !== workspace.name) return { error: `Type the workspace's name exactly — ${workspace.name} — to erase it.` };
  // Runs in flight are stopped first: erasure removes their rows, and a slice still writing
  // would be writing into nothing.
  await gated.admin.from("runs").update({ status: "aborted", finished_at: new Date().toISOString(), error: "Stopped: the workspace was erased." })
    .eq("workspace_id", workspace.id).in("status", ["queued", "running"]);
  const { error } = await gated.admin.rpc("erase_workspace", { target: workspace.id, requested_by: user.id });
  if (error) return { error: `Could not erase it: ${error.message}` };
  await recordAudit(gated.admin, { workspaceId: null, actorId: user.id, action: "workspace.erased", detail: { workspace: workspace.id } });
  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Deletes the person's account: the workspaces they own are erased (they were listed, and the
 * name typed), their memberships elsewhere end and their keys there are revoked, their profile,
 * conversations and memory go. The sign-in is then pseudonymised rather than deleted, so the
 * evidence they produced elsewhere stays attributed to an id that carries no personal data.
 */
export async function deleteAccount(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const ctx = await requireContext();
  if (text(form, "confirm", 40).toLowerCase() !== "delete my account") return { error: "Type “delete my account” to confirm." };
  const admin = serviceClient();
  for (const m of ctx.memberships.filter((x) => x.role === "owner")) {
    await admin.from("runs").update({ status: "aborted", finished_at: new Date().toISOString(), error: "Stopped: the workspace was erased." })
      .eq("workspace_id", m.workspace.id).in("status", ["queued", "running"]);
    const { error } = await admin.rpc("erase_workspace", { target: m.workspace.id, requested_by: ctx.user.id });
    if (error) return { error: `Could not erase ${m.workspace.name}: ${error.message}. Nothing else was changed.` };
  }
  const { error: accountError } = await admin.rpc("erase_account", { target: ctx.user.id });
  if (accountError) return { error: `Could not delete the account: ${accountError.message}` };
  // Product events name the person only by a salted hash the database cannot compute (0062).
  const hashed = actorHash(ctx.user.id);
  if (hashed) {
    const { error: eventsError } = await admin.rpc("erase_product_events_of_actor", { actor: hashed });
    if (eventsError) return { error: `Could not delete the account's usage counts: ${eventsError.message}` };
  }
  await recordAudit(admin, { workspaceId: null, actorId: ctx.user.id, action: "account.erased", detail: { workspaces_erased: ctx.memberships.filter((x) => x.role === "owner").length } });
  const { error: authError } = await admin.auth.admin.updateUserById(ctx.user.id, {
    email: `deleted-${ctx.user.id}@deleted.invalid`,
    password: randomBytes(32).toString("base64url"),
    user_metadata: {},
    ban_duration: "876000h",
  });
  if (authError) return { error: `Your data was erased, but the sign-in could not be closed: ${authError.message}. Write to support.` };
  await (await sessionClient()).auth.signOut();
  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
  redirect("/?account=deleted");
}

// ===================================================================== memory

export async function rememberPreference(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user, workspace, profile } = await requireContext();
  if (!profile.assistant_memory) return { error: "Turn on assistant memory first." };
  const key = String(form.get("key") ?? "");
  if (!isMemoryKey(key)) return { error: "Choose what to remember." };
  const scope = String(form.get("scope") ?? "personal");
  let admin = serviceClient();
  if (scope === "workspace") {
    const gated = await gate(user.id, workspace.id, "memory.workspace");
    if ("error" in gated) return { error: gated.error };
    admin = gated.admin;
  }
  const saved = await saveMemory(admin, { userId: user.id, workspaceId: scope === "workspace" ? workspace.id : null, key, value: String(form.get("value") ?? ""), source: "settings" });
  if ("error" in saved) return { error: saved.error };
  revalidatePath("/settings/profile");
  return { notice: "Remembered." };
}

export async function forgetMemory(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user, workspace } = await requireContext();
  const id = String(form.get("memoryId") ?? "");
  const admin = serviceClient();
  const { data: m } = await admin.from("assistant_memory").select("id, user_id, workspace_id, key").eq("id", id).maybeSingle();
  if (!m) return { error: "That memory is already gone." };
  // Personal memory: only its person. Workspace memory: its author, or a builder in that workspace.
  const mine = m.user_id === user.id;
  if (m.workspace_id) {
    if (m.workspace_id !== workspace.id) return { error: "Switch to that memory's workspace to delete it." };
    if (!mine) {
      const gated = await gate(user.id, workspace.id, "memory.workspace");
      if ("error" in gated) return { error: gated.error };
    }
  } else if (!mine) {
    return { error: "That memory is not yours." };
  }
  await admin.from("assistant_memory").delete().eq("id", id);
  await recordAudit(admin, { workspaceId: m.workspace_id as string | null, actorId: user.id, action: "memory.deleted", detail: { key: m.key } });
  revalidatePath("/settings/profile");
  return { notice: "Forgotten." };
}

export async function clearMemory(_prev: IdentityState, form: FormData): Promise<IdentityState> {
  const { user } = await requireContext();
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  const admin = serviceClient();
  const { data } = await admin.from("assistant_memory").delete().eq("user_id", user.id).is("workspace_id", null).select("id");
  await recordAudit(admin, { workspaceId: null, actorId: user.id, action: "memory.cleared", detail: { removed: data?.length ?? 0 } });
  revalidatePath("/settings/profile");
  return { notice: `Cleared ${data?.length ?? 0} personal ${data?.length === 1 ? "memory" : "memories"}.` };
}
