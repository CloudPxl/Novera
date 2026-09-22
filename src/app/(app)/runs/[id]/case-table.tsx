"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Badge, ProgressBar, inputClass } from "@/components/ui/primitives.tsx";
import { gradingNote } from "./grading-note.ts";

export interface CaseRow {
  id: string;
  caseId: string;
  category: string;
  categoryLabel: string;
  obligation: string;
  obligationLabel: string;
  severity: string;
  status: "pass" | "fail" | "error";
  input: string;
  expected: string;
  assertions: string[];
  failedAssertions: string[];
  responseText: string | null;
  rationale: string | null;
  error: string | null;
  judgeModel: string | null;
  judgeAgreement: string | null;
  latencyMs: number | null;
}

const VERDICTS = [
  { key: "all", label: "All" },
  { key: "fail", label: "Failed" },
  { key: "error", label: "No result" },
  { key: "pass", label: "Passed" },
] as const;

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

type Verdict = (typeof VERDICTS)[number]["key"];

const STATUS_TONE = { pass: "pass", fail: "fail", error: "error" } as const;
const STATUS_LABEL = { pass: "pass", fail: "fail", error: "no result" } as const;

/**
 * The run's evidence, filterable.
 *
 * Everything here filters over rows already fetched on the server — no endpoint, no
 * loading state, no chance of the matrix and the scorecard above it disagreeing about
 * what happened, which they would the moment counts came from two different queries.
 *
 * The one rule the filters obey: they never change a count that appears anywhere else.
 * The header says how many of the total are showing, so a filtered view can never be
 * mistaken for the run.
 */
export function CaseTable({
  cases,
  diagnosis = {},
}: {
  cases: CaseRow[];
  /** Per-case server-rendered diagnosis UI, keyed by run_case id. Filled in by the page. */
  diagnosis?: Record<string, ReactNode>;
}) {
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<Verdict>("all");
  const [category, setCategory] = useState("all");
  const [severities, setSeverities] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of cases) seen.set(c.category, c.categoryLabel);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cases]);

  const counts = useMemo(
    () => ({
      all: cases.length,
      pass: cases.filter((c) => c.status === "pass").length,
      fail: cases.filter((c) => c.status === "fail").length,
      error: cases.filter((c) => c.status === "error").length,
    }),
    [cases],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter((c) => {
      if (verdict !== "all" && c.status !== verdict) return false;
      if (category !== "all" && c.category !== category) return false;
      if (severities.length && !severities.includes(c.severity)) return false;
      if (!q) return true;
      return (
        c.caseId.toLowerCase().includes(q) ||
        c.input.toLowerCase().includes(q) ||
        c.obligationLabel.toLowerCase().includes(q) ||
        c.assertions.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [cases, query, verdict, category, severities]);

  function toggleSeverity(s: string) {
    setSeverities((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  const filtered = shown.length !== cases.length;

  return (
    <div>
      {/* ------------------------------------------------------------ controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <div className="flex w-full items-center gap-1 overflow-x-auto sm:w-auto" role="tablist" aria-label="Filter by verdict">
          {VERDICTS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={verdict === v.key}
              onClick={() => setVerdict(v.key)}
              className={`shrink-0 rounded-control px-2.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                verdict === v.key ? "bg-ink text-white" : "text-ink-soft hover:bg-sunken"
              }`}
            >
              {v.label} <span className="tnum font-normal">{counts[v.key]}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="case-search">Search scenarios</label>
          <input
            id="case-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search id, prompt or assertion"
            className={`${inputClass} w-full sm:w-64`}
          />
          <label className="sr-only" htmlFor="case-category">Filter by category</label>
          <select
            id="case-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${inputClass} w-full sm:w-44`}
          >
            <option value="all">All categories</option>
            {categories.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 py-3">
        <span className="type-pill mr-1 text-ink-faint">Severity</span>
        {SEVERITIES.map((s) => {
          const on = severities.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => toggleSeverity(s)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                on
                  ? "bg-ink text-white ring-ink"
                  : "bg-surface text-ink-soft ring-line-strong hover:bg-sunken"
              }`}
            >
              {s}
            </button>
          );
        })}

        <p aria-live="polite" className="ml-auto text-xs text-ink-soft">
          {filtered
            ? `Showing ${shown.length} of ${cases.length} scenarios`
            : `${cases.length} scenarios`}
        </p>
      </div>

      {/* --------------------------------------------------------------- rows */}
      <div className="hidden grid-cols-[6rem_1fr_9rem_6rem_1.5rem] gap-3 border-b border-line px-3 pb-2 md:grid">
        {["Verdict", "Scenario", "Category", "Severity", ""].map((h, i) => (
          <span key={i} className="type-pill text-ink-faint">{h}</span>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="px-3 py-10 text-center text-sm text-ink-soft">
          No scenario matches these filters. The run still contains {cases.length}.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((c) => {
            const open = expanded === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : c.id)}
                  className="w-full px-3 py-3 text-left transition-colors outline-none hover:bg-sunken focus-visible:bg-sunken md:grid md:grid-cols-[6rem_1fr_9rem_6rem_1.5rem] md:items-center md:gap-3"
                >
                  <span className="flex items-center gap-2 md:block">
                    <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    <span className="type-mono text-ink-faint md:hidden">{c.caseId}</span>
                  </span>

                  <span className="mt-1.5 block min-w-0 md:mt-0">
                    <span className="hidden type-mono text-xs text-ink-faint md:block">{c.caseId}</span>
                    <span className="block truncate text-sm text-ink">{c.input}</span>
                  </span>

                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5 md:mt-0 md:block">
                    <span className="text-xs text-ink-soft">{c.categoryLabel}</span>
                    <span className="md:hidden"><Badge tone={c.severity as "critical"}>{c.severity}</Badge></span>
                  </span>

                  <span className="hidden md:block">
                    <Badge tone={c.severity as "critical"}>{c.severity}</Badge>
                  </span>

                  <svg aria-hidden viewBox="0 0 12 12" className={`hidden size-3 text-ink-faint transition-transform md:block ${open ? "rotate-180" : ""}`}>
                    <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {open && <CaseDetail row={c} diagnosis={diagnosis[c.id]} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CaseDetail({ row, diagnosis }: { row: CaseRow; diagnosis?: ReactNode }) {
  const failed = new Set(row.failedAssertions);

  /* Which assertions failed has only been stored since migration 0011. A run from
     before it has an empty list, which is indistinguishable at the column level from
     "every assertion was met" — and drawing ten green ticks on a case the judge
     failed is a worse lie than drawing nothing. So a failure with no recorded
     assertions is shown as unassessed, with the reason stated. */
  const unrecorded = row.status === "fail" && row.failedAssertions.length === 0;
  const unassessed = row.status === "error" || unrecorded;

  return (
    <div className="novera-panel-in border-t border-line bg-ground px-3 py-4 sm:px-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h4 className="type-pill text-ink-faint">What the scenario sent</h4>
          <p className="mt-1.5 whitespace-pre-wrap rounded-control bg-surface px-3 py-2 text-sm leading-relaxed text-ink ring-1 ring-line">
            {row.input}
          </p>

          <h4 className="mt-4 type-pill text-ink-faint">What the agent replied</h4>
          {row.responseText ? (
            <p className="mt-1.5 whitespace-pre-wrap rounded-control bg-surface px-3 py-2 text-sm leading-relaxed text-ink ring-1 ring-line">
              {row.responseText}
            </p>
          ) : (
            <p className="mt-1.5 rounded-control bg-warning-surface px-3 py-2 text-sm leading-relaxed text-warning-text ring-1 ring-warning-border">
              {row.error ?? "No reply was recorded for this scenario."}
            </p>
          )}
        </section>

        <section>
          <h4 className="type-pill text-ink-faint">Assertions</h4>
          {row.assertions.length === 0 ? (
            <p className="mt-1.5 text-sm text-ink-soft">This scenario recorded no assertions.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {row.assertions.map((a, i) => {
                /* A case that errored produced no verdict on any assertion, so none of
                   them may be drawn as met. An unticked box is the honest mark. */
                const unmet = failed.has(a);
                const unknown = unassessed;
                return (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed">
                    <span
                      aria-hidden
                      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
                        unknown ? "bg-ink-faint" : unmet ? "bg-fail-text" : "bg-pass-text"
                      }`}
                    >
                      {unknown ? "?" : unmet ? "✕" : "✓"}
                    </span>
                    <span className={unknown ? "text-ink-soft" : unmet ? "text-fail-text" : "text-ink-soft"}>
                      {a}
                      <span className="sr-only">
                        {unknown ? " — not assessed" : unmet ? " — not met" : " — met"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {unrecorded && (
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              This run was graded before Novera recorded which individual assertions
              failed, so they are shown as unassessed. The judge&rsquo;s reasoning below
              is the evidence for the verdict.
            </p>
          )}

          {row.rationale && (
            <>
              <h4 className="mt-4 type-pill text-ink-faint">Why the judge decided that</h4>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{row.rationale}</p>
            </>
          )}

          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-faint">
            <div>
              <dt className="inline">Obligation: </dt>
              <dd className="inline text-ink-soft">{row.obligationLabel}</dd>
            </div>
            {row.latencyMs !== null && (
              <div>
                <dt className="inline">Agent latency: </dt>
                <dd className="inline tnum text-ink-soft">{row.latencyMs} ms</dd>
              </div>
            )}
          </dl>

          {row.judgeModel && (
            <p className="mt-2 type-mono text-xs text-ink-faint">
              {gradingNote(row.judgeModel, row.judgeAgreement)}
            </p>
          )}
        </section>
      </div>

      {diagnosis && <div className="mt-4 border-t border-line pt-4">{diagnosis}</div>}
    </div>
  );
}

/** A category's standing, as one card in the grid above the matrix. */
export function CategoryCard({
  label,
  description,
  passed,
  graded,
  planned,
  criticalFailure,
}: {
  label: string;
  description: string;
  passed: number;
  graded: number;
  planned: number;
  criticalFailure: boolean;
}) {
  const tone = criticalFailure ? "fail" : graded === 0 ? "neutral" : passed === graded ? "pass" : "warning";
  return (
    <div className="rounded-panel border border-line bg-surface p-4 shadow-card" title={description}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="type-h3 text-ink">{label}</h3>
        {criticalFailure && <Badge tone="critical">critical</Badge>}
      </div>
      <p className="mt-2 tnum text-2xl font-semibold text-ink">
        {passed}
        <span className="text-base font-normal text-ink-faint">/{graded || planned}</span>
      </p>
      <ProgressBar
        className="mt-2"
        value={passed}
        max={graded || planned}
        tone={tone}
        label={`${label}: ${passed} of ${graded || planned} passed`}
      />
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">{description}</p>
    </div>
  );
}
