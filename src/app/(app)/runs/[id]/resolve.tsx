"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner, SubmitButton } from "@/components/ui/button.tsx";
import { RefusableForm } from "@/components/ui/refusable-form.tsx";
import { completeRunEvidence } from "@/lib/workflow/completion-actions.ts";
import { Badge, Card } from "@/components/ui/primitives.tsx";
import { CATEGORIES } from "@/lib/evidence/diagnostics.ts";
import { completable, resolveOutcomes, resolveSummary, type ResolvePlan, type RetestRow } from "@/lib/evidence/resolve.ts";

/**
 * "Resolve no results": one button retests every no-result scenario whose diagnosis says a
 * retest is safe, one at a time through `/api/runs/[id]/resolve` (the single-scenario check,
 * never a run), and lists the one fix for each of the others. Progress is the stored retest
 * rows the route answers with, read through the same pure functions the tests use. When the
 * loop ends the page is handed back to the server, which renders each retest beside its case.
 *
 * Closing the page stops the loop; what was retested stays recorded.
 */
type Answer =
  | { ok: true; check: { id: string; verdict: string; words: string; detail: string | null; createdAt: string }; remaining: number; resetsAt: string }
  | { ok: false; code?: string; error: string; resetsAt?: string };

/** Between two retests: the diagnosis's own delay, capped so a person is not kept waiting a minute between scenarios. */
const MAX_GAP_MS = 15_000;

export function ResolveNoResults({ runId, plan, mayRetest, mayComplete = false }: {
  runId: string;
  plan: ResolvePlan;
  mayRetest: boolean;
  /** A sealed report exists and this person may start runs: a completion run can be offered (0083). */
  mayComplete?: boolean;
}) {
  const [since] = useState(() => new Date().toISOString());
  const [rows, setRows] = useState<RetestRow[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [halt, setHalt] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);
  const router = useRouter();

  const outcomes = resolveOutcomes(plan, rows, since);
  const total = plan.retestable.length + plan.fixFirst.length;
  // What a completion run may re-execute: the retest-safe scenarios, and the fix-first ones a
  // retest has since shown produce a verdict.
  const ready = completable(plan, rows);
  const reached = outcomes.filter((o) => o.verdict === "pass" || o.verdict === "fail").length
    + plan.fixFirst.filter((i) => i.fixedBy === "retest").length;

  const run = useCallback(async () => {
    setRunning(true);
    setHalt(null);
    setDone(false);
    cancelled.current = false;
    let first = true;
    for (const item of plan.retestable) {
      if (cancelled.current) break;
      if (!first) await new Promise((r) => setTimeout(r, Math.min(item.delayMs, MAX_GAP_MS)));
      first = false;
      setCurrent(item.runCaseId);
      let answer: Answer;
      try {
        // `redirect: "error"`: a redirect to the sign-in page must never read as success.
        const res = await fetch(`/api/runs/${runId}/resolve`, {
          method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runCaseId: item.runCaseId }),
        });
        answer = (await res.json().catch(() => ({ ok: false, error: `The retest could not be started (${res.status}).` }))) as Answer;
      } catch {
        answer = { ok: false, error: "The retest could not be started. Your session may have expired; sign in again and press the button once more." };
      }
      if (cancelled.current) break;
      if (answer.ok) {
        const { check } = answer;
        setRows((r) => [...r, { run_case_id: item.runCaseId, status: check.verdict === "pass" || check.verdict === "fail" ? check.verdict : "error", judge_agreement: check.verdict === "no_verdict" ? "unresolved" : null, rationale: check.detail, error: null, created_at: check.createdAt }]);
      } else {
        setFailures((f) => ({ ...f, [item.runCaseId]: answer.ok ? "" : answer.error }));
        if (!answer.ok && answer.code === "rate_limited") {
          setHalt(`${answer.error} The remaining scenarios can be retested then.`);
          break;
        }
        if (!answer.ok && !answer.code) {
          // No code means the request itself failed (session, network): nothing further will work either.
          setHalt(answer.error);
          break;
        }
      }
    }
    setCurrent(null);
    setRunning(false);
    setDone(true);
    router.refresh();
  }, [plan, runId, router]);

  return (
    <section id="resolve-no-results" aria-labelledby="resolve-no-results-heading" className="print-hide mt-4">
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="resolve-no-results-heading" className="type-h3">Resolve no results</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {total} scenario{total === 1 ? "" : "s"} produced no result.{" "}
            {plan.retestable.length > 0 && <>{plan.retestable.length} can be retested now, one at a time, against the agent as it is. </>}
            {plan.fixFirst.length > 0 && <>{plan.fixFirst.length} need{plan.fixFirst.length === 1 ? "s" : ""} a fix first; the fix is named beside each. </>}
            A retest is a single-scenario check: it is stored beside the scenario and never changes this report.
          </p>
        </div>
        {plan.retestable.length > 0 && mayRetest && (
          <Button type="button" size="sm" onClick={run} disabled={running}>
            {running && <Spinner />}
            {running ? "Retesting…" : done ? "Retest again" : `Retest ${plan.retestable.length} scenario${plan.retestable.length === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>

      {plan.retestable.length > 0 && (
        <ul className="mt-4 divide-y divide-line" aria-label="Scenarios to retest">
          {plan.retestable.map((item) => {
            const outcome = outcomes.find((o) => o.runCaseId === item.runCaseId);
            const failure = failures[item.runCaseId];
            const active = current === item.runCaseId;
            const tone = outcome?.verdict === "pass" ? "pass" : outcome?.verdict === "fail" ? "fail" : outcome?.verdict ? "error" : "neutral";
            return (
              <li key={item.runCaseId} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm">
                <span className="tnum font-medium text-ink">{item.scenarioId}</span>
                <span className="min-w-0 flex-1 text-ink-soft">
                  {item.headline}
                  <span className="block text-xs text-ink-faint">{CATEGORIES[item.category].name}</span>
                </span>
                <span className="flex items-center gap-2">
                  {active && <Spinner className="text-ink-faint" />}
                  {active ? (
                    <span className="text-ink-soft">Retesting…</span>
                  ) : failure ? (
                    <span className="text-fail-text">{failure}</span>
                  ) : outcome?.verdict ? (
                    <Badge tone={tone}>{outcome.words}</Badge>
                  ) : (
                    <span className="text-ink-faint">{done ? "Not retested" : "Waiting"}</span>
                  )}
                </span>
                {outcome?.detail && !active && <span className="basis-full text-xs text-ink-soft">{outcome.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {plan.fixFirst.length > 0 && (
        <div className="mt-4">
          <p className="type-pill text-ink-faint">Needs a fix or a check first</p>
          <ul className="mt-1.5 divide-y divide-line" aria-label="Scenarios that need a fix first">
            {plan.fixFirst.map((item) => (
              <li key={item.runCaseId} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="tnum font-medium text-ink">{item.scenarioId}</span>
                  <span className="min-w-0 flex-1 text-ink-soft">{item.headline}</span>
                  <span className="text-xs text-ink-faint">{CATEGORIES[item.category].name}</span>
                </div>
                <p className="mt-1 text-sm text-ink">
                  {item.step} <span className="text-ink-faint">({item.owner})</span>
                </p>
                {item.fixedBy === "retest"
                  ? <p className="mt-0.5 text-xs font-medium text-pass-text">
                      {item.mayHaveActed
                        ? "You retested this scenario since the run and it reached a verdict. It can be completed below, which sends it to your agent once more."
                        : "A retest since this run reached a verdict, so the cause was fixed. It can be completed below."}
                    </p>
                  : item.blocked && <p className="mt-0.5 text-xs text-ink-soft">{item.blocked}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {halt && <p role="alert" className="mt-4 text-sm text-fail-text">{halt}</p>}
      {done && !halt && <p role="status" className="mt-4 text-sm text-ink">{resolveSummary(outcomes, plan)}</p>}

      {mayComplete && ready.length > 0 && (
        <div className={`mt-5 rounded-control border p-4 ${reached > 0 ? "border-pass-border bg-pass-surface" : "border-line bg-ground/60"}`}>
          <p className="text-sm font-medium text-ink">
            {reached > 0
              ? `${reached} scenario${reached === 1 ? "" : "s"} now reach${reached === 1 ? "es" : ""} a verdict. Seal a completed report that includes ${reached === 1 ? "it" : "them"}.`
              : "Seal a completed report"}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            One press runs only {ready.length === 1 ? `scenario ${ready[0].scenarioId}` : `these ${ready.length} scenarios (${ready.map((i) => i.scenarioId).join(", ")})`} once more,
            against the same agent connection, policy version and suite, and seals a new report: every other verdict is carried from this run unchanged,
            the counts and grade are computed from both, and this report is named by its digest and stays sealed.
            The retest above is not what is sealed: a retest can be repeated, so the report takes the one execution declared for it. It uses one run.
          </p>
          {ready.some((i) => i.mayHaveActed) && (
            <p className="mt-1 text-sm text-ink-soft">
              {ready.filter((i) => i.mayHaveActed).map((i) => i.scenarioId).join(", ")} expect{ready.filter((i) => i.mayHaveActed).length === 1 ? "s" : ""} your agent to act, so this sends a request it may act on again.
              A pass there is recorded only when a read-only endpoint confirms the action; without one the new report can record a fail, or again no result.
            </p>
          )}
          <RefusableForm action={completeRunEvidence} className="mt-3">
            <input type="hidden" name="runId" value={runId} />
            {ready.map((item) => <input key={item.runCaseId} type="hidden" name="scenarioId" value={item.scenarioId} />)}
            <SubmitButton size="sm" pendingLabel="Starting…">
              Complete the evidence and seal a new report ({ready.length} scenario{ready.length === 1 ? "" : "s"})
            </SubmitButton>
          </RefusableForm>
        </div>
      )}
      {!mayRetest && plan.retestable.length > 0 && (
        <p className="mt-3 text-xs text-ink-faint">Your role in this workspace cannot retest; an owner, admin or operator can.</p>
      )}
    </Card>
    </section>
  );
}
