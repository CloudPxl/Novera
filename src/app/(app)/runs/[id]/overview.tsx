import Link from "next/link";
import { Badge } from "@/components/ui/primitives.tsx";
import { Panel, Rows } from "@/components/ui/page.tsx";
import type { Readiness } from "@/lib/report/readiness.ts";

const STATUS = { pass: { tone: "pass", word: "passed" }, fail: { tone: "fail", word: "failed" }, error: { tone: "error", word: "no result" } } as const;

/**
 * A run's Overview tab: whether its report can be sent, what failed or has no result (worst
 * first, five shown), and what changed against its baseline. Each line opens the place where it
 * is investigated; the evidence itself is one tab away, never here.
 */
export function RunOverview({ runId, readiness, findings, comparison, canCompare, undecided }: {
  runId: string;
  readiness: { label: string; state: Readiness; gap: string | null } | null;
  findings: Array<{ caseId: string; status: "pass" | "fail" | "error"; severity: string; title: string; category: string }>;
  comparison: { fixed: number; newFailures: number; persistentFailures: number; nowErrored: number } | null;
  canCompare: boolean;
  undecided: number;
}) {
  const ready = readiness?.state === "READY_TO_SHARE";
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
      <section aria-labelledby="ov-findings">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="ov-findings" className="type-h2">What needs a look</h2>
          {findings.length > 5 && <Link href={`/runs/${runId}?tab=cases`} className="text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">All {findings.length} →</Link>}
        </div>
        {findings.length === 0 ? (
          <p className="mt-3 rounded-shell border border-line bg-surface px-5 py-4 text-sm text-ink-soft">Every scenario passed.</p>
        ) : (
          <Panel className="mt-3">
            <Rows label="Failed and no-result scenarios">
              {findings.slice(0, 5).map((f) => (
                <li key={f.caseId}>
                  <Link href={`/runs/${runId}?tab=cases&case=${encodeURIComponent(f.caseId)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-ground">
                    <Badge tone={STATUS[f.status].tone}>{STATUS[f.status].word}</Badge>
                    <Badge tone={f.severity as "critical"}>{f.severity}</Badge>
                    <span className="type-mono text-xs text-ink-faint">{f.caseId}</span>
                    <span className="min-w-0 flex-1 text-sm font-medium">{f.title}</span>
                    <span className="text-xs text-ink-faint">{f.category}</span>
                  </Link>
                </li>
              ))}
            </Rows>
          </Panel>
        )}
        {undecided > 0 && (
          <p className="mt-3 text-sm text-warning-text">{undecided} proposed policy change{undecided === 1 ? "" : "s"} waiting for a decision — open the scenario to decide.</p>
        )}
      </section>

      <div className="space-y-6">
        <section aria-labelledby="ov-ready">
          <h2 id="ov-ready" className="type-h2">The report</h2>
          <div className="mt-3 rounded-shell border border-line bg-surface px-5 py-4">
            {readiness ? (
              <>
                <Badge tone={ready ? "pass" : readiness.state === "REVOKED" || readiness.state === "EXPIRED" ? "neutral" : "error"}>{readiness.label}</Badge>
                {readiness.gap && <p className="mt-2 text-sm text-ink-soft">{readiness.gap}</p>}
                <Link href={`/runs/${runId}?tab=evidence`} className="mt-2 inline-block text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Every check, and withdrawal →</Link>
              </>
            ) : (
              <p className="text-sm text-ink-soft">No report was sealed for this run.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="ov-changed">
          <h2 id="ov-changed" className="type-h2">What changed</h2>
          <div className="mt-3 rounded-shell border border-line bg-surface px-5 py-4 text-sm">
            {comparison ? (
              <>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <li><span className={`font-semibold tnum ${comparison.fixed ? "text-pass-text" : ""}`}>{comparison.fixed}</span> fixed</li>
                  <li><span className={`font-semibold tnum ${comparison.newFailures ? "text-fail-text" : ""}`}>{comparison.newFailures}</span> newly broken</li>
                  <li><span className="font-semibold tnum">{comparison.persistentFailures}</span> still failing</li>
                  <li><span className={`font-semibold tnum ${comparison.nowErrored ? "text-warning-text" : ""}`}>{comparison.nowErrored}</span> no result this time</li>
                </ul>
                <Link href={`/runs/${runId}?tab=comparison`} className="mt-3 inline-block font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Why each one moved →</Link>
              </>
            ) : (
              <p className="text-ink-soft">
                Not compared with an earlier run.{" "}
                {canCompare && <Link href={`/runs/${runId}?tab=comparison`} className="font-medium underline underline-offset-2">Choose a baseline</Link>}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Everything that happened to the run, newest first, from its stored rows. */
export function RunActivity({ events }: { events: Array<{ at: string; text: string }> }) {
  const sorted = [...events].filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Panel>
      <ol aria-label="Run activity" className="divide-y divide-line">
        {sorted.map((e, i) => (
          <li key={`${e.at}-${i}`} className="grid gap-1 px-5 py-2.5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
            <time dateTime={e.at} className="tnum text-xs text-ink-faint">{e.at.slice(0, 16).replace("T", " ")} UTC</time>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
