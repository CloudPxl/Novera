import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { CONFIDENCE_WORDS, WHERE_TO_APPLY } from "@/lib/insight/fixes.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Disclosure, HealthLine, Metrics, PageHeader, Panel, Section, TabNav } from "@/components/ui/page.tsx";
import { Badge } from "@/components/ui/primitives.tsx";
import { cardText, insightCard, statusWords } from "@/lib/insight/card.ts";
import { CATEGORY_TITLE, insightSuite } from "@/lib/insight/suite.ts";
import { INDEPENDENCE_LABEL, independenceOf } from "@/lib/judge/independence.ts";
import type { InsightObservationRow, InsightScanRow, InsightTargetRow } from "@/lib/insight/types.ts";
import { CopySummary } from "../../../runs/[id]/copy-summary.tsx";
import { AbortScanForm, LiveScan } from "../../forms.tsx";
import { DecideFixForm, ProposeFixForm } from "../../followup-forms.tsx";

interface FixRow {
  id: string; observation_id: string; scenario_id: string; finding: string; evidence_quotes: string[]; root_cause: string;
  confidence: keyof typeof CONFIDENCE_WORDS; proposed_change: string; where_to_apply: keyof typeof WHERE_TO_APPLY;
  validation_plan: string; risks: string; does_not_prove: string; model: string; status: "proposed" | "accepted" | "rejected";
  decision_reason: string | null; decided_at: string | null; created_at: string;
}

export const metadata: Metadata = { title: "Insight scan · Novera", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TABS = ["progress", "card", "fixes"] as const;

function verdictTone(o: InsightObservationRow): "pass" | "fail" | "error" {
  return o.status === "pass" ? "pass" : o.status === "fail" ? "fail" : "error";
}

export default async function InsightScanPage({ params, searchParams }: { params: Promise<{ scanId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workspace, role } = await requireWorkspace();
  const { scanId } = await params;
  const requested = (await searchParams).tab ?? "";
  const tab = (TABS as readonly string[]).includes(requested) ? (requested as (typeof TABS)[number]) : "progress";
  const mayManage = can(role, "insight.manage");
  const db = await sessionClient();
  const { data: scanRow } = await db.from("insight_scans").select("*").eq("id", scanId).maybeSingle();
  if (!scanRow || scanRow.workspace_id !== workspace.id) notFound();
  const scan = scanRow as InsightScanRow;
  const [{ data: targetRow }, { data: obsRows }, { data: fixRows }] = await Promise.all([
    db.from("insight_targets").select("*").eq("id", scan.target_id).maybeSingle(),
    db.from("insight_observations").select("*").eq("scan_id", scanId).order("created_at"),
    db.from("insight_fix_suggestions").select("*").eq("scan_id", scanId).order("created_at", { ascending: false }),
  ]);
  const fixes = (fixRows ?? []) as FixRow[];
  const titleOf = (id: string) => {
    const category = suite?.cases.find((c) => c.id === id)?.category;
    return category && CATEGORY_TITLE[category] ? `${id} · ${CATEGORY_TITLE[category]}` : id;
  };
  if (!targetRow) notFound();
  const target = targetRow as InsightTargetRow;
  const observations = (obsRows ?? []) as InsightObservationRow[];
  const suite = insightSuite(scan.suite_key, scan.suite_version);
  const active = scan.status === "queued" || scan.status === "running";
  const byId = new Map(observations.map((o) => [o.scenario_id, o]));
  const nextId = scan.status === "running" ? scan.scenario_ids.find((id) => !byId.has(id)) ?? null : null;
  const card = suite ? insightCard({ target, scan, observations, suite }) : null;
  const robots = (scan.robots ?? {}) as { server?: { allowed?: boolean; reason?: string }; worker?: { allowed?: boolean; status?: number | null } };
  const page = (scan.page ?? {}) as { final_url?: string; title?: string | null; widget?: { vendor: string | null; selector_path: string; frame_origin: string | null } | null; consent_clicked?: boolean };

  return (
    <main className="w-full py-8 text-ink">
      <LiveScan active={active} />
      <PageHeader
        eyebrow="Insight scan · not a run, not a report"
        title={target.name}
        description={<>Started {scan.created_at.slice(0, 16).replace("T", " ")} UTC · {scan.suite_key} v{scan.suite_version}</>}
        back={{ href: `/insight/${target.id}`, label: target.name }}
      />
      <TabNav label="Scan sections" current={tab} tabs={[
        { key: "progress", label: "Progress", href: `/insight/scan/${scanId}` },
        { key: "card", label: "Insight card", href: `/insight/scan/${scanId}?tab=card` },
        { key: "fixes", label: "Fixes", href: `/insight/scan/${scanId}?tab=fixes`, count: fixes.length },
      ]} />

      {tab === "progress" && (
        <div className="mt-6 space-y-6">
          <HealthLine
            tone={scan.status === "graded" ? "pass" : scan.status === "error" ? "fail" : scan.status === "aborted" ? "neutral" : "info"}
            title={statusWords(scan)}
            detail={scan.error_detail ?? undefined}
          />
          {card && (
            <Metrics items={[
              { label: "Recorded", value: `${card.counts.recorded} of ${card.counts.declared}` },
              { label: "Passed · failed", value: `${card.counts.passed} · ${card.counts.failed}` },
              { label: "No result", value: card.counts.noResult, note: "Never a pass or a failure" },
            ]} />
          )}

          <Section title="Scenarios">
            <Panel>
              <ul className="divide-y divide-line" aria-label="Scenarios">
                {scan.scenario_ids.map((id) => {
                  const c = suite?.cases.find((x) => x.id === id);
                  const o = byId.get(id);
                  const graders = o?.judge_votes?.length ? independenceOf(o.judge_votes) : null;
                  return (
                    <li key={id} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="tnum font-medium">{id}</span>
                        <span className="min-w-0 flex-1 text-ink-soft">{c ? CATEGORY_TITLE[c.category] ?? c.category : "Unknown scenario"}</span>
                        {o ? (
                          <Badge tone={verdictTone(o)}>{o.status === "error" ? "no result" : o.status}</Badge>
                        ) : id === nextId ? (
                          <Badge tone="live" pulse>in progress</Badge>
                        ) : (
                          <span className="text-ink-faint">{active ? "waiting" : "not recorded"}</span>
                        )}
                      </div>
                      {o && (
                        <div className="mt-2">
                          <Disclosure summary="Evidence">
                            <dl className="space-y-2 text-sm">
                              <div><dt className="type-pill text-ink-faint">Prompt, as typed</dt><dd className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{o.prompt_text}</dd></div>
                              <div><dt className="type-pill text-ink-faint">Reply, as the widget displayed it (redacted)</dt><dd className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{o.response_text ?? "No reply arrived."}</dd></div>
                              {(o.rationale || o.error) && <div><dt className="type-pill text-ink-faint">{o.error ? "Why there is no verdict" : "Why"}</dt><dd className="mt-0.5">{o.error ?? o.rationale}</dd></div>}
                              <div>
                                <dt className="type-pill text-ink-faint">Settled by</dt>
                                <dd className="mt-0.5">
                                  {o.settled_by === "deterministic" ? "A rule in the scenario" : o.settled_by === "models"
                                    ? <>AI graders: {o.judge_votes.map((v) => v.model).join(", ")}{graders ? ` (${INDEPENDENCE_LABEL[graders]})` : ""}</>
                                    : "Not graded"}
                                </dd>
                              </div>
                              <div><dt className="type-pill text-ink-faint">Capture</dt><dd className="mt-0.5 text-ink-soft [overflow-wrap:anywhere]">
                                {o.capture.selector_path ?? "—"}{o.capture.partial ? " · cut off before it settled" : ""}{typeof o.capture.nav_ms === "number" ? ` · page ${o.capture.nav_ms} ms` : ""}
                              </dd></div>
                            </dl>
                          </Disclosure>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </Section>

          <Section title="What the worker saw">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <dt className="text-ink-soft">robots.txt</dt>
              <dd>{robots.server ? `${robots.server.allowed ? "Allowed" : "Refused"} at claim (${robots.server.reason ?? "no reason recorded"})` : "Not checked yet"}{robots.worker ? `; the worker's own check: ${robots.worker.allowed ? "allowed" : "refused"}` : ""}</dd>
              <dt className="text-ink-soft">Page</dt>
              <dd className="[overflow-wrap:anywhere]">{page.final_url ?? "Not reached yet"}{page.title ? ` · “${page.title}”` : ""}</dd>
              <dt className="text-ink-soft">Widget</dt>
              <dd className="[overflow-wrap:anywhere]">{page.widget ? `${page.widget.vendor ?? "Not a known vendor"} · ${page.widget.selector_path}${page.widget.frame_origin ? ` · in a frame from ${page.widget.frame_origin}` : ""}` : "Not found yet"}</dd>
              <dt className="text-ink-soft">Cookie banner</dt>
              <dd>{page.consent_clicked === undefined ? "—" : page.consent_clicked ? "Accepted once" : "None pressed"}</dd>
              <dt className="text-ink-soft">Worker</dt>
              <dd>{scan.claimed_by ?? "Not claimed yet"}</dd>
            </dl>
          </Section>

          {active && mayManage && (
            <Section title="Abort">
              <Panel className="max-w-xl p-5"><AbortScanForm scanId={scan.id} /></Panel>
            </Section>
          )}
        </div>
      )}

      {tab === "card" && (
        <div className="mt-6 space-y-6">
          {!card ? (
            <p className="text-sm text-ink-soft">This scan declares {scan.suite_key} v{scan.suite_version}, which this deployment does not know, so no card can be computed.</p>
          ) : (
            <>
              {active && <HealthLine tone="info" title="The scan is still running" detail="The card shows what is recorded so far." />}
              <Panel className="p-5">
                <p className="type-eyebrow text-ink-faint">Public demo insight{card.scanDate ? ` · ${card.scanDate}` : ""}</p>
                <h2 className="mt-1 text-xl font-semibold">{card.target.name}</h2>
                <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{card.target.url}</p>
                <p className="mt-4 text-sm">
                  {card.counts.recorded} of {card.counts.declared} scenarios recorded · {card.counts.passed} passed · {card.counts.failed} failed · {card.counts.noResult} no result
                </p>
                {card.strength && <p className="mt-2 text-sm"><span className="font-medium">Notable strength:</span> {card.strength.headline} ({card.strength.id})</p>}
                {card.concern && <p className="mt-1 text-sm"><span className="font-medium">Notable concern:</span> {card.concern.headline} ({card.concern.id})</p>}
                <ul className="mt-4 divide-y divide-line text-sm" aria-label="Scenarios on the card">
                  {card.scenarios.map((s) => (
                    <li key={s.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2">
                      <span className="tnum font-medium">{s.id}</span>
                      <span className="min-w-0 flex-1">{s.categoryTitle}</span>
                      <span>{s.verdictWords}{s.independence && s.independence !== "independent" ? " — not corroborated" : ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-ink-soft">{card.capturedBy}</p>
                <Disclosure summary="What was not tested, and the limitations">
                  <p className="type-pill text-ink-faint">Not tested</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">{card.notTested.map((t) => <li key={t}>{t}</li>)}</ul>
                  <p className="mt-3 type-pill text-ink-faint">Limitations</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">{card.limitations.map((t) => <li key={t}>{t}</li>)}</ul>
                </Disclosure>
                <p className="mt-4 rounded-control border border-line bg-ground/60 px-3 py-2 text-sm">{card.disclosure}</p>
              </Panel>
              <div className="flex flex-wrap items-center gap-3">
                <CopySummary text={cardText(card)} name="Insight card" />
                <span className="text-xs text-ink-faint">Plain text, for review. Nothing here is published or sent.</span>
              </div>
              <p className="text-xs text-ink-faint">
                Computed from the stored rows each time this page loads. <Link href="/bot" className="underline underline-offset-2">What the browser worker does</Link>.
              </p>
            </>
          )}
        </div>
      )}
      {tab === "fixes" && (
        <div className="mt-6 space-y-6">
          <p className="measure text-sm text-ink-soft">
            For each reply that failed, a model can suggest one change for the bot&rsquo;s owner to try. It sees only the reply, so the cause it names is a hypothesis;
            every quote is checked against the stored reply word for word before the suggestion is kept, and a person accepts or rejects it.
          </p>
          {observations.filter((o) => o.status === "fail").length === 0 ? (
            <p className="text-sm text-ink-soft">{scan.status === "graded" ? "No reply failed, so there is nothing to fix." : "Suggestions are offered once a reply has failed."}</p>
          ) : observations.filter((o) => o.status === "fail").map((o) => {
            const forThis = fixes.filter((f) => f.observation_id === o.id);
            const open = forThis.some((f) => f.status === "proposed");
            return (
              <Section key={o.id} title={titleOf(o.scenario_id)}>
                {forThis.map((f) => (
                  <Panel key={f.id} className="mb-3 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={f.status === "accepted" ? "pass" : f.status === "rejected" ? "neutral" : "live"}>{f.status === "proposed" ? "Waiting for a decision" : f.status === "accepted" ? "Accepted" : "Rejected"}</Badge>
                      <Badge tone="neutral">{CONFIDENCE_WORDS[f.confidence]}</Badge>
                      <span className="text-xs text-ink-faint">{f.model} · {f.created_at.slice(0, 10)}</span>
                    </div>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div><dt className="type-pill text-ink-faint">Finding</dt><dd className="text-ink">{f.finding}</dd></div>
                      {f.evidence_quotes.length > 0 && (
                        <div><dt className="type-pill text-ink-faint">From the reply, word for word</dt>
                          <dd><ul className="mt-1 space-y-1">{f.evidence_quotes.map((q) => <li key={q} className="border-l-2 border-line pl-2 text-ink-soft [overflow-wrap:anywhere]">{q}</li>)}</ul></dd></div>
                      )}
                      <div><dt className="type-pill text-ink-faint">Possible cause</dt><dd className="text-ink">{f.root_cause}</dd></div>
                      <div><dt className="type-pill text-ink-faint">Change to try · {WHERE_TO_APPLY[f.where_to_apply]}</dt><dd className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{f.proposed_change}</dd></div>
                      <div><dt className="type-pill text-ink-faint">How to check it worked</dt><dd className="text-ink">{f.validation_plan}</dd></div>
                      <div><dt className="type-pill text-ink-faint">Risks</dt><dd className="text-ink">{f.risks}</dd></div>
                    </dl>
                    <p className="mt-3 text-xs text-ink-faint">{f.does_not_prove}</p>
                    {f.decision_reason && <p className="mt-2 text-xs text-ink-soft">Reason: {f.decision_reason}</p>}
                    <div className="mt-3"><CopySummary text={[`${o.scenario_id}: ${f.finding}`, `Possible cause (${CONFIDENCE_WORDS[f.confidence].toLowerCase()}): ${f.root_cause}`, `Change to try (${WHERE_TO_APPLY[f.where_to_apply]}): ${f.proposed_change}`, `How to check it worked: ${f.validation_plan}`, `Risks: ${f.risks}`, f.does_not_prove].join("\n\n")} name="Suggestion" /></div>
                    {mayManage && f.status === "proposed" && <div className="mt-4"><DecideFixForm suggestionId={f.id} /></div>}
                  </Panel>
                ))}
                {mayManage && !open && <ProposeFixForm observationId={o.id} />}
              </Section>
            );
          })}
        </div>
      )}
    </main>
  );
}
