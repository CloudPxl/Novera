import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui/primitives.tsx";
import { regressionStage, type RegressionStage } from "@/lib/regressions/draft.ts";
import type { SuiteCase } from "@/lib/runner/types.ts";
import type { RedactionRecord } from "@/lib/redact/store.ts";
import { PageHeader } from "@/components/ui/page.tsx";
import { FailureForm } from "./client.tsx";

export const metadata: Metadata = { title: "Regressions · Novera" };
export const dynamic = "force-dynamic";

interface FailureRow {
  id: string;
  customer_message: string;
  agent_reply: string | null;
  expected_behavior: string;
  what_went_wrong: string | null;
  occurred_on: string | null;
  redaction: RedactionRecord;
  created_at: string;
  agents: { name: string } | null;
  /** Set when a pipeline sent the failure through the API (0044). */
  api_keys: { name: string } | null;
}

interface DraftRow {
  production_failure_id: string;
  status: "draft" | "approved" | "rejected" | "included";
  rejection_reason: string | null;
  scenario: SuiteCase;
  included_in_suite_id: string | null;
}

const STAGE: Record<RegressionStage["stage"], { label: string; tone: BadgeTone }> = {
  drafted: { label: "waiting for your review", tone: "medium" },
  rejected: { label: "rejected", tone: "neutral" },
  approved: { label: "approved, not yet in a suite", tone: "live" },
  in_suite: { label: "in a suite, not run yet", tone: "live" },
  held: { label: "held — passed on the last run", tone: "pass" },
  came_back: { label: "came back — passed before, failed on the last run", tone: "fail" },
  still_failing: { label: "still failing — not passed on any run yet", tone: "fail" },
  no_result: { label: "no result on the last run", tone: "error" },
};

export default async function RegressionsPage() {
  const { user, workspace } = await requireWorkspace();
  const admin = await assertMembership(user.id, workspace.id);

  const [{ data: failures }, { data: drafts }, { data: suites }, { data: agents }] = await Promise.all([
    admin.from("production_failures")
      .select("id, customer_message, agent_reply, expected_behavior, what_went_wrong, occurred_on, redaction, created_at, agents(name), api_keys(name)")
      .eq("workspace_id", workspace.id).order("created_at", { ascending: false }),
    admin.from("scenario_drafts")
      .select("production_failure_id, status, rejection_reason, scenario, included_in_suite_id")
      .eq("workspace_id", workspace.id).eq("origin", "production"),
    admin.from("suites").select("id, key, version, cases").eq("workspace_id", workspace.id),
    admin.from("agents").select("id, name").eq("workspace_id", workspace.id).order("created_at"),
  ]);

  const draftByFailure = new Map(((drafts ?? []) as DraftRow[]).map((d) => [d.production_failure_id, d]));
  const suiteList = (suites ?? []) as Array<{ id: string; key: string; version: number; cases: SuiteCase[] }>;

  // A case is the same regression in any of this workspace's suites that carries the
  // same id with the same input — a later version that extended the first one still
  // guards against the same incident.
  const suitesFor = (c: SuiteCase) =>
    suiteList.filter((s) => (s.cases ?? []).some((x) => x.id === c.id && x.input === c.input)).map((s) => s.id);

  const included = [...draftByFailure.values()].filter((d) => d.status === "included");
  const caseIds = [...new Set(included.map((d) => d.scenario.id))];
  const suiteIds = [...new Set(included.flatMap((d) => suitesFor(d.scenario)))];

  // The newest verdict for each regression case, from completed runs only: a run still
  // in progress has not finished saying anything.
  const { data: results } = caseIds.length && suiteIds.length
    ? await admin.from("run_cases")
      .select("case_id, status, created_at, runs!inner(suite_id, status)")
      .eq("workspace_id", workspace.id).in("case_id", caseIds)
      .in("runs.suite_id", suiteIds).eq("runs.status", "completed")
      .order("created_at", { ascending: false })
    : { data: [] };

  const historyFor = (d: DraftRow) => {
    const ids = new Set(suitesFor(d.scenario));
    const rows = ((results ?? []) as unknown as Array<{ case_id: string; status: "pass" | "fail" | "error"; created_at: string; runs: { suite_id: string } }>)
      .filter((r) => r.case_id === d.scenario.id && ids.has(r.runs.suite_id));
    const [newest, ...earlier] = rows;
    return {
      latest: newest ? { status: newest.status, at: newest.created_at } : null,
      passedBefore: earlier.some((r) => r.status === "pass"),
    };
  };

  const rows = ((failures ?? []) as unknown as FailureRow[]).map((f) => {
    const draft = draftByFailure.get(f.id);
    const suite = draft?.included_in_suite_id ? suiteList.find((s) => s.id === draft.included_in_suite_id) : null;
    const stage = draft
      ? regressionStage({
          draftStatus: draft.status,
          rejectionReason: draft.rejection_reason,
          suite: suite ? `${suite.key} v${suite.version}` : null,
          ...(draft.status === "included" ? historyFor(draft) : {}),
        })
      : null;
    return { f, draft, stage };
  });

  return (
    <main className="w-full pb-10 text-ink">
      <PageHeader
        eyebrow="Work"
        title="Regressions from production"
        description="A mistake your agent made with a real customer is the best test case you have. Record it once, and every later run shows whether it came back."
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:items-start">
      {/* The form is the second thing on the page once something is recorded: the list is
          what a returning operator came for. Open by default only on an empty page. */}
      <details open={rows.length === 0} className="group order-first rounded-shell border border-line bg-surface shadow-card xl:order-last xl:sticky xl:top-20">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-shell px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block type-h2">Record a failure</span>
            <span className="mt-0.5 block text-sm text-ink-soft">About two minutes. Personal details are removed before anything is stored.</span>
          </span>
          <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-180">▾</span>
        </summary>
        <div className="border-t border-line px-5 pb-5">
          <FailureForm agents={(agents ?? []) as Array<{ id: string; name: string }>} />
        </div>
      </details>

      <Reveal>
        <h2 className="type-h2">Recorded failures</h2>
        {rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Nothing recorded yet">
              When a customer conversation goes wrong, record it with the form on this page. It becomes a draft scenario on the
              Scenarios page for you to approve.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-shell border border-line bg-surface">
            {rows.map(({ f, draft, stage }) => (
              <li key={f.id}>
                {/* One line per incident; what was said, and how it was stored, opens beneath it. */}
                <details>
                  <summary className="grid cursor-pointer list-none gap-x-4 gap-y-1.5 px-5 py-3.5 text-sm transition-colors hover:bg-ground md:grid-cols-[minmax(0,1fr)_auto] md:items-center [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        {stage && <Badge tone={STAGE[stage.stage].tone}>{STAGE[stage.stage].label}</Badge>}
                        {draft && <span className="type-mono text-xs text-ink-faint">{draft.scenario.id}</span>}
                      </span>
                      <span className="mt-1 block font-medium">{f.expected_behavior}</span>
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {f.agents ? `${f.agents.name} · ` : ""}{f.occurred_on ? `happened ${f.occurred_on} · ` : ""}recorded {f.created_at.slice(0, 10)}
                        {f.api_keys ? ` · sent with the API key “${f.api_keys.name}”` : ""}
                      </span>
                    </span>
                    {/* A summary is already the control that opens the row; a link inside it is a
                        control inside a control (axe nested-interactive, production 2026-10-08). The
                        row says what is next; the link is the first thing it opens onto. */}
                    <span className="text-sm font-medium text-ink-soft">
                      {stage?.stage === "drafted" ? "Draft to review" : stage?.stage === "approved" ? "Ready for a suite" : "Details"}
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-line bg-ground px-5 py-4 text-sm">
                    {(stage?.stage === "drafted" || stage?.stage === "approved") && (
                      <Link href="/scenarios?tab=drafts" className="inline-block font-medium text-ink underline underline-offset-2 hover:text-ink-soft">
                        {stage.stage === "drafted" ? "Review the draft →" : "Add it to a suite →"}
                      </Link>
                    )}
                    <div><p className="text-xs font-medium text-ink-faint">The customer sent</p><p className="mt-1 whitespace-pre-wrap">{f.customer_message}</p></div>
                    {f.agent_reply && <div><p className="text-xs font-medium text-ink-faint">The agent replied</p><p className="mt-1 whitespace-pre-wrap text-ink-soft">{f.agent_reply}</p></div>}
                    {stage && "suite" in stage && <p className="text-xs text-ink-soft">In {stage.suite}.</p>}
                    {stage?.stage === "rejected" && stage.reason && <p className="text-ink-faint">Rejected because: {stage.reason}</p>}
                    <p className="text-xs text-ink-faint">
                      Stored redacted
                      {Object.keys(f.redaction.counts ?? {}).length > 0
                        ? ` (removed: ${Object.entries(f.redaction.counts).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")})`
                        : ""}
                      . The original text was not kept; its SHA-256 is{" "}
                      <span className="type-mono break-all">{f.redaction.original_hash}</span>.
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
      </div>
    </main>
  );
}
