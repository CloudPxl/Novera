import type { Metadata } from "next";
import { instructionShapedSentences } from "@/lib/builder/extract.ts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { PageHeader, Section, TabNav, Disclosure, Panel, Rows, Metrics } from "@/components/ui/page.tsx";
import { Badge } from "@/components/ui/primitives.tsx";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { describeCheck } from "@/lib/judge/checks.ts";
import { packByKey, labelOf } from "@/lib/builder/packs.ts";
import { partsOf } from "@/lib/builder/sources.ts";
import { buildCoverage, bulkEligible, type CandidateRow, type ObligationRow } from "@/lib/builder/coverage.ts";
import { documentRoute, providerName } from "@/lib/builder/routing.ts";
import { ACKNOWLEDGEMENT } from "@/lib/builder/constants.ts";
import { connectionsFromEnv } from "@/lib/providers/registry.ts";
import { formatWhen } from "@/lib/format/when.ts";
import type { AgentConfig } from "@/lib/agents/types.ts";
import type { SuiteCase } from "@/lib/runner/types.ts";
import {
  SourceForm, ExtractButton, PolicyFromSource, ObserveForm, DecideForm, EditForm, AnswerForm,
  BulkApproveForm, AttachProductionForm, ScanForm, PublishForm, AbandonForm,
} from "../forms.tsx";

export const metadata: Metadata = { title: "Suite Builder · Novera" };
export const dynamic = "force-dynamic";

type Step = "sources" | "review" | "coverage" | "publish";
type View = "decide" | "approved" | "closed" | "all";

interface Candidate extends CandidateRow {
  review_note: string | null;
  source_quote: string | null;
  source_id: string | null;
  model: string | null;
  rejection_reason: string | null;
  not_applicable_reason: string | null;
  approval_group: string | null;
  approved_by: string | null; approved_at: string | null;
  rejected_by: string | null; rejected_at: string | null;
  not_applicable_by: string | null; not_applicable_at: string | null;
  suite_sources: { title: string; kind: string } | null;
}

interface Obligation extends ObligationRow {
  source_id: string;
  passage: string;
  locator: string | null;
  interpretation: string;
  question: string | null;
  suggested_answers: Array<{ answer: string; citation: string }>;
  flags: Array<{ kind: string; note: string }>;
  answer: string | null;
  not_applicable_reason: string | null;
  model: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "to decide", needs_review: "needs an answer", approved: "approved", rejected: "rejected", not_applicable: "not applicable", included: "in the suite",
};
const STATUS_TONE = { draft: "neutral", needs_review: "medium", approved: "pass", rejected: "neutral", not_applicable: "neutral", included: "pass" } as const;

/** An ISO time a few minutes back; outside the component, which renders from data only. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function originLabel(c: Candidate): string {
  const ref = c.source_ref as { pack_key?: string; case_id?: string; edited?: boolean } | null;
  const edited = c.edited_from ? " · edited" : "";
  switch (c.origin) {
    case "pack": return `Baseline · ${packByKey(ref?.pack_key ?? "")?.title ?? ref?.pack_key} ${ref?.case_id ?? ""}${edited}`;
    case "document": return `Your document · ${c.suite_sources?.title ?? "source"}${edited}`;
    case "discovery": return `Observed in your agent${edited}`;
    case "production": return `Production failure${edited}`;
    case "policy": return `Policy version${edited}`;
    default: return `Imported${edited}`;
  }
}

export default async function BuildPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; view?: string; edit?: string; grouped?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, workspace, role, context } = await requireWorkspace();
  const admin = await assertMembership(user.id, workspace.id);

  const { data: build } = await admin.from("suite_builds")
    .select("*, suites!suite_builds_published_suite_id_fkey(id, key, version, cases)")
    .eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!build) notFound();

  const [{ data: candidates }, { data: obligations }, { data: sources }, { data: agents }, { count: waitingProduction }, { data: scans }] = await Promise.all([
    admin.from("scenario_drafts")
      .select("id, origin, status, scenario, conflicts, obligation_id, source_ref, edited_from, destructive, review_note, source_quote, source_id, model, rejection_reason, not_applicable_reason, approval_group, approved_by, approved_at, rejected_by, rejected_at, not_applicable_by, not_applicable_at, suite_sources(title, kind)")
      .eq("workspace_id", workspace.id).eq("build_id", id).order("created_at"),
    admin.from("suite_obligations").select("*").eq("workspace_id", workspace.id).eq("build_id", id).order("created_at"),
    admin.from("suite_sources").select("id, kind, title, locator, status, parse_error, text, original_sha256, redaction, retrieval, extracted_parts, content_expired_at, created_at")
      .eq("workspace_id", workspace.id).eq("build_id", id).order("created_at"),
    admin.from("agents").select("id, name, config").eq("workspace_id", workspace.id).order("created_at"),
    admin.from("scenario_drafts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id)
      .eq("origin", "production").is("build_id", null).in("status", ["draft", "needs_review"]),
    admin.from("suites").select("id, version, created_at").eq("workspace_id", workspace.id).eq("approval", "exploratory")
      .eq("provenance->>build_id", id).order("version", { ascending: false }),
  ]);
  const scanIds = (scans ?? []).map((s) => s.id as string);
  const { data: scanRuns } = scanIds.length
    ? await admin.from("runs").select("id, status, created_at, suite_id").in("suite_id", scanIds).order("created_at", { ascending: false })
    : { data: [] };

  const rows = (candidates ?? []) as unknown as Candidate[];
  const obs = (obligations ?? []) as unknown as Obligation[];
  const obById = new Map(obs.map((o) => [o.id, o]));
  const agentList = (agents ?? []) as Array<{ id: string; name: string; config: AgentConfig }>;
  const agent = agentList.find((a) => a.id === build.agent_id) ?? null;
  const reportsTools = agent ? agent.config.kind === "http" ? Boolean(agent.config.toolActivityPath) : false : null;
  const coverage = buildCoverage({ candidates: rows, obligations: obs, agentReportsTools: reportsTools });
  const pack = build.pack_key ? packByKey(build.pack_key, build.pack_version ?? undefined) : null;
  const isDraft = build.status === "draft";
  const canDraft = can(role, "scenario.draft") && isDraft;
  const canDecide = can(role, "scenario.decide") && isDraft;
  const canPublish = can(role, "scenario.promote");
  const canRun = can(role, "run.start");
  const step: Step = (["sources", "review", "coverage", "publish"] as const).find((s) => s === sp.step) ?? (build.status === "published" ? "publish" : "review");
  const view: View = (["decide", "approved", "closed", "all"] as const).find((v) => v === sp.view) ?? "decide";
  const published = build.suites as { id: string; key: string; version: number; cases: SuiteCase[] } | null;
  const route = documentRoute(new Set(connectionsFromEnv().keys()));
  const openQuestions = obs.filter((o) => o.status === "open");
  const live = rows.filter((c) => c.status === "draft" || c.status === "needs_review" || c.status === "approved");

  // What this person decided in the last ten minutes stays in "To decide", showing its new
  // state, so a decision is seen to land instead of the row simply vanishing.
  const since = minutesAgo(10);
  const justDecided = (c: Candidate) =>
    (c.approved_by === user.id && (c.approved_at ?? "") > since)
    || (c.rejected_by === user.id && (c.rejected_at ?? "") > since)
    || (c.not_applicable_by === user.id && (c.not_applicable_at ?? "") > since);
  const shown = rows.filter((c) => view === "all" ? true
    : view === "decide" ? c.status === "draft" || c.status === "needs_review" || justDecided(c)
    : view === "approved" ? c.status === "approved" || c.status === "included"
    : c.status === "rejected" || c.status === "not_applicable");
  const bulk = canDecide ? rows.filter((c) => bulkEligible(c, obById)) : [];

  const tab = (s: Step) => `/builder/${id}?step=${s}`;
  const statusBadge = <Badge tone={build.status === "published" ? "pass" : build.status === "abandoned" ? "neutral" : build.status === "approved" ? "medium" : "live"}>{build.status}</Badge>;

  return (
    <main className="w-full pb-10 text-ink">
      <PageHeader
        back={{ href: "/builder", label: "Suite Builder" }}
        eyebrow={pack ? `${pack.title} v${pack.version}${build.quick ? " · quick start" : ""}` : "No pack"}
        title={build.name as string}
        status={statusBadge}
        description={<>
          {build.prepared_for ? <>Prepared for {build.prepared_for as string}. </> : null}
          {coverage.approved} approved · {coverage.undecided} to decide · {coverage.openQuestions} open question{coverage.openQuestions === 1 ? "" : "s"}
          {coverage.conflicts ? ` · ${coverage.conflicts} conflict${coverage.conflicts === 1 ? "" : "s"}` : ""}
        </>}
        action={published ? <ButtonLink href={`/scenarios?suite=${published.id}`}>Open {published.key} v{published.version}</ButtonLink>
          : isDraft && step !== "publish" && coverage.approved > 0 && canPublish ? <ButtonLink href={tab("publish")} variant="secondary">Publish</ButtonLink> : undefined}
      />
      <TabNav label="Suite Builder steps" current={step} tabs={[
        { key: "sources", label: "Sources", href: tab("sources"), count: (sources ?? []).length },
        { key: "review", label: "Review", href: tab("review"), count: coverage.undecided + openQuestions.length },
        { key: "coverage", label: "Coverage and gaps", href: tab("coverage") },
        { key: "publish", label: build.status === "published" ? "Published" : "Publish", href: tab("publish") },
      ]} />

      {step === "sources" && (
        <>
          <Section title="Sources">
            {(sources ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">No sources yet. A pack works on its own; your own documents add scenarios about what your agent may and may not do.</p>
            ) : (
              <Panel><Rows label="Sources">
                {(sources ?? []).map((s) => {
                  const parts = s.text ? partsOf(s.text as string).length : 0;
                  const read = s.extracted_parts as number;
                  const redaction = Object.entries((s.redaction ?? {}) as Record<string, number>);
                  const document = ["pasted", "upload", "url"].includes(s.kind as string);
                  return (
                    <li key={s.id as string} className="grid gap-2 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{s.title as string}</p>
                        <Badge tone={s.status === "parsed" ? "pass" : s.status === "failed" ? "fail" : "neutral"}>
                          {s.kind === "agent_observation" ? "observed" : s.kind === "tool_schema" ? "declared" : s.status as string}
                        </Badge>
                      </div>
                      <p className="text-ink-soft [overflow-wrap:anywhere]">
                        {s.locator ? <>{s.locator as string} · </> : null}SHA-256 {String(s.original_sha256).slice(0, 12)}…
                        {redaction.length ? <> · replaced before storing: {redaction.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}</> : null}
                        {s.content_expired_at ? " · text expired under retention" : ""}
                      </p>
                      {s.status === "failed" && <p className="text-fail-text">{s.parse_error as string}</p>}
                      {document && typeof s.text === "string" && (() => {
                        const shaped = instructionShapedSentences(s.text);
                        return shaped.length > 0 && (
                          <div role="note" className="rounded-control border border-warning-border bg-warning-surface px-3 py-2 text-warning-text">
                            <p className="font-medium">Instruction-shaped text in this source</p>
                            <p className="mt-1 text-xs">Read as text, never followed. Check whether it belongs in the document before you decide anything drafted from it.</p>
                            <ul className="mt-1 list-disc pl-5 text-xs">{shaped.map((l) => <li key={l} className="[overflow-wrap:anywhere]">&ldquo;{l}&rdquo;</li>)}</ul>
                          </div>
                        );
                      })()}
                      {s.kind === "agent_observation" && s.text && (
                        <ul className="list-disc pl-5 text-ink-soft">{(s.text as string).split("\n").map((l) => <li key={l}>{l.replace(/^Observed: /, "")}</li>)}</ul>
                      )}
                      {document && s.status === "parsed" && parts > 0 && (
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-ink-soft">{read >= parts ? `All ${parts} part(s) read.` : `${read} of ${parts} part(s) read.`}</span>
                          {canDraft && <ExtractButton buildId={id} sourceId={s.id as string} done={read >= parts} label={read === 0 ? "Read for obligations" : `Read part ${read + 1}`} />}
                          {canDraft && agent && can(role, "policy.write") && <PolicyFromSource buildId={id} sourceId={s.id as string} agentId={agent.id} agentName={agent.name} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </Rows></Panel>
            )}
          </Section>

          {canDraft && (
            <>
              <Section title="Add a source">
                <div className="rounded-panel border border-line bg-surface p-4 sm:p-5">
                  <div role="note" className="mb-4 rounded-control border border-info-border bg-info-surface px-3 py-2 text-sm text-info-text">
                    <p className="font-medium">Where your text goes</p>
                    <p className="mt-1">
                      It is stored with email addresses, phone numbers, card numbers, IBANs and IP addresses already replaced; the file itself is
                      not kept. When you ask Novera to read it, that text goes to{" "}
                      {route.allowed.length ? route.allowed.map((c) => `${providerName(c.connection)} (${c.model})`).join(", then ") : "no configured provider"}
                      {" "}— providers whose terms allow customer content — and never to{" "}
                      {[...new Set(route.excluded.map((c) => providerName(c.connection)))].join(" or ") || "a free tier that may train on it"}.
                      A model only proposes; nothing is tested until you approve it.
                    </p>
                  </div>
                  <SourceForm buildId={id} />
                </div>
              </Section>
              <Section title="Observe your agent">
                <p className="mb-3 max-w-3xl text-sm text-ink-soft">
                  Records what Novera can see — how the agent is called, whether it reports tools, which tools it called in recorded runs — and
                  compares it with your documents. Observed is not declared: where your documents say nothing, you are asked instead.
                </p>
                <ObserveForm buildId={id} agents={agentList.map((a) => ({ id: a.id, name: a.name }))} defaultAgent={build.agent_id as string | null} />
              </Section>
              {(waitingProduction ?? 0) > 0 && (
                <Section title="Production failures">
                  <p className="mb-3 text-sm text-ink-soft">Recorded failures already drafted as regression scenarios, waiting for a decision.</p>
                  <AttachProductionForm buildId={id} waiting={waitingProduction ?? 0} />
                </Section>
              )}
            </>
          )}
        </>
      )}

      {step === "review" && (
        <>
          {openQuestions.length > 0 && (
            <Section title={`Questions for you (${openQuestions.length})`}>
              <p className="mb-3 max-w-3xl text-sm text-ink-soft">The scenarios that rest on a question cannot be approved until it is answered or marked not applicable. Answers are yours; suggestions are drafts with the passage they rely on.</p>
              <div className="grid gap-2">
                {openQuestions.map((o) => (
                  <Disclosure key={o.id} defaultOpen={openQuestions.length <= 3} summary={o.question}>
                    <blockquote className="border-l-2 border-line-strong pl-3 text-sm text-ink">“{o.passage}”</blockquote>
                    <p className="mt-2 text-sm text-ink-soft">Read as: {o.interpretation}</p>
                    {canDecide ? <div className="mt-3"><AnswerForm buildId={id} obligationId={o.id} suggestions={o.suggested_answers} /></div>
                      : <p className="mt-3 text-sm text-ink-soft">Answering is for those who approve scenarios.</p>}
                  </Disclosure>
                ))}
              </div>
            </Section>
          )}

          {/^\d{1,3}$/.test(sp.grouped ?? "") && (
            <p role="status" className="rounded-control border border-pass-border bg-pass-surface px-3 py-2 text-sm text-pass-text">
              {sp.grouped} approved together, recorded in the audit trail under your name.
            </p>
          )}

          {bulk.length > 1 && view === "decide" && (
            <Section title="Approve the straightforward ones together">
              <Disclosure summary={`${bulk.length} that can be approved together — unchanged pack scenarios and low-risk drafts, nothing open`}>
                <BulkApproveForm buildId={id} candidates={bulk.map((c) => ({ id: c.id, label: `${c.scenario.id} · ${c.scenario.severity} · ${c.scenario.input.slice(0, 90)}${c.scenario.input.length > 90 ? "…" : ""}` }))} />
              </Disclosure>
            </Section>
          )}

          <Section title="Scenarios" action={
            <nav aria-label="Filter scenarios" className="flex flex-wrap gap-1.5">
              {([["decide", `To decide (${coverage.undecided})`], ["approved", `Approved (${coverage.approved})`], ["closed", `Rejected or not applicable (${coverage.rejected + coverage.notApplicable})`], ["all", "All"]] as const).map(([v, label]) => (
                <Link key={v} href={`/builder/${id}?step=review&view=${v}`} scroll={false} aria-current={view === v ? "true" : undefined}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${view === v ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface text-ink-soft hover:text-ink"}`}>{label}</Link>
              ))}
            </nav>
          }>
            {shown.length === 0 ? (
              <p className="text-sm text-ink-soft">{view === "decide" ? "Nothing waits for a decision." : "Nothing here."}{rows.length === 0 ? " Add a source or start from a pack." : ""}</p>
            ) : (
              <div className="grid gap-2">
                {shown.map((c) => {
                  const s = c.scenario;
                  const ob = c.obligation_id ? obById.get(c.obligation_id) : undefined;
                  const blocked = ob?.status === "open" ? "Answer the question this rests on before approving it." : null;
                  const conflicts = (c.conflicts ?? []) as Array<{ kind?: string; observed?: string; declared?: { source?: string; passage?: string }; action?: string; note?: string }>;
                  const label = c.origin === "pack" ? labelOf((c.source_ref as { case_id?: string } | null)?.case_id ?? "") : null;
                  const editing = sp.edit === c.id && canDraft && (c.status === "draft" || c.status === "needs_review");
                  return (
                    <div key={c.id} id={`c-${c.id}`} className="scroll-mt-20">
                      <Disclosure defaultOpen={editing} summary={
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-xs text-ink-faint">{s.id}</span>
                          <span className="min-w-0 [overflow-wrap:anywhere]">{s.input.length > 110 ? `${s.input.slice(0, 110)}…` : s.input}</span>
                          <Badge tone={s.severity as "low" | "medium" | "high" | "critical"}>{s.severity}</Badge>
                          <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                          {conflicts.length > 0 && <Badge tone="error">{conflicts[0].kind === "instruction_shaped" ? "flagged" : "conflict"}</Badge>}
                          {c.destructive && <Badge tone="high">destructive · runs only on a test target</Badge>}
                        </span>
                      }>
                        <div className="grid gap-3 text-sm">
                          <p className="text-ink-soft">{originLabel(c)}{c.model ? ` · drafted by ${c.model}` : ""}{label?.expected ? ` · measured: the fixture is labelled ${label.expected}` : ""}</p>
                          {c.review_note && <p className="rounded-control border border-warning-border bg-warning-surface px-3 py-2 text-warning-text">{c.review_note}</p>}
                          {conflicts.map((k, i) => k.kind === "observed_vs_declared" ? (
                            <dl key={i} className="grid gap-1 rounded-control border border-warning-border bg-warning-surface px-3 py-2 text-warning-text">
                              <div><dt className="inline font-medium">Observed: </dt><dd className="inline">{k.observed}</dd></div>
                              <div><dt className="inline font-medium">Declared: </dt><dd className="inline">“{k.declared?.passage}” ({k.declared?.source})</dd></div>
                              <div><dt className="inline font-medium">Action: </dt><dd className="inline">{k.action}</dd></div>
                            </dl>
                          ) : null)}
                          {c.source_quote && (
                            <div>
                              <p className="text-ink-soft">{c.origin === "discovery" ? "Observation" : "Source passage"}{c.suite_sources ? ` · ${c.suite_sources.title}` : ""}</p>
                              <blockquote className="mt-1 border-l-2 border-line-strong pl-3 text-ink">“{c.source_quote}”</blockquote>
                            </div>
                          )}
                          {ob && <p className="text-ink-soft">Read as: {ob.interpretation}{ob.status === "answered" ? <> · <span className="text-ink">Your answer: {ob.answer}</span></> : null}</p>}
                          {editing ? (
                            <EditForm buildId={id} draftId={c.id} input={s.input} expected={s.expected_behavior} assertions={s.assertions} severity={s.severity} />
                          ) : (
                            <>
                              <div>
                                <p className="font-medium text-ink">The customer sends</p>
                                <p className="mt-1 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{s.input}</p>
                                {s.earlier_turns?.length ? <p className="mt-1 text-ink-soft">After {s.earlier_turns.length} earlier turn(s).</p> : null}
                              </div>
                              <div><p className="font-medium text-ink">Expected</p><p className="mt-1 text-ink">{s.expected_behavior}</p></div>
                              <div>
                                <p className="font-medium text-ink">Settled by</p>
                                <ul className="mt-1 list-disc pl-5 text-ink">
                                  {(s.checks ?? []).map((k, i) => <li key={`k${i}`}>{describeCheck(k)} <span className="text-ink-faint">(rule)</span></li>)}
                                  {s.assertions.map((a) => <li key={a}>{a}</li>)}
                                  {(s.forbidden ?? []).map((f) => <li key={f}>Never: {f}</li>)}
                                </ul>
                              </div>
                              {s.effect && <p className="text-ink-soft">Evidence required: {s.effect.describe} — {s.effect.evidence === "state_confirmed" ? "confirmed by a read-back of your system" : "a recorded tool call"}{reportsTools === false && s.effect.evidence === "tool_invoked" ? ". Your agent reports no tool activity, so this will be unverified." : "."}</p>}
                              {s.duty_refs?.length ? <p className="text-ink-soft">Filed under: {s.duty_refs.join(", ")}</p> : null}
                            </>
                          )}
                          {(c.status === "rejected" && c.rejection_reason) && <p className="text-ink-soft">Rejected: {c.rejection_reason}</p>}
                          {(c.status === "not_applicable" && c.not_applicable_reason) && <p className="text-ink-soft">Not applicable: {c.not_applicable_reason}</p>}
                          {c.approval_group && <p className="text-ink-faint">Approved together with others; recorded in the audit trail.</p>}
                          {(c.status === "draft" || c.status === "needs_review") && !editing && (
                            <div className="grid gap-2 border-t border-line pt-3">
                              <DecideForm buildId={id} draftId={c.id} canDecide={canDecide} canEdit={canDraft} blocked={blocked} />
                              {canDraft && <Link href={`/builder/${id}?step=review&view=${view}&edit=${c.id}#c-${c.id}`} className="text-sm font-medium text-ink underline underline-offset-2">Edit</Link>}
                            </div>
                          )}
                        </div>
                      </Disclosure>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      )}

      {step === "coverage" && (
        <>
          <Section title="Where this suite stands">
            <Metrics items={[
              { label: "Approved", value: coverage.approved, note: `${coverage.baselineOnly} from the baseline only` },
              { label: "Need your answer", value: coverage.openQuestions + coverage.needsReview, note: `${coverage.openQuestions} question(s), ${coverage.needsReview} draft(s) marked for review` },
              { label: "Conflicts", value: coverage.conflicts, note: "observed behaviour against your documents, or a flagged passage" },
            ]} />
            <ul className="mt-4 grid gap-1 text-sm text-ink">
              <li>{coverage.approved} approved</li>
              <li>{coverage.openQuestions + coverage.needsReview} need your answer</li>
              <li>{coverage.conflicts} source conflict{coverage.conflicts === 1 ? "" : "s"}</li>
              <li>{coverage.baselineOnly} baseline-only scenario{coverage.baselineOnly === 1 ? "" : "s"}</li>
              <li>{reportsTools === null ? "No agent chosen, so tool receipts cannot be checked yet" : `${coverage.missingToolReceipts} missing tool receipt${coverage.missingToolReceipts === 1 ? "" : "s"}`}</li>
              <li>{coverage.notApplicable} not applicable · {coverage.rejected} rejected</li>
            </ul>
            <p className="mt-3 max-w-3xl text-sm text-ink-soft">
              {coverage.readyToPublish ? "Every candidate is decided and no question is open."
                : "This suite is not complete: what is still open will not be in it unless you decide it, or publish without it by saying why."}
            </p>
          </Section>

          <Section title="Try it before deciding">
            {canRun && live.length > 0 && isDraft ? (
              <ScanForm buildId={id} agents={agentList.map((a) => ({ id: a.id, name: a.name }))} defaultAgent={build.agent_id as string | null} scenarios={live.length} />
            ) : <p className="text-sm text-ink-soft">{isDraft ? "An exploratory scan needs at least one live candidate and the right to start runs." : "Scans are for builds still in progress."}</p>}
            {(scanRuns ?? []).length > 0 && (
              <Panel className="mt-4"><Rows label="Exploratory scans">
                {(scanRuns ?? []).map((r) => (
                  <li key={r.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <Link href={`/runs/${r.id}`} className="font-medium text-ink underline-offset-2 hover:underline">Exploratory scan · {formatWhen(r.created_at as string, context.profile)}</Link>
                    <span className="text-ink-soft">{r.status as string} · not a conformity report</span>
                  </li>
                ))}
              </Rows></Panel>
            )}
          </Section>
        </>
      )}

      {step === "publish" && (
        <>
          {published ? (
            <Section title="Published">
              <p className="max-w-3xl text-sm text-ink">
                {published.key} v{published.version} — {published.cases.length === 1 ? "1 scenario, approved" : `${published.cases.length} scenarios, each approved`} by a named person — published{" "}
                {build.published_at ? formatWhen(build.published_at as string, context.profile) : ""}. A suite version never changes; to change it,
                start a new build. Runs of it seal reports like any suite.
              </p>
              <p className="mt-3 text-sm text-ink-soft">Scope: {build.scope as string}</p>
              {build.gaps_accepted_reason && <p className="mt-2 text-sm text-ink-soft">Published with open items left out: {build.gaps_accepted_reason as string}</p>}
            </Section>
          ) : build.status === "abandoned" ? (
            <Section title="Abandoned"><p className="text-sm text-ink-soft">This build was abandoned. Its drafts stay as a record; start a new build to continue.</p></Section>
          ) : canPublish ? (
            <Section title="Approve and publish">
              <p className="mb-4 max-w-3xl text-sm text-ink-soft">
                Publishing creates a new suite version from the {coverage.approved} approved scenario{coverage.approved === 1 ? "" : "s"}, with this build&rsquo;s sources,
                pack and decisions recorded as its provenance. It cannot be edited afterwards.
              </p>
              {coverage.approved === 0 ? <p className="text-sm text-ink-soft">Approve at least one scenario first.</p> : (
                <PublishForm buildId={id} name={build.name as string} scope={(build.scope as string | null) ?? (pack ? `${pack.scope}` : "")}
                  gaps={{ openQuestions: coverage.openQuestions, undecided: coverage.undecided }} acknowledgement={ACKNOWLEDGEMENT} />
              )}
            </Section>
          ) : (
            <Section title="Publish"><p className="text-sm text-ink-soft">Publishing is for those who approve scenarios. Ask an owner, admin or reviewer of {workspace.name}.</p></Section>
          )}
          {isDraft && can(role, "scenario.draft") && (
            <Section title="Stop">
              <Disclosure tone="danger" summary="Abandon this build">
                <p className="mb-3 text-sm text-ink-soft">Its drafts and sources stay as a record. Nothing is deleted.</p>
                <AbandonForm buildId={id} />
              </Disclosure>
            </Section>
          )}
        </>
      )}
    </main>
  );
}
