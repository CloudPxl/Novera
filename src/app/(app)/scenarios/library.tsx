import Link from "next/link";
import { Badge } from "@/components/ui/primitives.tsx";
import { OBLIGATION_LABELS } from "@/lib/report/payload.ts";
import type { SuiteCase } from "@/lib/runner/types.ts";

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
    <div className="mt-4 overflow-hidden rounded-shell border border-line bg-surface shadow-card">
      <div className="hidden grid-cols-[4rem_minmax(0,1.6fr)_5.5rem_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_8.5rem] gap-3 border-b border-line bg-ground px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint lg:grid">
        <span>ID</span><span>Scenario · duty</span><span>Severity</span><span>To settle it</span><span>Source · approval</span><span>Last result</span><span>History</span>
      </div>
      <ul className="divide-y divide-line">
        {cases.map((c) => {
          const latest = runs.find((r) => r.statuses.has(c.id));
          const status = latest?.statuses.get(c.id);
          const cells = history.filter((r) => r.statuses.has(c.id));
          const streak = (() => { let n = 0; for (const r of runs) { if (r.statuses.get(c.id) === "fail") n++; else if (r.statuses.has(c.id)) break; } return n; })();
          const origin = origins.get(c.id);
          return (
            <li key={c.id} className="grid gap-x-3 gap-y-2 px-4 py-3 text-sm lg:grid-cols-[4rem_minmax(0,1.6fr)_5.5rem_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_8.5rem] lg:items-center">
              <span className="type-mono text-xs text-ink-faint">{c.id}</span>
              <div className="min-w-0">
                <p className="font-medium">{OBLIGATION_LABELS[c.obligation] ?? c.obligation}</p>
                <p className="truncate text-xs text-ink-soft" title={c.expected_behavior}>{c.expected_behavior}</p>
                {c.duty_refs?.length ? <p className="mt-0.5 text-[11px] text-ink-faint">{c.duty_refs.join(" · ")}</p> : null}
              </div>
              <span className="flex flex-wrap gap-1">
                <Badge tone={c.severity as "critical"}>{c.severity}</Badge>
                {c.destructive && <Badge tone="critical">destructive</Badge>}
                {c.fixture_only && <Badge tone="medium">test data</Badge>}
              </span>
              <p className="text-xs leading-relaxed text-ink-soft">{requirements(c).join(" · ")}</p>
              <p className="text-xs leading-relaxed text-ink-soft">
                {origin ? (
                  <>
                    {origin.origin === "production" ? <Link href="/regressions" className="underline underline-offset-2">{ORIGIN_LABEL.production}</Link> : ORIGIN_LABEL[origin.origin]}
                    <span className="block text-ink-faint">Approved{origin.approvedAt ? ` ${origin.approvedAt.slice(0, 10)}` : ""}, then promoted</span>
                  </>
                ) : builtIn ? (
                  <>Novera&apos;s built-in suite<span className="block text-ink-faint">Published, frozen in {suite.key} v{suite.version}</span></>
                ) : (
                  <>Written into this suite<span className="block text-ink-faint">Frozen in v{suite.version}</span></>
                )}
              </p>
              <div className="text-xs">
                {latest && status ? (
                  <Link href={`/runs/${latest.id}?case=${encodeURIComponent(c.id)}`} className="underline-offset-2 hover:underline">
                    <span className={status === "pass" ? "font-medium text-pass-text" : status === "fail" ? "font-medium text-fail-text" : "font-medium text-warning-text"}>{WORD[status]}</span>
                    <span className="text-ink-faint"> · {latest.createdAt.slice(0, 10)} · {latest.agentName}</span>
                  </Link>
                ) : <span className="text-ink-faint">Not run yet</span>}
                {streak >= 2 && <span className="mt-0.5 block font-medium text-fail-text">Recurring — {streak} runs in a row</span>}
              </div>
              <ol aria-label={cells.length ? `${c.id}: ${cells.map((r) => WORD[r.statuses.get(c.id)!]).join(", ")}, oldest first` : `${c.id}: no runs`} className="flex gap-1">
                {cells.map((r) => (
                  <li key={r.id} title={`${r.createdAt.slice(0, 10)} · ${r.agentName} · ${WORD[r.statuses.get(c.id)!]}`} className={`size-3.5 rounded-[3px] border ${CELL[r.statuses.get(c.id)!]}`} />
                ))}
                {cells.length === 0 && <li className="text-xs text-ink-faint">—</li>}
              </ol>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
