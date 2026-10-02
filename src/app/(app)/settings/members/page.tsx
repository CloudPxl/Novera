import type { Metadata } from "next";
import { requireContext, assertMembership } from "@/lib/auth/session.ts";
import { can, canManageMember, GRANTABLE_ROLES, ROLE_DESCRIPTION, ROLE_LABEL, ROLES, isRole, type Role } from "@/lib/auth/permissions.ts";
import { Badge, Card } from "@/components/ui/primitives.tsx";
import { SettingsNav } from "../nav.tsx";
import { InviteForm, LeaveWorkspaceForm, MemberControls, RevokeInvitationButton } from "../identity-forms.tsx";

/** Read outside render: whether an invitation has not yet expired. */
function stillOpen(expiresAt: string): boolean {
  return Date.parse(expiresAt) > Date.now();
}

export const metadata: Metadata = { title: "Members · Novera" };
export const dynamic = "force-dynamic";

/**
 * Who is in this workspace and what each may do. Changes take effect on the member's next
 * request: every action re-reads the role from the database (src/lib/auth/session.ts).
 */
export default async function MembersPage() {
  const ctx = await requireContext();
  const admin = await assertMembership(ctx.user.id, ctx.workspace.id);
  const [{ data: rows }, { data: invites }] = await Promise.all([
    admin.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", ctx.workspace.id).order("created_at"),
    can(ctx.role, "member.invite")
      ? admin.from("workspace_invitations").select("id, email, role, created_at, expires_at, accepted_at, revoked_at")
        .eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: null }),
  ]);
  const ids = (rows ?? []).map((r) => r.user_id as string);
  const [{ data: profiles }, users] = await Promise.all([
    admin.from("user_profiles").select("user_id, display_name, job_title").in("user_id", ids),
    Promise.all(ids.map((id) => admin.auth.admin.getUserById(id).then((r) => r.data.user))),
  ]);
  const email = new Map(users.filter(Boolean).map((u) => [u!.id, u!.email ?? ""]));
  const profile = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const open = (invites ?? []).filter((i) => !i.accepted_at && !i.revoked_at && stillOpen(i.expires_at as string));
  const closed = (invites ?? []).filter((i) => !open.includes(i)).slice(0, 10);
  const grantable = GRANTABLE_ROLES.filter((r) => canManageMember(ctx.role, "auditor", r));

  return (
    <main className="w-full max-w-4xl py-8 text-ink">
      <SettingsNav current="members" role={ctx.role} mode={ctx.accountMode} members={ids.length} workspace={ctx.workspace.name} />

      <section aria-labelledby="members-heading" className="mt-8">
        <h2 id="members-heading" className="type-h2">Members · {ids.length}</h2>
        <Card className="mt-3 p-0">
          <ul className="divide-y divide-line">
            {(rows ?? []).map((r) => {
              const id = r.user_id as string;
              const role = (isRole(r.role) ? r.role : "auditor") as Role;
              const p = profile.get(id);
              const name = (p?.display_name as string | null) ?? email.get(id) ?? "Unknown";
              const manageable = id !== ctx.user.id && can(ctx.role, "member.manage") && canManageMember(ctx.role, role);
              const options = ROLES.filter((x) => x !== "owner" && canManageMember(ctx.role, role, x));
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {name}{id === ctx.user.id && <span className="text-xs font-normal text-ink-faint">(you)</span>}
                      <Badge tone={role === "owner" ? "pass" : "neutral"}>{ROLE_LABEL[role]}</Badge>
                    </p>
                    <p className="text-xs text-ink-faint">{p?.display_name ? `${email.get(id) ?? ""} · ` : ""}joined {(r.created_at as string).slice(0, 10)}</p>
                  </div>
                  {manageable && <MemberControls userId={id} role={role} options={options} name={name} />}
                </li>
              );
            })}
          </ul>
        </Card>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">What each role can do</summary>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r} className="rounded-control border border-line bg-surface px-3 py-2">
                <dt className="font-medium">{ROLE_LABEL[r]}</dt>
                <dd className="text-xs leading-relaxed text-ink-soft">{ROLE_DESCRIPTION[r]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-ink-faint">Clients do not need an account: they receive the sealed report through its expiring, revocable link.</p>
        </details>
      </section>

      {can(ctx.role, "member.invite") && (
        <section aria-labelledby="invite-heading" className="mt-10">
          <h2 id="invite-heading" className="type-h2">Invite someone</h2>
          <Card className="mt-3 p-5"><InviteForm grantable={grantable} /></Card>
          {(open.length > 0 || closed.length > 0) && (
            <Card className="mt-3 p-0">
              <ul className="divide-y divide-line">
                {[...open, ...closed].map((i) => {
                  const state = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : !stillOpen(i.expires_at as string) ? "expired" : "open";
                  return (
                    <li key={i.id as string} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="break-all font-medium">{i.email as string}</p>
                        <p className="text-xs text-ink-faint">{ROLE_LABEL[i.role as Role]} · sent {(i.created_at as string).slice(0, 10)} · {state === "open" ? `expires ${(i.expires_at as string).slice(0, 10)}` : state}</p>
                      </div>
                      {state === "open" ? <RevokeInvitationButton id={i.id as string} /> : <Badge tone="neutral">{state}</Badge>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>
      )}

      {ctx.role !== "owner" && (
        <section aria-labelledby="leave-heading" className="mt-10">
          <h2 id="leave-heading" className="type-h2">Leave</h2>
          <Card className="mt-3 p-5"><LeaveWorkspaceForm name={ctx.workspace.name} /></Card>
        </section>
      )}
    </main>
  );
}
