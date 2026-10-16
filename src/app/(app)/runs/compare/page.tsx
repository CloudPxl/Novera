import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { loadComparison, type LoadedRun } from "@/lib/evidence/comparison-loader.ts";
import { loadStability } from "@/lib/evidence/stability-history.ts";
import { DELTA_CAUSE_SHORT, DELTA_LABEL, DELTA_VIEWS, deltaSummary, deltasInView, viewCounts } from "@/lib/evidence/compare.ts";
import { REPORT_NOTICE_SHORT, REPORT_NOTICE_TITLE } from "@/lib/legal/notices.ts";
import { NOVERA_ATTRIBUTION } from "@/lib/report/seal.ts";
import { Badge } from "@/components/ui/primitives.tsx";
import { HealthLine, PageHeader, Panel, TabNav } from "@/components/ui/page.tsx";
import { SectionNav } from "@/components/shell/section-nav.tsx";
import { ScenarioRow, VERDICT_WORD } from "./scenario-row.tsx";

export const metadata: Metadata = { title: "Compare runs · Novera" };
export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const one = (v: Param) => (Array.isArray(v) ? v[0] : v);
const utc = (at: string | null | undefined) => (at ? `${at.slice(0, 16).replace("T", " ")} UTC` : "—");

/**
 * Two runs of one agent, side by side, scenario by scenario: the regression view.
 *
 * Read by the same loader as the run page's Comparison tab, so the two never disagree. A
 * verdict that moved on an identical reply is the graders, and is listed on its own — never as
 * a regression or a fix. Anything that cannot be compared (no ids, an unknown id, another agent,
 * another suite, a run still in flight) is explained calmly with somewhere to go, never a 500.
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ base?: Param; target?: Param; view?: Param }> }) {
  const sp = await searchParams;
  const baseId = one(sp.base);
  const targetId = one(sp.target);
  const view = DELTA_VIEWS.find((v) => v.key === one(sp.view))?.key ?? "all";
  const { workspace, context } = await requireWorkspace();
  const db = await sessionClient();

  const loaded = await loadComparison({ db, workspaceId: workspace.id, baseId, targetId, seals: true });

  if (!loaded.ok) {
    const elsewhere = loaded.reason === "other_workspace"
      ? loaded.runs.filter((r) => r.workspaceId !== workspace.id)
      : [];
    return (
      <main className="w-full pb-8 text-ink">
        {/* With no runs named this is the Compare view of Runs; a refused pair is still a pair, reached from a run. */}
        {loaded.reason === "missing" && <SectionNav section="runs" current="compare" />}
        <PageHeader
          eyebrow={loaded.reason === "missing" ? undefined : "Comparison"}
          title={loaded.reason === "missing" ? "Choose two runs to compare" : "These runs cannot be compared here"}
          back={loaded.reason === "missing" ? undefined : { href: "/runs", label: "Runs" }}
        />
        <div className="max-w-2xl rounded-shell border border-line bg-surface px-5 py-4">
          <p className="type-body text-ink">{loaded.sentence}</p>
          {loaded.reason === "missing" && (
            <p className="mt-2 type-body text-ink-soft">
              Open a run and use <span className="font-medium text-ink">Compare with previous run</span>, or pick a baseline on its
              Comparison tab. Only runs of the same agent and the same suite can be compared.
            </p>
          )}
          {elsewhere.map((r) => {
            const there = context.memberships.find((m) => m.workspace.id === r.workspaceId);
            return there ? (
              <p key={r.id} className="mt-2 type-body text-ink-soft">
                The run started {r.label} is in {there.workspace.name}; opening it offers to switch there.
              </p>
            ) : null;
          })}
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {loaded.runs.map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`} className="font-medium underline underline-offset-2">Open the run started {r.label}</Link>
              </li>
            ))}
            <li><Link href="/runs" className="font-medium underline underline-offset-2">All runs</Link></li>
          </ul>
        </div>
      </main>
    );
  }

  const { base, target, deltas, config } = loaded;
  const [{ data: agent }, stability] = await Promise.all([
    db.from("agents").select("name").eq("id", target.agentId).maybeSingle(),
    loadStability({ client: db, agentId: target.agentId, suiteId: target.suite.id, asOf: target.createdAt }),
  ]);
  const agentName = (agent?.name as string | undefined) ?? "Agent";
  const summary = deltaSummary(deltas);
  const counts = viewCounts(deltas);
  const shown = deltasInView(deltas, view);
  const href = (v: string, b = base.id, t = target.id) => `/runs/compare?base=${b}&target=${t}${v === "all" ? "" : `&view=${v}`}`;
  const labels = { base: `Base · ${utc(base.startedAt ?? base.createdAt)}`, target: `Target · ${utc(target.startedAt ?? target.createdAt)}` };
  const later = new Date(base.createdAt) > new Date(target.createdAt);
  const [latBase, latTarget] = config.medianLatencyMs;

  return (
    <main className="w-full pb-8 text-ink">
      <Link href={`/runs/${target.id}?tab=comparison&compare=${base.id}`} className="print-hide mt-8 inline-block text-sm text-ink-faint underline-offset-2 hover:text-ink hover:underline">
        ← Target run
      </Link>
      <div className="[&>header]:pt-3">
      <PageHeader
        eyebrow="Comparison"
        title={agentName}
        description={`${target.suite.name} — every scenario of two runs side by side: what regressed, what was fixed, and what moved only because the graders did.`}
        action={
          <div className="print-hide flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-medium text-ink-soft">
            <Link href={href(view, target.id, base.id)} className="underline-offset-2 hover:text-ink hover:underline">
              Swap base and target
            </Link>
            {/* The same comparison as a file (src/app/(app)/runs/compare/export): verdicts, ids and hashes, no replies. */}
            <a href={`/runs/compare/export?base=${base.id}&target=${target.id}&format=md`} download className="underline-offset-2 hover:text-ink hover:underline">
              Download Markdown
            </a>
            <a href={`/runs/compare/export?base=${base.id}&target=${target.id}&format=json`} download className="underline-offset-2 hover:text-ink hover:underline">
              Download JSON
            </a>
          </div>
        }
      />
      </div>

      {/* Print only: whose evidence this is. The comparison itself is not sealed; each run's seal is below. */}
      <p className="hidden pb-3 text-xs font-semibold text-ink print:block">{NOVERA_ATTRIBUTION} Run comparison, printed from the stored runs; not itself a sealed document.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <RunCard role="Base" run={base} />
        <RunCard role="Target" run={target} />
      </div>
      {later && (
        <p className="mt-2 text-sm text-warning-text">The base run is the later of the two, so every change below reads backwards in time.</p>
      )}

      <div className="compare-summary mt-6">
        <Panel>
          <HealthLine
            tone={summary.tone}
            title={summary.headline}
            detail={summary.lines.length ? <>{summary.lines.map((l) => <span key={l} className="block">{l}</span>)}</> : undefined}
          />
          <div className="border-t border-line px-5 py-3 text-sm text-ink-soft">
            <p className="font-medium text-ink">What else differed</p>
            {config.changes.length ? (
              <ul className="mt-1 space-y-0.5">{config.changes.map((c) => <li key={c}>{c}</li>)}</ul>
            ) : (
              <p className="mt-1">Same suite version, policy (v{target.policyVersion ?? "?"}), graders, rubric and agent configuration.</p>
            )}
            <p className="mt-1 tnum">
              Median agent latency: {latBase === null ? "not recorded" : `${latBase} ms`} → {latTarget === null ? "not recorded" : `${latTarget} ms`}.
            </p>
            {deltas.counts.regressed > 0 && (
              <p className="mt-1">
                Regressions by severity:{" "}
                {Object.entries(deltas.regressionsBySeverity).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(", ")}.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <section aria-labelledby="scenarios-heading" className="mt-8">
        <h2 id="scenarios-heading" className="type-h2">Scenarios</h2>
        <div className="print-hide mt-3">
          <TabNav
            label="Filter scenarios"
            current={view}
            tabs={DELTA_VIEWS.map((v) => ({ key: v.key, label: v.label, href: href(v.key), count: counts[v.key] }))}
          />
        </div>

        <div className="print-hide mt-3">
          {shown.length === 0 ? (
            <p className="rounded-panel border border-line bg-surface px-5 py-8 text-center text-sm text-ink-soft">
              No scenario is in this view. The comparison covers {deltas.deltas.length}.
            </p>
          ) : (
            <Panel>
              <ul aria-label="Scenarios in this view" className="divide-y divide-line">
                {shown.map((d) => (
                  <ScenarioRow
                    key={d.caseId}
                    delta={d}
                    base={base.cases.get(d.caseId) ?? null}
                    target={target.cases.get(d.caseId) ?? null}
                    labels={labels}
                    instability={stability.get(d.caseId) ?? null}
                  />
                ))}
              </ul>
            </Panel>
          )}
        </div>

        {/* The appendix on paper: every scenario, whatever filter was on screen, one row each. */}
        <table className="compare-appendix hidden print:table">
          <thead>
            <tr><th>Scenario</th><th>Severity</th><th>Base</th><th>Target</th><th>Change</th><th>Why</th></tr>
          </thead>
          <tbody>
            {deltas.deltas.map((d) => (
              <tr key={d.caseId}>
                <td className="font-mono">{d.caseId}</td>
                <td>{d.severity}</td>
                <td>{d.base === null ? "not in suite" : VERDICT_WORD[d.base]}</td>
                <td>{d.target === null ? "not in suite" : VERDICT_WORD[d.target]}</td>
                <td>{DELTA_LABEL[d.category]}</td>
                <td>{d.cause ? DELTA_CAUSE_SHORT[d.cause] : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="hidden border-t border-line pt-3 text-xs leading-relaxed text-ink-soft print:mt-6 print:block">
        <p className="font-semibold text-ink">{REPORT_NOTICE_TITLE}</p>
        <p className="mt-1">{REPORT_NOTICE_SHORT}</p>
      </aside>
    </main>
  );
}

function RunCard({ role, run }: { role: "Base" | "Target"; run: LoadedRun }) {
  const band = run.grade.band;
  return (
    <section aria-label={`${role} run`} className="rounded-shell border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-eyebrow text-ink-faint">{role}</h2>
        <Link href={`/runs/${run.id}`} className="print-hide text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Open run →</Link>
      </div>
      <dl className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-ink-faint">Run</dt>
        <dd className="min-w-0 break-all font-mono text-xs leading-5">{run.id}</dd>
        <dt className="text-ink-faint">Executed</dt>
        <dd className="tnum">{utc(run.startedAt ?? run.createdAt)}{run.status === "aborted" ? " · stopped before the end" : ""}</dd>
        <dt className="text-ink-faint">Suite</dt>
        <dd>
          {run.suite.name} <span className="type-mono text-xs text-ink-soft">{run.suite.key} v{run.suite.version}</span>
          {run.suite.exploratory && <span className="block text-xs text-warning-text">Exploratory scan — not a sealed evaluation report</span>}
        </dd>
        <dt className="text-ink-faint">Policy</dt>
        <dd>{run.policyVersion === null ? "not recorded" : `v${run.policyVersion}`}</dd>
        <dt className="text-ink-faint">Grade</dt>
        <dd>
          <Badge tone={band === "INCOMPLETE" || band === "WITHHELD" ? "error" : band === "F" ? "fail" : "neutral"}>{band}</Badge>
          {run.grade.score !== null && <span className="ml-2 tnum text-ink-soft">{run.grade.score}%</span>}
        </dd>
        <dt className="text-ink-faint">Sealed report</dt>
        <dd className="min-w-0">
          {run.seal ? (
            <>
              <span className="block break-all font-mono text-xs leading-5">SHA-256 {run.seal.contentHash}</span>
              <span className="block text-xs text-ink-soft">sealed {utc(run.seal.createdAt)}{run.seal.revokedAt ? ` · withdrawn ${utc(run.seal.revokedAt)}` : ""}</span>
            </>
          ) : (
            <span className="text-ink-soft">Not sealed</span>
          )}
        </dd>
      </dl>
    </section>
  );
}
