import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/primitives.tsx";
import { DELTA_CAUSE_SHORT, DELTA_CAUSE_SENTENCE, DELTA_LABEL, type DeltaCategory, type ScenarioDelta, type VerdictState } from "@/lib/evidence/compare.ts";
import type { ComparedCase } from "@/lib/evidence/comparison-loader.ts";
import { gradingNote } from "../[id]/grading-note.ts";

/**
 * One scenario of a comparison, as a native disclosure: its id, severity, what moved and why on
 * the summary line; both runs' evidence side by side when opened (stacked on a phone). Server
 * rendered, so it opens without JavaScript.
 */

export const CATEGORY_TONE: Record<DeltaCategory, BadgeTone> = {
  regressed: "fail",
  fixed: "pass",
  no_result_now: "error",
  verdict_moved_same_reply: "neutral",
  persistent_failure: "neutral",
  unchanged_pass: "neutral",
  result_again: "neutral",
  added: "neutral",
  retired: "neutral",
  redefined: "neutral",
};

export const VERDICT_WORD: Record<VerdictState, string> = { pass: "passed", fail: "failed", error: "no result", not_run: "not run" };
const VERDICT_TONE: Record<VerdictState, BadgeTone> = { pass: "pass", fail: "fail", error: "error", not_run: "error" };
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);

export function severityTone(severity: string): BadgeTone {
  return SEVERITIES.has(severity) ? (severity as BadgeTone) : "neutral";
}

/** "passed → failed", "added · passed", "retired · was failed". */
export function deltaWords(d: ScenarioDelta): string {
  if (d.base === null) return `added · ${d.target ? VERDICT_WORD[d.target] : "—"}`;
  if (d.target === null) return `retired · was ${VERDICT_WORD[d.base]}`;
  return `${VERDICT_WORD[d.base]} → ${VERDICT_WORD[d.target]}`;
}

export function ScenarioRow({ delta, base, target, labels, instability }: {
  delta: ScenarioDelta;
  base: ComparedCase | null;
  target: ComparedCase | null;
  labels: { base: string; target: string };
  /** Set when this scenario's verdict has moved before under one policy version. */
  instability: { passes: number; fails: number; runs: number; cause?: "graders" | "agent" } | null;
}) {
  const input = target?.input ?? base?.input ?? null;
  return (
    <li className="break-inside-avoid">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-ground sm:px-5 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
          <span className="type-mono text-xs text-ink">{delta.caseId}</span>
          <Badge tone={severityTone(delta.severity)}>{delta.severity}</Badge>
          <Badge tone={CATEGORY_TONE[delta.category]}>{DELTA_LABEL[delta.category]}</Badge>
          <span className="text-sm text-ink">{deltaWords(delta)}</span>
          {delta.cause && <span className="min-w-0 basis-full text-xs text-ink-soft sm:basis-auto">{DELTA_CAUSE_SHORT[delta.cause]}</span>}
        </summary>
        <div className="border-t border-line bg-ground px-4 py-4 sm:px-5">
          {delta.cause && <p className="text-sm text-ink">{DELTA_CAUSE_SENTENCE[delta.cause]}</p>}
          {delta.category === "redefined" && (
            <p className="text-sm text-ink">
              The two suite versions define this scenario differently, so it is a different test under the same id. Both
              verdicts are shown; neither is counted as fixed or broken.
            </p>
          )}
          {instability && (delta.category === "regressed" || delta.category === "fixed") && (
            <p className="mt-1 text-xs text-warning-text">
              Its verdict has moved before with the policy unchanged: passed {instability.passes} and failed {instability.fails} of{" "}
              {instability.runs} runs{instability.cause === "graders" ? ", on an identical reply — the graders moved, not the agent" : ""}.
            </p>
          )}
          {input && delta.category !== "redefined" && (
            <p className="mt-3 text-sm text-ink-soft">
              <span className="type-pill text-ink-faint">Scenario sent · </span>
              <span className="whitespace-pre-wrap text-ink">{input}</span>
            </p>
          )}
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Side heading={labels.base} c={base} absent={delta.base === null ? "Not in this run's suite." : null} showInput={delta.category === "redefined"} />
            <Side heading={labels.target} c={target} absent={delta.target === null ? "Not in this run's suite." : null} showInput={delta.category === "redefined"} />
          </div>
        </div>
      </details>
    </li>
  );
}

const quiet = "text-sm leading-relaxed text-ink-soft";

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <dt className="type-pill text-ink-faint">{title}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function Side({ heading, c, absent, showInput }: { heading: string; c: ComparedCase | null; absent: string | null; showInput: boolean }) {
  return (
    <section aria-label={heading} className="min-w-0 rounded-panel border border-line bg-surface p-4">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
        {heading}
        {c && <Badge tone={VERDICT_TONE[c.status]}>{VERDICT_WORD[c.status]}</Badge>}
      </h3>
      {absent ? (
        <p className={`mt-2 ${quiet}`}>{absent}</p>
      ) : !c ? (
        <p className={`mt-2 ${quiet}`}>Not run: the run ended before this scenario was recorded.</p>
      ) : (
        <dl className="mt-3 space-y-3">
          {showInput && (
            <Item title="Scenario sent">
              <p className="whitespace-pre-wrap text-sm text-ink">{c.input}</p>
            </Item>
          )}
          <Item title={c.turns ? `The agent's last reply (conversation of ${c.turns} ${c.turns === 1 ? "reply" : "replies"})` : "The agent's reply"}>
            {c.rawExpiredAt ? (
              <p className="rounded-control bg-sunken px-3 py-2 text-sm leading-relaxed text-ink-soft ring-1 ring-line">
                Emptied under the retention period on {c.rawExpiredAt.slice(0, 10)}. The verdict and its reasons are kept.
                {c.rawSha256 && (
                  <>
                    {" "}Fingerprint of the evidence as graded: <span className="break-all font-mono text-xs">{c.rawSha256}</span>
                  </>
                )}
              </p>
            ) : c.responseText ? (
              <p className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-control bg-surface px-3 py-2 text-sm leading-relaxed text-ink ring-1 ring-line">
                {c.responseText}
              </p>
            ) : (
              <p className={quiet}>No reply was recorded.</p>
            )}
          </Item>
          <Item title="Tool activity">
            {c.rawExpiredAt ? (
              <p className={quiet}>Emptied with the reply.</p>
            ) : c.trajectory.length ? (
              <ol className="flex flex-wrap gap-1.5">
                {c.trajectory.map((e) => (
                  <li key={e.sequence} className="rounded-control bg-sunken px-2 py-0.5 type-mono text-xs">
                    <span className={e.status === "failed" ? "text-fail-text" : "text-ink"}>{e.name ?? "(unnamed step)"}</span>
                    <span className="text-ink-faint"> · {e.status}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={quiet}>No tool activity was recorded.</p>
            )}
          </Item>
          <Item title="Read-back">
            <p className={c.observation?.status === "contradicted" ? "text-sm text-fail-text" : c.observation?.status === "confirmed" ? "text-sm text-pass-text" : quiet}>
              {c.observation
                ? `${c.observation.status === "confirmed" ? "Confirmed by reading your own system." : c.observation.status === "contradicted" ? "Your own system does not show this action." : "The read-back could not be completed."} ${c.observation.detail}`
                : "Nothing was read back from your own system."}
            </p>
          </Item>
          <Item title="How it was settled">
            <p className="text-sm text-ink-soft">
              {c.settledBy === "deterministic"
                ? "By the scenario's own rules; no model was asked."
                : c.settledBy === "read_back"
                  ? "By reading back your own system; no model was asked."
                  : c.judgeModel
                    ? gradingNote(c.judgeModel, c.judgeAgreement, c.judgeVotes)
                    : c.status === "error"
                      ? "No verdict was reached."
                      : "No grader was recorded."}
              {c.latencyMs !== null && <span className="tnum text-ink-faint"> · agent answered in {c.latencyMs} ms</span>}
            </p>
          </Item>
          {c.status === "fail" && (
            <Item title="Why it failed">
              {c.rationale && <p className="whitespace-pre-wrap text-sm text-ink">{c.rationale}</p>}
              {c.failedAssertions.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm text-fail-text">
                  {c.failedAssertions.map((a) => <li key={a}>✕ {a}</li>)}
                </ul>
              )}
              {!c.rationale && c.failedAssertions.length === 0 && <p className={quiet}>No reason was recorded.</p>}
            </Item>
          )}
          {c.status === "error" && (
            <Item title="Why there is no result">
              <p className="text-sm text-ink">{c.noResult ?? "No result was produced."}</p>
              {c.error && <p className="mt-1 text-sm text-ink-soft">{c.error}</p>}
            </Item>
          )}
        </dl>
      )}
    </section>
  );
}
