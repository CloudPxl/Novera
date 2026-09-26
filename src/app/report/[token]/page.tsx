import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obligationLabel, type ReportPayload } from "@/lib/report/payload.ts";
import { categoryMeta } from "@/lib/evidence/categories.ts";
import { loadReportByToken } from "@/lib/report/access.ts";
import { ReportToolbar } from "./toolbar.tsx";

export const dynamic = "force-dynamic";

/**
 * A grade is a claim, so its colour is not decoration.
 *
 * INCOMPLETE and WITHHELD are deliberately slate rather than red: a run without a grade
 * has not failed, and colouring it as a failure would be its own kind of false verdict.
 */
const GRADE_STYLES: Record<string, string> = {
  A: "border-pass-border bg-pass-surface text-pass-text",
  B: "border-info-border bg-info-surface text-info-text",
  C: "border-warning-border bg-warning-surface text-warning-text",
  F: "border-fail-border bg-fail-surface text-fail-text",
  // Not red — neither is a failing grade — but not quiet either. Drawn at the same size
  // and weight as a letter, amber like every other "no result", with a dashed edge that
  // reads as "something is missing". A grey footnote is how a partial run passes for a
  // clean one (docs/DESIGN.md).
  INCOMPLETE: "border-dashed border-warning-text bg-warning-surface text-warning-text",
  // The basis line beside it says which of the two happened and why.
  WITHHELD: "border-dashed border-warning-text bg-warning-surface text-warning-text",
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
    <main className="mx-auto w-full max-w-4xl bg-surface px-6 py-12 text-ink print:px-0 print:py-0 sm:px-8">
      <header className="border-b border-line pb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Novera · Agent evaluation report
          </p>
          <ReportToolbar token={token} />
        </div>
        {/* A report sealed from the scripted fixture says so at the same weight as the
            title — a polished document must never let test data pass for a real agent.
            Keyed on the environment the run recorded; no payload field is added. */}
        {/fixture/i.test(subject.environment) && (
          <p className="mt-4 inline-flex items-center rounded-control border-2 border-dashed border-warning-text bg-warning-surface px-3 py-1 text-sm font-bold uppercase tracking-wide text-warning-text">
            Test data · {subject.environment}
          </p>
        )}
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
          <div className="mb-5 flex flex-wrap items-center gap-5 rounded-xl border border-line bg-ground/60 p-5">
            <div
              className={`flex size-24 shrink-0 flex-col items-center justify-center rounded-xl border-2 ${GRADE_STYLES[payload.grade.band]}`}
            >
              {payload.grade.band === "INCOMPLETE" || payload.grade.band === "WITHHELD" ? (
                // The word is the grade. It used to be a dash with the word in 12px beneath.
                <span className="px-1 text-center text-[15px] font-bold uppercase leading-tight tracking-wide">
                  {payload.grade.band === "WITHHELD" ? "Withheld" : "Incomplete"}
                </span>
              ) : (
                <>
                  <span className="text-[38px] font-bold leading-none tracking-tight">{payload.grade.band}</span>
                  <span className="mt-1 text-xs font-semibold tabular-nums">
                    {payload.grade.score === null ? "" : `${payload.grade.score}%`}
                  </span>
                </>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm leading-relaxed ${payload.grade.band === "INCOMPLETE" || payload.grade.band === "WITHHELD" ? "font-medium text-ink" : "text-ink-soft"}`}
              >
                {payload.grade.basis}
              </p>
              {payload.grade.meets_threshold !== null && (
                <p className="mt-2 text-sm font-medium text-ink">
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
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">{coverage.basis}</p>

        {/* Format 6 onwards. The score says how the graded scenarios did; these say how
            much of the evaluation actually happened, which is a different question and
            the one a reviewer asks first. Absent on earlier payloads, where nothing
            measured them. A null here means the run carried nothing to compute it
            from — printed as "not recorded", never as 0% and never as 100%. */}
        {/* Format 9 onwards. The only line in the document that says an action
            happened, rather than that the agent said so. Absent on earlier payloads,
            where nothing could look. */}
        {coverage.effect_confirmed !== undefined &&
          (coverage.effect_confirmed > 0 || (coverage.effect_contradicted ?? 0) > 0) && (
          <p className="mt-3 rounded-lg border border-line bg-ground px-3 py-2 text-sm leading-relaxed text-ink-soft">
            {coverage.effect_confirmed > 0 && (
              <>
                <span className="font-medium">
                  {coverage.effect_confirmed} scenario(s) had the action they describe confirmed
                  by reading your own system, not by the agent&rsquo;s account of it.
                </span>{" "}
              </>
            )}
            {(coverage.effect_contradicted ?? 0) > 0 && (
              <>
                {coverage.effect_contradicted} described an action your system does not
                show, and failed on that basis rather than on the wording of the reply.
              </>
            )}
          </p>
        )}

        {coverage.execution_coverage !== undefined && (
          <dl className="mt-4 grid gap-3 rounded-lg border border-line bg-ground p-4 text-sm sm:grid-cols-3">
            <Coverage
              term="Executed"
              value={`${coverage.execution_coverage}%`}
              hint="of the scenarios in scope actually ran"
            />
            <Coverage
              term="Reasoned"
              value={coverage.resolution_coverage === null ? "not recorded" : `${coverage.resolution_coverage}%`}
              hint="of the requirements those scenarios carry have an accountable outcome"
            />
            <Coverage
              term="Evidenced"
              value={
                coverage.evidence_coverage === null
                  ? "none required"
                  : `${coverage.evidence_coverage}%`
              }
              hint="of the scenarios that asked for proof beyond the agent's words got it"
            />
          </dl>
        )}

        {/* Format 3 onwards. Absent on earlier payloads, so the whole block is, rather
            than printing a misleading zero for something that was never measured. */}
        {coverage.assurance_gap !== undefined && coverage.assurance_gap > 0 && (
          <p className="mt-3 rounded-lg border border-line bg-ground px-3 py-2 text-sm leading-relaxed text-ink-soft">
            <span className="font-medium">
              {coverage.assurance_gap}% of this evaluation produced no verdict.
            </span>{" "}
            That share is neither a pass nor a failure: it is the part of the suite this
            report cannot speak to.
            {coverage.disputed !== undefined && coverage.disputed > 0 && (
              <>
                {" "}
                {coverage.disputed} of those scenarios produced no verdict because two
                models disagreed and a third could not settle it. Novera records that
                rather than picking a side.
              </>
            )}
            {/* Format 5 onwards. Says something different again: the agent answered,
                the models read it, and nothing evidenced the action it described. */}
            {coverage.unverifiable !== undefined && coverage.unverifiable > 0 && (
              <>
                {" "}
                {coverage.unverifiable} expected the agent to perform an action, and
                nothing independent of the agent evidenced that it happened. A claimed
                action is not a verified one, so the pass was withheld.
              </>
            )}
          </p>
        )}
        {coverage.errored > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
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
          <p className="mb-4 text-sm leading-relaxed text-ink-soft">
            Each scenario exercises one area of the agent&rsquo;s behaviour. A category
            can read healthily on percentage alone while the one scenario that mattered
            is the one that failed, so a failed critical scenario is called out.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
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
                  <tr key={c.category} className="border-b border-line align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-ink">{meta.label}</span>
                      <span className="block text-xs leading-relaxed text-ink-faint">{meta.description}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{c.passed}</td>
                    <td className="py-2 text-right tabular-nums">{c.graded}</td>
                    <td className="py-2 pl-3">
                      {c.critical_failure ? (
                        <span className="font-medium text-fail-text">Critical scenario failed</span>
                      ) : c.graded === 0 ? (
                        <span className="text-ink-faint">Not covered</span>
                      ) : c.passed === c.graded ? (
                        <span className="text-pass-text">All passed</span>
                      ) : (
                        <span className="text-warning-text">Issues found</span>
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
        <p className="mb-4 text-sm leading-relaxed text-ink-soft">
          Each scenario evidences one obligation. <span className="font-medium">Met</span> means
          every scenario for that obligation passed;{" "}
          <span className="font-medium">issues found</span> means at least one failed or produced
          no result; <span className="font-medium">not covered</span> means nothing gradable ran —
          which is never the same as satisfied.
        </p>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-ground text-left text-xs uppercase tracking-wider text-ink-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">Obligation</th>
                <th className="px-3 py-2.5 text-right font-medium">Passed</th>
                <th className="px-3 py-2.5 text-right font-medium">Failed</th>
                <th className="px-3 py-2.5 text-right font-medium">Errored</th>
                <th className="px-4 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
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
          <p className="text-sm text-ink-soft">
            No scenario failed or errored in this run. That covers the listed scenarios only.
          </p>
        ) : (
          <ol className="space-y-4">
            {findings.map((f) => (
              <li
                key={f.case}
                className="break-inside-avoid rounded-lg border border-line p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityChip severity={f.severity} />
                  <span className="font-mono text-xs text-ink-faint">{f.case}</span>
                  <span className="text-sm font-medium">{obligationLabel(f.obligation)}</span>
                  {f.outcome === "error" && (
                    <span className="rounded bg-sunken px-1.5 py-0.5 text-xs font-medium text-ink-soft">
                      no result
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-relaxed">
                  <span className="font-medium text-ink-faint">Expected: </span>
                  {f.expected}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed">
                  <span className="font-medium text-ink-faint">Observed: </span>
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
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Baseline: run {comparison.baseline_run} on policy v{comparison.baseline_policy_version}.{" "}
            {comparison.note}
          </p>
          {/* Format 10. Absent on older reports, which made no claim either way, so
              nothing is rendered for them — not an "all stable" line they never made. */}
          {comparison.unstable && comparison.unstable.length > 0 && (
            <p className="mt-3 rounded-lg border border-warning-border bg-warning-surface p-3 text-sm leading-relaxed text-warning-text">
              {comparison.unstable.map((u) => u.case_id).join(", ")}{" "}
              {comparison.unstable.length === 1 ? "has" : "have"} passed and failed in earlier runs
              under a single policy version, so {comparison.unstable.length === 1 ? "its" : "their"}{" "}
              movement here is not, on its own, evidence that the change caused it. They remain
              in the lists above.
            </p>
          )}
        </Section>
      )}

      {/* Format 11, and only on a reissue. Absent on every report sealed at the end of a
          run, and nothing is rendered for those: they made no statement about review. */}
      {payload.human_review && (
        <Section title="Review by the tested party">
          <p className="text-sm leading-relaxed text-ink-soft">{payload.human_review.note}</p>
          <dl className="mt-4 space-y-2 text-sm text-ink-soft">
            <Line label="Reviewed by" value={payload.human_review.reviewed_by} />
            <Line
              label="Verdicts reviewed"
              value={`${payload.human_review.reviewed} — agreed with ${payload.human_review.agreed}, disagreed with ${payload.human_review.disagreed}${payload.human_review.resolved_gaps > 0 ? `, and gave a finding on ${payload.human_review.resolved_gaps} with no automated result` : ""}`}
            />
            <Line
              label="Their reading"
              value={`${payload.human_review.with_findings_applied.passed} passed, ${payload.human_review.with_findings_applied.failed} failed${payload.human_review.with_findings_applied.no_verdict > 0 ? `, ${payload.human_review.with_findings_applied.no_verdict} without a result` : ""} if their findings replaced the verdicts they dispute. Not a score.`}
            />
            <Line label="As of" value={`${payload.human_review.as_of.slice(0, 16).replace("T", " ")} UTC`} />
          </dl>
          {payload.human_review.findings.length > 0 && (
            <ol className="mt-4 space-y-3">
              {payload.human_review.findings.map((f) => (
                <li key={f.case_id} className="rounded-lg border border-line p-3 text-sm leading-relaxed">
                  <p className="font-medium">
                    <span className="font-mono text-xs text-ink-faint">{f.case_id}</span>{" "}
                    {f.verdict === "error"
                      ? `no automated result; the reviewer found it ${f.finding === "pass" ? "passed" : "failed"}`
                      : `graded ${f.verdict === "pass" ? "passed" : "failed"}; the reviewer found it ${f.finding === "pass" ? "passed" : "failed"}`}
                  </p>
                  <p className="mt-1 text-ink-soft">{f.note}</p>
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}

      <Section title="Scope and limitations">
        <p className="rounded-lg border border-line bg-ground p-4 text-sm leading-relaxed text-ink-soft">
          {payload.limitations}
        </p>
        <dl className="mt-4 space-y-2 text-sm text-ink-soft">
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
              {/* Absent on reports sealed before format 4, which did not record it.
                  Those reports keep their own wording rather than gaining a claim
                  their evidence was never checked for. */}
              {/* Format 8 onwards. A rule-settled verdict has no corroboration and
                  needed none, so it is stated separately rather than folded into a
                  count that implies models were consulted. */}
              {run.corroboration.settled_by_rule !== undefined && run.corroboration.settled_by_rule > 0 && (
                <Line
                  label="Settled without a model"
                  value={`${run.corroboration.settled_by_rule} scenario(s) were decided by a rule stated in the scenario — true or false about the transcript, and identical on any rerun.`}
                />
              )}
              {run.corroboration.independent !== undefined && (
                <Line
                  label="Independence"
                  value={
                    run.corroboration.single_vendor
                      ? `${run.corroboration.independent} verdict(s) corroborated by a second model from a different vendor; `
                        + `${run.corroboration.single_vendor} by a second model from the same vendor, because no other vendor was reachable.`
                      : `All ${run.corroboration.independent} corroborated verdict(s) were confirmed by a model from a different vendor.`
                  }
                />
              )}
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

      <footer className="mt-12 border-t border-line pt-6 text-sm text-ink-faint">
        <p className="leading-relaxed">
          This document is sealed with a SHA-256 digest of its evidence. If any figure or finding
          were altered, the digest below would no longer match the stored run.
        </p>
        <p className="mt-3 break-all font-mono text-xs text-ink-soft">{content_hash}</p>

        {/* Format 7 onwards, and null for runs started before the manifest existed.
            Two different claims: the digest above says the document was not edited,
            this one says the inputs were declared before the run produced any of
            them. Absent on earlier payloads rather than shown as missing. */}
        {run.manifest_hash && (
          <>
            <p className="mt-4 leading-relaxed">
              The scenarios, policy version, grading models and pass mark were recorded
              before this run executed, and sealed under the digest below. It is what
              rules out the inputs having been chosen once the answers were known.
            </p>
            <p className="mt-3 break-all font-mono text-xs text-ink-soft">{run.manifest_hash}</p>
          </>
        )}
        {payload.reissue && (
          <p className="mt-4 leading-relaxed">
            This report reissues an earlier report for the same run, to disclose review, whose digest was{" "}
            <span className="break-all font-mono text-xs text-ink-soft">{payload.reissue.of}</span>.
          </p>
        )}
        {run.previous_report_hash && (
          <p className="mt-4 leading-relaxed">
            This report follows an earlier one for the same agent, whose digest was{" "}
            <span className="break-all font-mono text-xs text-ink-soft">{run.previous_report_hash}</span>.
          </p>
        )}

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
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center bg-surface px-6 text-ink">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">Novera</p>
      <h1 className="mt-3 text-2xl font-semibold">{heading}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{explanation}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
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
    return <span className="font-medium text-warning-text">Not covered</span>;
  }
  if (obligation.failed > 0 || obligation.errored > 0) {
    return <span className="font-medium text-fail-text">Issues found</span>;
  }
  return <span className="font-medium text-pass-text">Met</span>;
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
      <dt className="text-xs uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className={`mt-1 ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="font-medium text-ink-faint">{label}:</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  );
}

const TONES = {
  pass: "border-pass-border bg-pass-surface text-pass-text",
  fail: "border-fail-border bg-fail-surface text-fail-text",
  error: "border-warning-border bg-warning-surface text-warning-text",
  muted: "border-line bg-ground text-ink-soft",
  score: "border-line-strong bg-surface text-ink",
} as const;

/** One of the three coverage numbers: what it is, and what it is a share of. */
function Coverage({ term, value, hint }: { term: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{term}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
      <dd className="mt-0.5 text-xs leading-snug text-ink-soft">{hint}</dd>
    </div>
  );
}

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
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wider">{label}</div>
    </div>
  );
}

/**
 * The semantic triads, not raw palette steps.
 *
 * `high` was `bg-orange-500 text-white`, which axe measures at 2.82:1 against a 4.5:1
 * floor — twelve times on this one page, and this is the page a stranger reads. The
 * other three passed, so the honest fix was not to patch one chip but to stop picking
 * colours at the call site: every token here is a text/surface/border set that was
 * chosen to carry words.
 */
const SEVERITY: Record<string, string> = {
  critical: "bg-fail-surface text-fail-text ring-1 ring-fail-border",
  high: "bg-high-surface text-high-text ring-1 ring-high-border",
  medium: "bg-warning-surface text-warning-text ring-1 ring-warning-border",
  low: "bg-neutral-surface text-neutral-text ring-1 ring-neutral-border",
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
      <dt className="text-xs font-medium uppercase tracking-wider">{label}</dt>
      <dd className="mt-1 font-mono text-sm">{ids.length ? ids.join(", ") : "none"}</dd>
    </div>
  );
}
