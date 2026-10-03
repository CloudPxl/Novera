import Link from "next/link";
import { Badge } from "@/components/ui/primitives.tsx";
import { OBLIGATION_LABELS } from "@/lib/report/payload.ts";
import type { SuiteCase } from "@/lib/runner/types.ts";
import { describeCheck } from "@/lib/judge/checks.ts";

/**
 * Every scenario in one suite version, with what it takes to settle it and how it has
 * done — the scenarios that actually run, beside the drafts that might one day.
 *
 * Each column is a stored fact: the suite's frozen case, the draft it was promoted from
 * (if any), and the run rows of this suite version, newest first. History is drawn as
 * cells, oldest to newest, so a scenario that keeps failing reads as a row of red.
 */
export interface LibraryRun {
  id: string;
  createdAt: string;
  agentName: string;
  statuses: Map<string, "pass" | "fail" | "error">;
}

export interface LibraryOrigin {
  origin: "policy" | "import" | "production";
  approvedAt: string | null;
}

const ORIGIN_LABEL: Record<LibraryOrigin["origin"], string> = {
  policy: "Drafted from your policy",
  import: "Imported",
  production: "From a production failure",
};

const CELL = { pass: "bg-pass-surface border-pass-border", fail: "bg-fail-text border-fail-text", error: "bg-warning-surface border-warning-text border-dashed" } as const;
const WORD = { pass: "passed", fail: "failed", error: "no verdict" } as const;

/** What a scenario needs before it can be settled — the evidence contract, in words. */
function requirements(c: SuiteCase): string[] {
  const out: string[] = [];
  const rules = (c.checks?.length ?? 0) + (c.turn_checks?.reduce((n, t) => n + t.checks.length, 0) ?? 0);
  if (rules) out.push(`${rules} ${rules === 1 ? "rule" : "rules"}`);
  if (c.effect) out.push(c.effect.evidence === "state_confirmed" ? "read-back of your system" : "tool call on record");
  if (c.earlier_turns?.length) out.push(`${c.earlier_turns.length + 1}-turn conversation`);
  if (c.persona) out.push("simulated customer");
  if (c.context) out.push("metadata channel");
  out.push("graded by models");
  return out;
}

export function Library({
  suite, cases, runs, origins, builtIn,
}: {
  suite: { key: string; version: number; name: string };
  cases: SuiteCase[];
  runs: LibraryRun[];
  origins: Map<string, LibraryOrigin>;
  builtIn: boolean;
}) {
  const history = [...runs].reverse();
  return (
    <div className="mt-4 overflow-hidden rounded-shell border border-line bg-surface">
      <div className="hidden grid-cols-[4rem_minmax(0,2fr)_6rem_minmax(0,1.4fr)_minmax(0,1.2fr)_8.5rem] gap-3 border-b border-line bg-ground px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint lg:grid">
        <span>ID</span><span>Scenario · duty</span><span>Severity</span><span>Source</span><span>Last result</span><span>History</span>
      </div>
      <ul className="divide-y divide-line">
        {cases.map((c) => {
          const latest = runs.find((r) => r.statuses.has(c.id));
          const status = latest?.statuses.get(c.id);
          const cells = history.filter((r) => r.statuses.has(c.id));
          const streak = (() => { let n = 0; for (const r of runs) { if (r.statuses.get(c.id) === "fail") n++; else if (r.statuses.has(c.id)) break; } return n; })();
          const origin = origins.get(c.id);
          return (
            <li key={c.id}>
              {/* The row is the summary; the scenario's full contract opens beneath it. */}
              <details className="group">
                <summary className="grid cursor-pointer list-none gap-x-3 gap-y-1.5 px-5 py-3 text-sm transition-colors hover:bg-ground lg:grid-cols-[4rem_minmax(0,2fr)_6rem_minmax(0,1.4fr)_minmax(0,1.2fr)_8.5rem] lg:items-center [&::-webkit-details-marker]:hidden">
                  <span className="type-mono text-xs text-ink-faint">{c.id}</span>
                  <span className="min-w-0">
                    <span className="block font-medium">{OBLIGATION_LABELS[c.obligation] ?? c.obligation}</span>
                    {c.duty_refs?.length ? <span className="block truncate text-[11px] text-ink-faint">{c.duty_refs.join(" · ")}</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-1"><Badge tone={c.severity as "critical"}>{c.severity}</Badge></span>
                  <span className="text-xs text-ink-soft">{origin ? ORIGIN_LABEL[origin.origin] : builtIn ? "Built-in" : "This workspace"}{origin ? " · approved" : ""}</span>
                  <span className="text-xs">
                    {latest && status ? (
                      <span className={status === "pass" ? "font-medium text-pass-text" : status === "fail" ? "font-medium text-fail-text" : "font-medium text-warning-text"}>{WORD[status]}<span className="font-normal text-ink-faint"> · {latest.createdAt.slice(0, 10)}</span></span>
                    ) : <span className="text-ink-faint">Not run yet</span>}
                    {streak >= 2 && <span className="block font-medium text-fail-text">Recurring — {streak} runs</span>}
                  </span>
                  <span aria-hidden className="flex items-center gap-1">
                    {cells.map((r) => <span key={r.id} className={`size-3.5 rounded-[3px] border ${CELL[r.statuses.get(c.id)!]}`} />)}
                    {cells.length === 0 && <span className="text-xs text-ink-faint">—</span>}
                  </span>
                  <span className="sr-only">{cells.length ? `History, oldest first: ${cells.map((r) => WORD[r.statuses.get(c.id)!]).join(", ")}` : "No history"}. Open for the scenario&apos;s details.</span>
                </summary>
                <div className="grid gap-5 border-t border-line bg-ground px-5 py-4 text-sm lg:grid-cols-2">
                  <dl className="space-y-3">
                    <div><dt className="text-xs font-medium text-ink-faint">What the customer sends</dt><dd className="mt-1 whitespace-pre-wrap">{c.input}</dd></div>
                    <div><dt className="text-xs font-medium text-ink-faint">What the agent must do</dt><dd className="mt-1">{c.expected_behavior}</dd></div>
                    <div>
                      <dt className="text-xs font-medium text-ink-faint">What has to hold</dt>
                      <dd className="mt-1"><ul className="list-disc space-y-0.5 pl-4">{(c.assertions ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></dd>
                    </div>
                  </dl>
                  <dl className="space-y-3">
                    <div><dt className="text-xs font-medium text-ink-faint">To settle it</dt><dd className="mt-1">{requirements(c).join(" · ")}</dd></div>
                    {c.checks?.length ? (
                      <div><dt className="text-xs font-medium text-ink-faint">Rules that fail it outright</dt><dd className="mt-1"><ul className="list-disc space-y-0.5 pl-4">{c.checks.map((k, i) => <li key={i}>{describeCheck(k)}</li>)}</ul></dd></div>
                    ) : null}
                    {c.effect ? <div><dt className="text-xs font-medium text-ink-faint">What must actually change</dt><dd className="mt-1">{c.effect.describe} <span className="text-ink-faint">(proved by {c.effect.evidence === "state_confirmed" ? "reading your own system" : "recorded tool activity"})</span></dd></div> : null}
                    <div>
                      <dt className="text-xs font-medium text-ink-faint">Source</dt>
                      <dd className="mt-1">
                        {origin ? <>{origin.origin === "production" ? <Link href="/regressions" className="underline underline-offset-2">{ORIGIN_LABEL.production}</Link> : ORIGIN_LABEL[origin.origin]} — approved{origin.approvedAt ? ` ${origin.approvedAt.slice(0, 10)}` : ""}, then promoted into {suite.key} v{suite.version}</>
                          : builtIn ? <>Novera&apos;s built-in suite, frozen in {suite.key} v{suite.version}</> : <>Written into this suite, frozen in v{suite.version}</>}
                      </dd>
                    </div>
                    {cells.length > 0 && (
                      <div>
                        <dt className="text-xs font-medium text-ink-faint">Results here, newest first</dt>
                        <dd className="mt-1"><ul className="space-y-0.5">{[...cells].reverse().map((r) => <li key={r.id}><Link href={`/runs/${r.id}?case=${encodeURIComponent(c.id)}`} className="underline-offset-2 hover:underline">{r.createdAt.slice(0, 10)} · {r.agentName} · {WORD[r.statuses.get(c.id)!]}</Link></li>)}</ul></dd>
                      </div>
                    )}
                  </dl>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
