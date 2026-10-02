import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { Badge, Card } from "@/components/ui/primitives.tsx";
import { switchWorkspace } from "@/lib/workflow/identity.ts";
import { AUDIT_LABEL, type AuditAction } from "@/lib/audit/record.ts";
import type { PortfolioRow } from "@/lib/workspaces/portfolio.ts";

/**
 * The honest answer to the onboarding channels question: Novera tests an agent over HTTP.
 * Shown only to someone who said their agent talks another way.
 */
export function ChannelNote({ channels }: { channels: string[] }) {
  const voice = channels.includes("voice"), email = channels.includes("email");
  if (!voice && !email) return null;
  return (
    <p role="note" className="mt-4 rounded-panel border border-info-border bg-info-surface px-4 py-3 text-sm leading-relaxed text-info-text">
      You said your agent works over {voice && email ? "voice and email" : voice ? "voice or phone" : "email"}. Novera sends scenarios to an HTTP
      endpoint, so it tests the text agent behind {voice && email ? "those channels" : "that channel"} if it has one.
      {voice ? " Calls themselves — speech, latency, interruptions — are not tested." : ""}{" "}
      <Link href="/docs/connecting-an-agent" className="font-medium underline underline-offset-2">Connecting an agent</Link>
    </p>
  );
}

/** Agency: the other clients, worst first, each one click from its review queue. */
export function ClientStrip({ rows, currentId, label }: { rows: PortfolioRow[]; currentId: string; label: string }) {
  const others = rows.filter((r) => r.membership.workspace.id !== currentId);
  if (!others.length) {
    return (
      <section aria-labelledby="clients-heading" className="mt-8 rounded-shell border border-dashed border-line-strong bg-surface/60 p-4">
        <h2 id="clients-heading" className="type-h3">One {label.toLowerCase().replace(/s$/, "")} so far</h2>
        <p className="mt-1 text-sm text-ink-soft">Add a workspace per client to keep their agents, keys, retention and reports apart.</p>
        <ButtonLink href="/workspaces" size="sm" variant="secondary" className="mt-3">Add a client</ButtonLink>
      </section>
    );
  }
  return (
    <section aria-labelledby="clients-heading" className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="clients-heading" className="type-h2">Other {label.toLowerCase()}</h2>
        <Link href="/workspaces" className="text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">All {rows.length} →</Link>
      </div>
      <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {others.slice(0, 4).map((r) => (
          <li key={r.membership.workspace.id}>
            <form action={switchWorkspace} className="h-full">
              <input type="hidden" name="workspaceId" value={r.membership.workspace.id} />
              <input type="hidden" name="next" value={r.summary && r.summary.state !== "pass" ? "/review" : "/dashboard"} />
              <button type="submit" className="novera-lift flex h-full w-full flex-col rounded-panel border border-line bg-surface p-3 text-left">
                <span className="truncate font-medium">{r.membership.workspace.name}</span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  {r.summary ? <Badge tone={r.summary.tone}>{r.summary.stateLabel}</Badge> : <span className="text-ink-faint">No completed run</span>}
                  {r.inFlight > 0 && <Badge tone="live" pulse>{r.inFlight} running</Badge>}
                </span>
                {r.summary?.counts && r.summary.counts.failed + r.summary.counts.noVerdict > 0 && (
                  <span className="mt-1 text-xs text-ink-soft tnum">{r.summary.counts.failed} failed · {r.summary.counts.noVerdict} without a verdict</span>
                )}
                <span className="mt-auto pt-2 text-xs font-medium text-ink-soft">{r.summary && r.summary.state !== "pass" ? "Open its review queue →" : "Open →"}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Enterprise: the governance view of this workspace, from stored rows. */
export function GovernancePanel({ events, retentionDays, rawReads, funding, canAudit }: {
  events: Array<{ id: string; action: string; created_at: string; who: string }>;
  retentionDays: number;
  rawReads: number;
  funding: string;
  canAudit: boolean;
}) {
  return (
    <section aria-labelledby="gov-heading" className="mt-8">
      <h2 id="gov-heading" className="type-h2">Governance</h2>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="type-h3">Recent changes to access</h3>
            {canAudit && <Link href="/settings/audit" className="text-xs font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Audit log →</Link>}
          </div>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">{canAudit ? "No membership, key, webhook or retention change recorded yet." : "The audit log is read by the owner, admins and auditors."}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span><span className="font-medium">{e.who}</span> {AUDIT_LABEL[e.action as AuditAction] ?? e.action}</span>
                  <span className="text-xs text-ink-faint tnum">{e.created_at.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="type-h3">Evidence controls</h3>
          <dl className="mt-2 space-y-2 text-sm">
            <div><dt className="text-xs text-ink-faint">Raw replies kept for</dt><dd className="font-medium tnum">{retentionDays} days</dd></div>
            <div><dt className="text-xs text-ink-faint">Replies read through API keys, last 30 days</dt><dd className="font-medium tnum">{rawReads}</dd></div>
            <div><dt className="text-xs text-ink-faint">Grading funded by</dt><dd className="font-medium">{funding}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-ink-faint">Single sign-on, SCIM and organization-wide administration are not available.</p>
        </Card>
      </div>
    </section>
  );
}
