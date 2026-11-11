import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff.ts";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { PageHeader, Panel } from "@/components/ui/page.tsx";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { statusWords } from "@/lib/insight/card.ts";
import type { InsightScanRow, InsightTargetRow } from "@/lib/insight/types.ts";
import { CATEGORY_TONE } from "./tone.ts";

export const metadata: Metadata = { title: "Insight scans · Novera", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Public demo bots recorded in this workspace, and their latest scan. Staff only. */
export default async function InsightPage() {
  await requireStaff();
  const { workspace } = await requireWorkspace();
  const db = await sessionClient();
  const { data: targets } = await db.from("insight_targets")
    .select("id, name, demo_url, category, do_not_contact, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(200);
  const ids = (targets ?? []).map((t) => t.id as string);
  const { data: scans } = ids.length
    ? await db.from("insight_scans").select("id, target_id, status, error_kind, aborted_reason, created_at").in("target_id", ids).order("created_at", { ascending: false })
    : { data: [] };
  const latest = new Map<string, Pick<InsightScanRow, "id" | "status" | "error_kind" | "aborted_reason" | "created_at">>();
  for (const s of (scans ?? []) as Array<Pick<InsightScanRow, "id" | "target_id" | "status" | "error_kind" | "aborted_reason" | "created_at">>) {
    if (!latest.has(s.target_id)) latest.set(s.target_id, s);
  }
  const rows = (targets ?? []) as Array<Pick<InsightTargetRow, "id" | "name" | "demo_url" | "category" | "do_not_contact" | "created_at">>;

  return (
    <main className="w-full py-8 text-ink">
      <PageHeader
        eyebrow="Staff"
        title="Insight scans"
        description="Public demo bots, classified from what they can reach. Only a category A target is scanned, by Novera's browser worker, and a scan is never a run or a report."
        action={<ButtonLink href="/insight/new">Add a public demo bot</ButtonLink>}
      />
      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No targets yet" action={<ButtonLink href="/insight/new" variant="secondary">Add a public demo bot</ButtonLink>}>
            Add a company&rsquo;s public demo chatbot to see how it is classified, then scan it.
          </EmptyState>
        </div>
      ) : (
        <Panel className="mt-6">
          <ul className="divide-y divide-line" aria-label="Targets">
            {rows.map((t) => {
              const scan = latest.get(t.id);
              let host = t.demo_url;
              try { host = new URL(t.demo_url).host; } catch { /* stored as entered */ }
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <Link href={`/insight/${t.id}`} className="min-w-0 font-medium underline-offset-2 [overflow-wrap:anywhere] hover:underline">{t.name}</Link>
                  <span className="min-w-0 text-sm text-ink-faint [overflow-wrap:anywhere]">{host}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <Badge tone={CATEGORY_TONE[t.category]}>Category {t.category}</Badge>
                    {t.do_not_contact && <Badge tone="neutral">Do not contact</Badge>}
                    {scan ? (
                      <Link href={`/insight/scan/${scan.id}`} className="text-sm text-ink-soft underline-offset-2 hover:underline">
                        {scan.status} · {scan.created_at.slice(0, 10)}
                      </Link>
                    ) : (
                      <span className="text-sm text-ink-faint">Not scanned</span>
                    )}
                  </span>
                  {scan && (scan.status === "error" || scan.status === "aborted") && (
                    <span className="basis-full text-xs text-ink-soft">{statusWords(scan)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </main>
  );
}
