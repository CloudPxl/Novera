import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff.ts";
import { assertMembership, requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Disclosure, HealthLine, PageHeader, Panel, Section, TabNav } from "@/components/ui/page.tsx";
import { Badge } from "@/components/ui/primitives.tsx";
import { CATEGORY_LABEL, FACT_KEYS, FACT_LABEL, parseFacts } from "@/lib/insight/classify.ts";
import { scanRefusal, workerNotice } from "@/lib/insight/gates.ts";
import { statusWords } from "@/lib/insight/card.ts";
import { INSIGHT_SUITE } from "@/lib/insight/suite.ts";
import { attestationActor } from "@/lib/legal/attestation.ts";
import type { InsightScanRow, InsightTargetRow } from "@/lib/insight/types.ts";
import { DoNotContactForm, QueueScanForm, ReclassifyForm } from "../forms.tsx";
import { CATEGORY_TONE } from "../tone.ts";

export const metadata: Metadata = { title: "Insight target · Novera", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TABS = ["overview", "scans"] as const;
const NOTHING_OPENED = new Set(["robots_disallowed", "address_refused", "target_refused"]);

export default async function InsightTargetPage({ params, searchParams }: { params: Promise<{ targetId: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireStaff();
  const { targetId } = await params;
  const requested = (await searchParams).tab ?? "";
  const tab = (TABS as readonly string[]).includes(requested) ? (requested as (typeof TABS)[number]) : "overview";
  const { user, workspace } = await requireWorkspace();
  const db = await sessionClient();
  const { data: row } = await db.from("insight_targets").select("*").eq("id", targetId).maybeSingle();
  if (!row || row.workspace_id !== workspace.id) notFound();
  const target = row as InsightTargetRow;
  const { data: scanRows } = await db.from("insight_scans")
    .select("id, status, error_kind, aborted_reason, created_at, finished_at, turns_recorded, scenario_ids, claimed_by")
    .eq("target_id", targetId).order("created_at", { ascending: false }).limit(50);
  const scans = (scanRows ?? []) as Array<Pick<InsightScanRow, "id" | "status" | "error_kind" | "aborted_reason" | "created_at" | "finished_at" | "turns_recorded" | "scenario_ids" | "claimed_by">>;

  // Which worker was last seen is service-role only (0082); read through the membership-checked client.
  const admin = await assertMembership(user.id, workspace.id);
  const { data: workers } = await admin.from("insight_workers").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1);
  const now = new Date();
  const active = scans.find((s) => s.status === "queued" || s.status === "running") ?? null;
  const counted = scans.find((s) => s.claimed_by && !(s.error_kind && NOTHING_OPENED.has(s.error_kind)));
  const refusal = scanRefusal({ category: target.category, doNotContact: target.do_not_contact, activeScan: Boolean(active), lastScanAt: counted?.created_at ?? null, now });
  const notice = workerNotice((workers?.[0]?.last_seen_at as string | undefined) ?? null, now);
  const facts = parseFacts(target.facts);

  return (
    <main className="w-full py-8 text-ink">
      <PageHeader
        eyebrow="Insight target"
        title={target.name}
        description={<span className="[overflow-wrap:anywhere]">{target.demo_url}</span>}
        status={<span className="flex flex-wrap gap-2"><Badge tone={CATEGORY_TONE[target.category]}>Category {target.category}</Badge>{target.do_not_contact && <Badge tone="neutral">Do not contact</Badge>}</span>}
        back={{ href: "/insight", label: "Insight scans" }}
      />
      <TabNav label="Target sections" current={tab} tabs={[
        { key: "overview", label: "Overview", href: `/insight/${targetId}` },
        { key: "scans", label: "Scans", href: `/insight/${targetId}?tab=scans`, count: scans.length },
      ]} />

      {tab === "overview" && (
        <div className="mt-6 space-y-6">
          <Section title="Scan">
            {active ? (
              <HealthLine tone="info" title={statusWords(active)} detail={<Link href={`/insight/scan/${active.id}`} className="underline underline-offset-2">Follow the scan</Link>} />
            ) : refusal ? (
              <HealthLine tone={target.category === "A" && !target.do_not_contact ? "warning" : "neutral"} title="No scan can start now" detail={refusal} />
            ) : (
              <Panel className="p-5">
                <QueueScanForm targetId={target.id} scenarios={INSIGHT_SUITE.cases.length} />
                {notice && <p className="mt-3 text-sm text-warning-text">{notice}</p>}
              </Panel>
            )}
          </Section>

          <Section title="Classification">
            <Panel className="p-5">
              <p className="text-sm text-ink">{CATEGORY_LABEL[target.category]}</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">{target.category_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                {FACT_KEYS.map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-soft">{FACT_LABEL[k]}</dt>
                    <dd className="font-medium">{facts[k] ? "Yes" : "No"}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-ink-faint">
                Authorisation basis: a public demo the company offers to anyone, recorded by {attestationActor(target.authorised_by, target.authorised_by_role as never)} on {target.created_at.slice(0, 10)}. Not the company&rsquo;s consent.
              </p>
            </Panel>
            {!target.do_not_contact && (
              <div className="mt-3 space-y-3">
                <Disclosure summary="Change the recorded facts">
                  <ReclassifyForm targetId={target.id} facts={facts} />
                </Disclosure>
                <Disclosure summary="Mark do not contact" tone="danger">
                  <DoNotContactForm targetId={target.id} />
                </Disclosure>
              </div>
            )}
          </Section>

          {target.notes && (
            <Section title="Notes">
              <p className="measure whitespace-pre-wrap text-sm text-ink-soft">{target.notes}</p>
            </Section>
          )}
        </div>
      )}

      {tab === "scans" && (
        <div className="mt-6">
          {scans.length === 0 ? (
            <p className="text-sm text-ink-soft">No scan yet.</p>
          ) : (
            <Panel>
              <ul className="divide-y divide-line" aria-label="Scans">
                {scans.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                    <Link href={`/insight/scan/${s.id}`} className="font-medium underline-offset-2 hover:underline">{s.created_at.slice(0, 16).replace("T", " ")} UTC</Link>
                    <span className="text-ink-soft">{s.turns_recorded} of {s.scenario_ids.length} recorded</span>
                    <span className="ml-auto text-ink-soft">{statusWords(s)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </main>
  );
}
