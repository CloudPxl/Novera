import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obligationLabel, type ReportPayload } from "@/lib/report/payload.ts";
import { categoryMeta } from "@/lib/evidence/categories.ts";
import { loadReportByToken } from "@/lib/report/access.ts";

export const dynamic = "force-dynamic";

/**
 * A grade is a claim, so its colour is not decoration.
 *
 * INCOMPLETE is deliberately slate rather than red: a run that did not fully execute
 * has not failed, and colouring it as a failure would be its own kind of false verdict.
 */
const GRADE_STYLES: Record<string, string> = {
  A: "border-emerald-500 bg-emerald-50 text-emerald-700",
  B: "border-blue-500 bg-blue-50 text-blue-700",
  C: "border-amber-500 bg-amber-50 text-amber-700",
  F: "border-rose-500 bg-rose-50 text-rose-700",
  INCOMPLETE: "border-slate-300 bg-slate-100 text-slate-600",
};

export const metadata: Metadata = {
  title: "Agent evaluation report",
  // A shared report must not be indexed: the link is the access control.
  robots: { index: false, follow: false },
};

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await loadReportByToken(token);

  if (result === null) notFound();
  if (result === "expired" || result === "revoked") return <Unavailable reason={result} />;

  const { payload, content_hash, expires_at } = result;
  const { subject, run, coverage, obligations, findings, comparison } = payload;

  return (
    <main className="mx-auto w-full max-w-4xl bg-white px-6 py-12 text-slate-900 print:px-0 print:py-0 sm:px-8">
      <header className="border-b border-slate-200 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Novera · Agent evaluation report
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{subject.client}</h1>
        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
          <Field label="Agent" value={subject.agent} />
          <Field label="Policy version" value={`v${subject.policy_version}`} />
          <Field label="Run date" value={run.date} />
          <Field label="Scenario suite" value={run.suite} />
          <Field label="Environment" value={subject.environment} />
          <Field label="Run reference" value={run.id} mono />
        </dl>
      </header>

      <Section title="Coverage">
        {payload.grade && (
          <div className="mb-5 flex flex-wrap items-center gap-5 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
            <div
              className={`flex size-24 shrink-0 flex-col items-center justify-center rounded-xl border-2 ${GRADE_STYLES[payload.grade.band]}`}
            >
              <span className="text-[38px] font-bold leading-none tracking-tight">
                {payload.grade.band === "INCOMPLETE" ? "—" : payload.grade.band}
              </span>
              <span className="mt-1 text-xs font-semibold tabular-nums">
                {payload.grade.score === null ? "incomplete" : `${payload.grade.score}%`}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed text-slate-700">{payload.grade.basis}</p>
              {payload.grade.meets_threshold !== null && (
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {payload.grade.meets_threshold
                    ? `Meets the ${payload.grade.threshold}% pass mark set for this evaluation.`
                    : `Below the ${payload.grade.threshold}% pass mark set for this evaluation.`}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Passed" value={coverage.passed} tone="pass" />
          <Stat label="Failed" value={coverage.failed} tone="fail" />
          <Stat label="Errored" value={coverage.errored} tone="error" />
          <Stat label="Not run" value={coverage.not_run} tone="muted" />
          <Stat
            label="Score"
            value={coverage.score === null ? "—" : `${coverage.score}%`}
            tone="score"
          />
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{coverage.basis}</p>
        {coverage.errored > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Errored scenarios produced no gradable result and are excluded from the score. They are
            listed among the findings below.
          </p>
        )}
      </Section>

      {/* Format 2 seals a per-category breakdown. Reports sealed before it have
          none, so the whole section is absent rather than empty — the same rule
          that the corroboration block already follows. */}
      {payload.categories && payload.categories.length > 0 && (
        <Section title="What was tested">
          <p className="mb-4 text-sm leading-relaxed text-slate-600">
            Each scenario exercises one area of the agent&rsquo;s behaviour. A category
            can read healthily on percentage alone while the one scenario that mattered
            is the one that failed, so a failed critical scenario is called out.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 font-medium">Area</th>
                <th className="py-2 text-right font-medium">Passed</th>
                <th className="py-2 text-right font-medium">Graded</th>
                <th className="py-2 pl-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {payload.categories.map((c) => {
                const meta = categoryMeta(c.category);
                return (
                  <tr key={c.category} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-slate-900">{meta.label}</span>
                      <span className="block text-xs leading-relaxed text-slate-500">{meta.description}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{c.passed}</td>
                    <td className="py-2 text-right tabular-nums">{c.graded}</td>
                    <td className="py-2 pl-3">
                      {c.critical_failure ? (
                        <span className="font-medium text-rose-700">Critical scenario failed</span>
                      ) : c.graded === 0 ? (
                        <span className="text-slate-500">Not covered</span>
                      ) : c.passed === c.graded ? (
                        <span className="text-emerald-700">All passed</span>
                      ) : (
                        <span className="text-amber-700">Issues found</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Obligation coverage">
        <p className="mb-4 text-sm leading-relaxed text-slate-600">
          Each scenario evidences one obligation. <span className="font-medium">Met</span> means
          every scenario for that obligation passed;{" "}
          <span className="font-medium">issues found</span> means at least one failed or produced
          no result; <span className="font-medium">not covered</span> means nothing gradable ran —
          which is never the same as satisfied.
        </p>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Obligation</th>
                <th className="px-3 py-2.5 text-right font-medium">Passed</th>
                <th className="px-3 py-2.5 text-right font-medium">Failed</th>
                <th className="px-3 py-2.5 text-right font-medium">Errored</th>
                <th className="px-4 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {obligations.map((o) => (
                <tr key={o.code}>
                  <td className="px-4 py-2.5 font-medium">{obligationLabel(o.code)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.passed}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.failed}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.errored}</td>
                  <td className="px-4 py-2.5 text-right">
                    <ObligationStatus obligation={o} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`Findings (${findings.length})`}>
        {findings.length === 0 ? (
          <p className="text-sm text-slate-600">
            No scenario failed or errored in this run. That covers the listed scenarios only.
          </p>
        ) : (
          <ol className="space-y-4">
            {findings.map((f) => (
              <li
                key={f.case}
                className="break-inside-avoid rounded-lg border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityChip severity={f.severity} />
                  <span className="font-mono text-xs text-slate-500">{f.case}</span>
                  <span className="text-sm font-medium">{obligationLabel(f.obligation)}</span>
                  {f.outcome === "error" && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                      no result
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-relaxed">
                  <span className="font-medium text-slate-500">Expected: </span>
                  {f.expected}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed">
                  <span className="font-medium text-slate-500">Observed: </span>
                  {f.observed}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {comparison && (
        <Section title="Compared with the previous run">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Compare label="Fixed" ids={comparison.fixed} tone="pass" />
            <Compare label="Still failing" ids={comparison.persistent_failures} tone="fail" />
            <Compare label="Newly failing" ids={comparison.new_failures} tone="fail" />
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            Baseline: run {comparison.baseline_run} on policy v{comparison.baseline_policy_version}.{" "}
            {comparison.note}
          </p>
        </Section>
      )}

      <Section title="Scope and limitations">
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          {payload.limitations}
        </p>
        <dl className="mt-4 space-y-2 text-sm text-slate-600">
          <Line label="Authorisation" value={subject.authorisation} />
          <Line label="Graded by" value={run.graded_by?.join(", ") || "not recorded"} />
          {/*
            A sealed report is rendered from the payload it was sealed with, and older
            payloads predate fields that were added later. Reading them unconditionally
            is how a link already in a client's hands starts returning 500 — which is
            exactly what happened to the first two reports this product ever issued.
            Every optional field is therefore read defensively, and a report that was
            sealed before a field existed says so rather than inventing a value.
          */}
          {run.corroboration ? (
            <>
              <Line label="How verdicts were reached" value={run.corroboration.method} />
              <Line
                label="Corroboration"
                value={[
                  `${run.corroboration.agreed} agreed on first reading`,
                  ...(run.corroboration.majority > 0
                    ? [`${run.corroboration.majority} settled by a third model`]
                    : []),
                  ...(run.corroboration.uncorroborated > 0
                    ? [`${run.corroboration.uncorroborated} graded by one model only`]
                    : []),
                  ...(run.corroboration.unresolved > 0
                    ? [`${run.corroboration.unresolved} left unresolved and excluded from the score`]
                    : []),
                ].join("; ")}
              />
            </>
          ) : (
            <Line
              label="How verdicts were reached"
              value="This report was sealed before Novera recorded corroboration, so each verdict came from a single model. Later reports state how many models agreed."
            />
          )}
          {run.graded_uniformly === false && (
            <Line
              label="Grading"
              value="More than one model graded this run. See the note above."
            />
          )}
        </dl>
      </Section>

      <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
        <p className="leading-relaxed">
          This document is sealed with a SHA-256 digest of its evidence. If any figure or finding
          were altered, the digest below would no longer match the stored run.
        </p>
        <p className="mt-3 break-all font-mono text-xs text-slate-700">{content_hash}</p>
        <p className="mt-3">
          Access to this link expires on {new Date(expires_at).toISOString().slice(0, 10)}.
        </p>
      </footer>
    </main>
  );
}

function Unavailable({ reason }: { reason: "expired" | "revoked" }) {
  // Built as whole strings rather than interpolated fragments: React would otherwise
  // split the sentence with a comment marker, which breaks text matching and makes
  // the copy harder to translate later.
  const heading =
    reason === "expired"
      ? "This report is no longer available"
      : "This report is no longer shared";
  const explanation =
    reason === "expired"
      ? "The link has expired. Reports expire so that evidence about an agent cannot be circulated long after it stopped describing that agent."
      : "The organisation that issued this report has withdrawn the link.";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center bg-white px-6 text-slate-900">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Novera</p>
      <h1 className="mt-3 text-2xl font-semibold">{heading}</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{explanation}</p>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Ask whoever sent it to you for a current report.
      </p>
    </main>
  );
}

/**
 * "Covered" alone is misleading: an obligation can be covered and failing, and a
 * reader scanning this column needs to see the difference at a glance. Three states,
 * not two.
 */
function ObligationStatus({
  obligation,
}: {
  obligation: ReportPayload["obligations"][number];
}) {
  if (!obligation.covered) {
    return <span className="font-medium text-amber-700">Not covered</span>;
  }
  if (obligation.failed > 0 || obligation.errored > 0) {
    return <span className="font-medium text-rose-700">Issues found</span>;
  }
  return <span className="font-medium text-emerald-700">Met</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 break-inside-avoid">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-1 ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="font-medium text-slate-500">{label}:</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  );
}

const TONES = {
  pass: "border-emerald-200 bg-emerald-50 text-emerald-900",
  fail: "border-rose-200 bg-rose-50 text-rose-900",
  error: "border-amber-200 bg-amber-50 text-amber-900",
  muted: "border-slate-200 bg-slate-50 text-slate-700",
  score: "border-slate-300 bg-white text-slate-900",
} as const;

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: keyof typeof TONES;
}) {
  return (
    <div className={`rounded-lg border p-3 ${TONES[tone]}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wider opacity-70">{label}</div>
    </div>
  );
}

const SEVERITY: Record<string, string> = {
  critical: "bg-rose-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-amber-950",
  low: "bg-slate-200 text-slate-700",
};

function SeverityChip({ severity }: { severity: string }) {
  const key = severity.toLowerCase();
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
        SEVERITY[key] ?? SEVERITY.low
      }`}
    >
      {severity}
    </span>
  );
}

function Compare({ label, ids, tone }: { label: string; ids: string[]; tone: "pass" | "fail" }) {
  return (
    <div className={`rounded-lg border p-3 ${ids.length ? TONES[tone] : TONES.muted}`}>
      <dt className="text-xs uppercase tracking-wider opacity-70">{label}</dt>
      <dd className="mt-1 font-mono text-sm">{ids.length ? ids.join(", ") : "none"}</dd>
    </div>
  );
}
