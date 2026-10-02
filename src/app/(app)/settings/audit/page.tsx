import type { Metadata } from "next";
import { requireContext, assertMembership } from "@/lib/auth/session.ts";
import { can, ROLE_LABEL, isRole } from "@/lib/auth/permissions.ts";
import { AUDIT_LABEL, type AuditAction } from "@/lib/audit/record.ts";
import { Card, EmptyState } from "@/components/ui/primitives.tsx";
import { formatWhen } from "@/lib/format/when.ts";
import { SettingsNav } from "../nav.tsx";

export const metadata: Metadata = { title: "Audit log · Novera" };
export const dynamic = "force-dynamic";

/**
 * Who changed who may do what in this workspace — membership, roles, keys, webhooks,
 * retention, report withdrawal, shared memory. Append-only (0054). Evidence has its own
 * attribution on every row; this is the trail around it.
 */
export default async function AuditPage() {
  const ctx = await requireContext();
  if (!can(ctx.role, "audit.view")) {
    return (
      <main className="w-full max-w-4xl py-8 text-ink">
        <SettingsNav current="audit" role={ctx.role} mode={ctx.accountMode} members={2} workspace={ctx.workspace.name} />
        <div className="mt-8"><EmptyState title="Not for your role">The audit log is read by the owner, admins and auditors.</EmptyState></div>
      </main>
    );
  }
  const admin = await assertMembership(ctx.user.id, ctx.workspace.id, "audit.view");
  const [{ data: events }, { data: members }, { count }] = await Promise.all([
    admin.from("audit_events").select("id, actor_id, subject_user_id, action, detail, created_at")
      .eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(200),
    admin.from("workspace_members").select("user_id").eq("workspace_id", ctx.workspace.id),
    admin.from("workspace_members").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id),
  ]);
  const people = new Set([...(events ?? []).flatMap((e) => [e.actor_id, e.subject_user_id]), ...(members ?? []).map((m) => m.user_id)].filter(Boolean) as string[]);
  const [{ data: profiles }, users] = await Promise.all([
    admin.from("user_profiles").select("user_id, display_name").in("user_id", [...people]),
    Promise.all([...people].map((id) => admin.auth.admin.getUserById(id).then((r) => r.data.user).catch(() => null))),
  ]);
  const who = new Map<string, string>();
  for (const u of users) if (u) who.set(u.id, u.email?.endsWith("@deleted.invalid") ? "a deleted account" : u.email ?? "");
  for (const p of profiles ?? []) if (p.display_name) who.set(p.user_id as string, p.display_name as string);
  const name = (id: unknown) => (typeof id === "string" ? who.get(id) ?? "a former member" : "Novera");

  const describe = (d: Record<string, unknown>) => {
    const parts: string[] = [];
    if (typeof d.from === "string" && typeof d.to === "string") parts.push(`${isRole(d.from) ? ROLE_LABEL[d.from] : d.from} → ${isRole(d.to) ? ROLE_LABEL[d.to] : d.to}`);
    else if (typeof d.role === "string") parts.push(isRole(d.role) ? ROLE_LABEL[d.role] : d.role);
    if (typeof d.keys_revoked === "number" && d.keys_revoked > 0) parts.push(`${d.keys_revoked} key(s) revoked`);
    if (typeof d.key === "string") parts.push(d.key);
    if (typeof d.days === "number") parts.push(`${d.days} days`);
    return parts.join(" · ");
  };

  return (
    <main className="w-full max-w-4xl py-8 text-ink">
      <SettingsNav current="audit" role={ctx.role} mode={ctx.accountMode} members={count ?? 1} workspace={ctx.workspace.name} />
      <p className="mt-6 max-w-2xl text-sm text-ink-soft">
        Every change to who may do what here, newest first. Nobody can edit or delete a line; the log leaves only with the
        workspace. Times in {ctx.profile.timezone}.
      </p>
      {(events ?? []).length === 0 ? (
        <div className="mt-4"><EmptyState title="Nothing recorded yet">Invitations, role changes, keys, webhooks, retention and withdrawals appear here as they happen.</EmptyState></div>
      ) : (
        <Card className="mt-4 p-0">
          <ol className="divide-y divide-line">
            {(events ?? []).map((e) => (
              <li key={e.id as string} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
                <span className="tnum text-xs text-ink-faint">{formatWhen(e.created_at as string, ctx.profile)}</span>
                <span>
                  <span className="font-medium">{name(e.actor_id)}</span> {AUDIT_LABEL[e.action as AuditAction] ?? e.action}
                  {e.subject_user_id && e.subject_user_id !== e.actor_id ? <> — {name(e.subject_user_id)}</> : null}
                  {describe(e.detail as Record<string, unknown>) && <span className="text-ink-soft"> · {describe(e.detail as Record<string, unknown>)}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </main>
  );
}
