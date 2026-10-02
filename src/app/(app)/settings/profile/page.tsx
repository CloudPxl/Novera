import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, assertMembership } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { Card } from "@/components/ui/primitives.tsx";
import { MEMORY_LABEL, type MemoryKey } from "@/lib/assistant/memory.ts";
import { SettingsNav } from "../nav.tsx";
import { AccountModeForm, ClearMemoryForm, DeleteAccountForm, ForgetButton, ProfileForm, RememberForm, ResetForm } from "../identity-forms.tsx";

export const metadata: Metadata = { title: "Your profile · Novera" };
export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { settings: "you typed it here", user_said: "you said it", approved_candidate: "you accepted a suggestion" };

/**
 * The person, separate from any workspace: preferences, account mode, assistant memory and
 * their own data. Every setting says what it changes; none is read by grading or reports.
 */
export default async function ProfilePage() {
  const ctx = await requireContext();
  const admin = await assertMembership(ctx.user.id, ctx.workspace.id);
  const wsIds = ctx.memberships.map((m) => m.workspace.id);
  const [{ data: agents }, { data: suites }, { data: memory }, { count: members }] = await Promise.all([
    admin.from("agents").select("id, name, workspace_id").in("workspace_id", wsIds).order("created_at"),
    admin.from("suites").select("key").is("workspace_id", null),
    admin.from("assistant_memory").select("id, key, value, source, workspace_id, created_at, expires_at")
      .or(`and(user_id.eq.${ctx.user.id},workspace_id.is.null),workspace_id.eq.${ctx.workspace.id}`).order("created_at", { ascending: false }),
    admin.from("workspace_members").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id),
  ]);
  const wsName = new Map(ctx.memberships.map((m) => [m.workspace.id, m.workspace.name]));
  const owned = ctx.memberships.filter((m) => m.role === "owner").map((m) => m.workspace.name);

  return (
    <main className="w-full max-w-4xl py-8 text-ink">
      <SettingsNav current="profile" role={ctx.role} mode={ctx.accountMode} members={members ?? 1} workspace={ctx.workspace.name} />

      <section aria-labelledby="mode-heading" className="mt-8">
        <h2 id="mode-heading" className="type-h2">How you use Novera</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">Decides which screens and words you see. Every mode has the same evidence rules, isolation and sealing.</p>
        <Card className="mt-3 p-5"><AccountModeForm mode={ctx.accountMode} /></Card>
      </section>

      <section aria-labelledby="prefs-heading" className="mt-10">
        <h2 id="prefs-heading" className="type-h2">Preferences</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          What is stored: your name, title, company, timezone, date format, motion and the defaults below. Used only to
          show Novera to you. Never read by grading, suites, policies or reports, and never put in a report.
        </p>
        <Card className="mt-3 p-5">
          <ProfileForm
            profile={ctx.profile}
            workspaces={ctx.memberships.map((m) => m.workspace)}
            agents={(agents ?? []).map((a) => ({ id: a.id as string, name: a.name as string, workspace: wsName.get(a.workspace_id as string) ?? "" }))}
            suites={[...new Set((suites ?? []).map((s) => s.key as string))].sort()}
          />
        </Card>
      </section>

      <section aria-labelledby="memory-heading" className="mt-10">
        <h2 id="memory-heading" className="type-h2">What Ask Novera remembers</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          {ctx.profile.assistant_memory
            ? "Only what is listed here, and only because someone chose to keep it. Personal memory follows you; workspace memory is shared with this workspace's members. It shapes answers — never a policy, a verdict or a report."
            : "Memory is off, so Ask Novera remembers nothing between conversations. Turn it on under Preferences."}
        </p>
        <Card className="mt-3 p-5">
          {(memory ?? []).length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing remembered.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(memory ?? []).map((m) => (
                <li key={m.id as string} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm"><span className="font-medium">{MEMORY_LABEL[m.key as MemoryKey]}:</span> {m.value as string}</p>
                    <p className="text-xs text-ink-faint">
                      {m.workspace_id ? `Shared in ${wsName.get(m.workspace_id as string) ?? "this workspace"}` : "Personal"} · {SOURCE[m.source as string] ?? m.source} · {(m.created_at as string).slice(0, 10)}
                      {m.expires_at ? ` · expires ${(m.expires_at as string).slice(0, 10)}` : ""}
                    </p>
                  </div>
                  <ForgetButton id={m.id as string} label={MEMORY_LABEL[m.key as MemoryKey]} />
                </li>
              ))}
            </ul>
          )}
          {ctx.profile.assistant_memory && (
            <div className="mt-5 space-y-5 border-t border-line pt-5">
              <RememberForm canShare={can(ctx.role, "memory.workspace") && ctx.accountMode !== "personal"} />
              <ClearMemoryForm />
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="data-heading" className="mt-10">
        <h2 id="data-heading" className="type-h2">Your data</h2>
        <Card className="mt-3 divide-y divide-line p-0">
          <div className="p-5">
            <h3 className="type-h3">Export</h3>
            <p className="mt-1 text-sm text-ink-soft">Your profile, memberships, memory, conversations and your own audit events, as JSON. Workspace evidence is exported per report.</p>
            <a href="/api/me/export" className="mt-3 inline-flex rounded-control border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-sunken" download>Download my data</a>
          </div>
          <div className="p-5"><h3 className="type-h3">Reset</h3><div className="mt-2"><ResetForm /></div></div>
          <div className="p-5">
            <h3 className="type-h3 text-fail-text">Delete my account</h3>
            <div className="mt-2"><DeleteAccountForm owned={owned} /></div>
          </div>
        </Card>
        <p className="mt-3 text-xs text-ink-faint">
          <Link href="/docs/data-and-privacy" className="underline underline-offset-2 hover:text-ink">Data and privacy</Link> says what is kept and for how long.
        </p>
      </section>
    </main>
  );
}
