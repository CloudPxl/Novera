import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/session.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { ROLE_LABEL } from "@/lib/auth/permissions.ts";
import { Badge, Card } from "@/components/ui/primitives.tsx";
import { switchWorkspace } from "@/lib/workflow/identity.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { portfolio } from "@/lib/workspaces/portfolio.ts";
import { formatWhen } from "@/lib/format/when.ts";
import { PageHeader } from "@/components/ui/page.tsx";
import { NewWorkspaceForm } from "../settings/identity-forms.tsx";

export const metadata: Metadata = { title: "Workspaces · Novera" };
export const dynamic = "force-dynamic";

/**
 * Every workspace the person belongs to — for an agency, one per client — and what each one
 * needs, side by side. Read with the service role, but only for workspaces in the person's own
 * verified memberships; nothing here reaches a workspace they do not belong to.
 */
export default async function WorkspacesPage() {
  const ctx = await requireContext();
  const rows = await portfolio(serviceClient(), ctx.memberships);
  const agency = ctx.accountMode !== "personal";

  return (
    <main className="w-full pb-10 text-ink">
      <PageHeader
        eyebrow={agency ? "Portfolio" : "Workspaces"}
        title={agency ? "Clients" : "Your workspaces"}
        description={agency
          ? "One workspace per client keeps their agents, keys, retention and reports apart — and each report names that client. What needs review comes first."
          : "Each workspace has its own agents, keys, retention and reports."}
      />
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ membership: m, newest: run, summary: sum, agents: n, inFlight }) => {
          const current = m.workspace.id === ctx.workspace.id;
          return (
            <li key={m.workspace.id}>
              <Card className={`flex h-full flex-col p-4 ${current ? "border-ink" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{m.workspace.name}</p>
                    <p className="text-xs text-ink-faint">{ROLE_LABEL[m.role]} · {n} agent{n === 1 ? "" : "s"}{inFlight ? ` · ${inFlight} running` : ""}</p>
                  </div>
                  {current && <Badge tone="neutral">Open now</Badge>}
                </div>
                <div className="mt-4 text-sm">
                  {sum && run ? (
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={sum.tone}>{sum.stateLabel}</Badge>
                      {sum.band && sum.state !== "pass" && <span className="text-xs text-ink-soft">{sum.band}</span>}
                      <span className="text-xs text-ink-faint">{formatWhen(run.createdAt, ctx.profile, { date: true })}</span>
                    </p>
                  ) : (
                    <p className="text-ink-faint">No completed run yet</p>
                  )}
                  {sum?.counts && (sum.counts.failed > 0 || sum.counts.noVerdict > 0) && (
                    <p className="mt-1 text-xs text-ink-soft tnum">
                      {sum.counts.failed > 0 && <span className="text-fail-text">{sum.counts.failed} failed</span>}
                      {sum.counts.failed > 0 && sum.counts.noVerdict > 0 && " · "}
                      {sum.counts.noVerdict > 0 && <span className="text-warning-text">{sum.counts.noVerdict} without a verdict</span>}
                    </p>
                  )}
                </div>
                <form action={switchWorkspace} className="mt-auto flex flex-wrap gap-2 pt-4">
                  <input type="hidden" name="workspaceId" value={m.workspace.id} />
                  <input type="hidden" name="next" value={sum && sum.state !== "pass" ? "/review" : "/dashboard"} />
                  <SubmitButton size="sm" variant={current ? "secondary" : "primary"} pendingLabel="Opening…">
                    {sum && sum.state !== "pass" ? "Open its review queue" : current ? "Open dashboard" : "Open"}
                  </SubmitButton>
                </form>
              </Card>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="new-ws-heading" className="mt-10 max-w-xl">
        <h2 id="new-ws-heading" className="type-h2">{agency ? "Add a client" : "New workspace"}</h2>
        <Card className="mt-3 p-5"><NewWorkspaceForm agency={agency} /></Card>
        <p className="mt-2 text-xs text-ink-faint">The trial&apos;s three runs are yours across every workspace you own. A model key is connected per workspace, so each client can grade on its own key.</p>
      </section>
    </main>
  );
}
