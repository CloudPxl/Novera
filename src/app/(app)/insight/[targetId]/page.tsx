import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { assertMembership, requireWorkspace } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Disclosure, HealthLine, PageHeader, Panel, Section, TabNav } from "@/components/ui/page.tsx";
import { Badge } from "@/components/ui/primitives.tsx";
import { CATEGORY_LABEL, FACT_KEYS, FACT_LABEL, parseFacts } from "@/lib/insight/classify.ts";
import { scanRefusal, workerNotice } from "@/lib/insight/gates.ts";
import { insightCard, statusWords } from "@/lib/insight/card.ts";
import { INSIGHT_SUITE, insightSuite } from "@/lib/insight/suite.ts";
import { compareScans, MOVEMENT_WORDS } from "@/lib/insight/compare.ts";
import { OUTCOMES, OUTREACH_KIND_LABEL, SENT_CHANNELS, type OutreachKind } from "@/lib/insight/outreach.ts";
import { attestationActor } from "@/lib/legal/attestation.ts";
import type { InsightObservationRow, InsightScanRow, InsightTargetRow } from "@/lib/insight/types.ts";
import { DoNotContactForm, QueueScanForm, ReclassifyForm } from "../forms.tsx";
import { DraftOutreachForm, HandoffForm, OutreachStepForm } from "../followup-forms.tsx";
import { CopySummary } from "../../runs/[id]/copy-summary.tsx";
import { CATEGORY_TONE } from "../tone.ts";

export const metadata: Metadata = { title: "Insight target · Novera", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TABS = ["overview", "scans", "outreach", "handoff"] as const;

interface OutreachRow {
  id: string; kind: OutreachKind; template_version: number; subject: string | null; body: string; status: string;
  created_at: string; approved_at: string | null; sent_recorded_at: string | null; sent_channel: string | null;
  outcome: string | null; outcome_recorded_at: string | null;
}
const STATUS_WORDS: Record<string, string> = { draft: "Draft", approved: "Approved, not yet sent", sent_recorded: "Sent (recorded)", outcome_recorded: "Outcome recorded" };
const options = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));
const NOTHING_OPENED = new Set(["robots_disallowed", "address_refused", "target_refused"]);

export default async function InsightTargetPage({ params, searchParams }: { params: Promise<{ targetId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { user, workspace, role } = await requireWorkspace();
  const { targetId } = await params;
  const requested = (await searchParams).tab ?? "";
  const tab = (TABS as readonly string[]).includes(requested) ? (requested as (typeof TABS)[number]) : "overview";
  // Every member reads; owners, admins and operators act (0082, 0085).
  const mayManage = can(role, "insight.manage");
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

  // The last two graded scans, compared scenario by scenario from their stored rows.
  const graded = scans.filter((s) => s.status === "graded").slice(0, 2);
  let comparison: ReturnType<typeof compareScans> | null = null;
  if (graded.length === 2) {
    const { data: full } = await db.from("insight_scans").select("*").in("id", graded.map((g) => g.id));
    const { data: obs } = await db.from("insight_observations").select("*").in("scan_id", graded.map((g) => g.id));
    const cardOf = (id: string) => {
      const scan = (full ?? []).find((r) => r.id === id) as InsightScanRow | undefined;
      const suite = scan ? insightSuite(scan.suite_key, scan.suite_version) : null;
      return scan && suite ? insightCard({ target, scan, suite, observations: ((obs ?? []) as InsightObservationRow[]).filter((o) => o.scan_id === id) }) : null;
    };
    const after = cardOf(graded[0].id);
    const before = cardOf(graded[1].id);
    if (before && after) comparison = compareScans(before, after);
  }

  const [{ data: draftRows }, { data: handoffRows }, { data: agentRows }] = await Promise.all([
    db.from("insight_outreach_drafts").select("id, kind, template_version, subject, body, status, created_at, approved_at, sent_recorded_at, sent_channel, outcome, outcome_recorded_at")
      .eq("target_id", targetId).order("created_at", { ascending: false }),
    db.from("insight_handoffs").select("id, agent_id, note, created_at").eq("target_id", targetId).order("created_at"),
    db.from("agents").select("id, name, archived_at").eq("workspace_id", workspace.id).is("archived_at", null).order("name"),
  ]);
  const drafts = (draftRows ?? []) as OutreachRow[];
  const handoffs = (handoffRows ?? []) as Array<{ id: string; agent_id: string; note: string | null; created_at: string }>;
  const agents = (agentRows ?? []) as Array<{ id: string; name: string }>;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "An archived agent";
  const anySent = drafts.some((d) => d.sent_recorded_at);
  const kinds: OutreachKind[] = target.do_not_contact ? []
    : target.category === "A" ? (scans.some((s) => s.status === "graded") ? ["email", "dm", ...(anySent ? ["follow_up" as const] : [])] : [])
    : target.category === "B" || target.category === "C" ? ["staging_offer"] : [];

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
        { key: "outreach", label: "Outreach", href: `/insight/${targetId}?tab=outreach`, count: drafts.length },
        { key: "handoff", label: "Handoff", href: `/insight/${targetId}?tab=handoff`, count: handoffs.length },
      ]} />

      {tab === "overview" && (
        <div className="mt-6 space-y-6">
          <Section title="Scan">
            {active ? (
              <HealthLine tone="info" title={statusWords(active)} detail={<Link href={`/insight/scan/${active.id}`} className="underline underline-offset-2">Follow the scan</Link>} />
            ) : refusal ? (
              <HealthLine tone={target.category === "A" && !target.do_not_contact ? "warning" : "neutral"} title="No scan can start now" detail={refusal} />
            ) : !mayManage ? (
              <HealthLine tone="neutral" title="Ready to scan" detail="An owner, admin or operator of this workspace can start it." />
            ) : (
              <Panel className="p-5">
                <QueueScanForm targetId={target.id} scenarios={INSIGHT_SUITE.cases.length} />
                {notice && <p className="mt-3 text-sm text-warning-text">{notice}</p>}
              </Panel>
            )}
          </Section>

          {comparison && (
            <Section title="Since the scan before">
              <Panel className="p-5">
                <p className="text-sm text-ink">{comparison.sentence}</p>
                <p className="mt-1 text-xs text-ink-faint">Scans of {comparison.beforeDate} and {comparison.afterDate}, compared from their stored verdicts.</p>
                <ul className="mt-3 divide-y divide-line" aria-label="Each scenario, before and after">
                  {comparison.rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                      <span className="tnum font-medium text-ink">{r.id}</span>
                      <span className="min-w-0 flex-1 text-ink-soft">{r.headline ?? ""}</span>
                      <Badge tone={r.movement === "resolved" || r.movement === "still_passing" ? "pass" : r.movement === "regressed" || r.movement === "still_failing" ? "fail" : "neutral"}>{MOVEMENT_WORDS[r.movement]}</Badge>
                    </li>
                  ))}
                </ul>
              </Panel>
            </Section>
          )}

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
            {!target.do_not_contact && mayManage && (
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
      {tab === "outreach" && (
        <div className="mt-6 space-y-6">
          <p className="measure text-sm text-ink-soft">
            A draft is written from a template and this target&rsquo;s computed card; it never quotes a reply. Novera does not send it: approve it, copy it, send it yourself, and record that you did.
            Every draft says who ran the test, that you are not affiliated with {target.name}, and how to opt out.
          </p>
          {target.do_not_contact ? (
            <HealthLine tone="neutral" title="Do not contact" detail="No draft is written for this target, and no draft can be approved or recorded as sent." />
          ) : mayManage && kinds.length > 0 ? (
            <Panel className="p-5"><DraftOutreachForm targetId={target.id} kinds={kinds.map((k) => ({ value: k, label: OUTREACH_KIND_LABEL[k] }))} /></Panel>
          ) : mayManage ? (
            <p className="text-sm text-ink-soft">{target.category === "A" ? "A note about a scan needs a graded scan first." : "A Category D bot is not contacted about tests."}</p>
          ) : null}
          {drafts.map((d) => (
            <Panel key={d.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{OUTREACH_KIND_LABEL[d.kind]}</span>
                <Badge tone={d.status === "draft" ? "neutral" : "pass"}>{STATUS_WORDS[d.status]}</Badge>
                <span className="text-xs text-ink-faint">Template v{d.template_version} · {d.created_at.slice(0, 10)}</span>
              </div>
              {d.subject && <p className="mt-3 text-sm text-ink"><span className="text-ink-faint">Subject: </span>{d.subject}</p>}
              <div className="mt-2 whitespace-pre-wrap rounded-control border border-line bg-ground/60 p-3 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{d.body}</div>
              <div className="mt-3 flex flex-wrap items-start gap-3">
                <CopySummary text={d.subject ? `Subject: ${d.subject}\n\n${d.body}` : d.body} name="Draft" />
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-ink-soft sm:grid-cols-[auto_minmax(0,1fr)]">
                {d.approved_at && <><dt>Approved</dt><dd>{d.approved_at.slice(0, 10)}</dd></>}
                {d.sent_recorded_at && <><dt>Sent</dt><dd>{d.sent_recorded_at.slice(0, 10)}{d.sent_channel ? `, by ${SENT_CHANNELS[d.sent_channel as keyof typeof SENT_CHANNELS] ?? d.sent_channel}` : ""}</dd></>}
                {d.outcome && <><dt>Outcome</dt><dd>{OUTCOMES[d.outcome as keyof typeof OUTCOMES] ?? d.outcome}</dd></>}
              </dl>
              {mayManage && !target.do_not_contact && d.status === "draft" && <div className="mt-4"><OutreachStepForm draftId={d.id} step="approve" /></div>}
              {mayManage && !target.do_not_contact && d.status === "approved" && <div className="mt-4"><OutreachStepForm draftId={d.id} step="sent" options={options(SENT_CHANNELS)} /></div>}
              {mayManage && d.status === "sent_recorded" && <div className="mt-4"><OutreachStepForm draftId={d.id} step="outcome" options={options(OUTCOMES)} /></div>}
            </Panel>
          ))}
        </div>
      )}

      {tab === "handoff" && (
        <div className="mt-6 space-y-6">
          <p className="measure text-sm text-ink-soft">
            {target.category === "A"
              ? "When the owner wants more than a public scan, connect a staging copy of their agent in Agents — with their authorisation attested there — and link it here. Its runs are ordinary runs, with sealed reports."
              : "This bot is never scanned on its public site. With its owner's authorisation, connect a staging copy in Agents, with the authorisation attested there, and link it here. That is how it is tested."}
          </p>
          {handoffs.length > 0 && (
            <Panel>
              <ul className="divide-y divide-line" aria-label="Linked agents">
                {handoffs.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm">
                    <Link href={`/agents/${h.agent_id}`} className="font-medium underline-offset-2 hover:underline">{agentName(h.agent_id)}</Link>
                    <span className="text-ink-soft">{h.note ?? ""}</span>
                    <span className="ml-auto text-xs text-ink-faint">Linked {h.created_at.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {mayManage && (agents.length > 0 ? (
            <Panel className="p-5"><HandoffForm targetId={target.id} agents={agents} /></Panel>
          ) : (
            <p className="text-sm text-ink-soft">No agent is connected in this workspace yet. <Link href="/agents/new" className="underline underline-offset-2">Connect one</Link>, then link it here.</p>
          ))}
        </div>
      )}
    </main>
  );
}
