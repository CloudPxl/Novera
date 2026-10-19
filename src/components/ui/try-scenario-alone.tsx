"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/primitives.tsx";
import { checkScenarioAlone } from "@/lib/workflow/scenario-check-actions.ts";
import { CHECK_LABEL, verdictWords } from "@/lib/checks/single.ts";
import type { ScenarioCheckState } from "@/lib/checks/state.ts";

/** A scenario of a stored run, or a scenario of a suite sent to a chosen agent. */
export type TryScenarioTarget =
  | { runCaseId: string }
  | { agentId: string; suiteId: string; scenarioId: string; locale?: "en" | "de" | "fr" | "ro" };

/**
 * "Try this scenario alone": sends one scenario to the agent, grades it as a run would, and shows
 * the verdict and its reasons in an inline panel labelled as what it is — a single-scenario
 * check, not a sealed run. It changes no score, no coverage figure and no report.
 *
 * A plain form posting to a server action, so it works before (and without) JavaScript; the
 * result comes back as the action's state.
 *
 * Reusable: the run page passes `{ runCaseId }`; the scenario catalog can pass
 * `{ agentId, suiteId, scenarioId, locale? }`. The person needs the role that may retest
 * (`case.retest`); the action refuses anyone else in words.
 */
/** The single-scenario check spends no run (0072): said beside the button, in these words. */
const SINGLE_CHECK_ALLOWANCE_NOTE = "Free single-scenario check — does not use a run from your allowance.";

export function TryScenarioAlone({
  target,
  newestPolicyVersion,
  className = "",
}: {
  target: TryScenarioTarget;
  /** Names the policy the check will run against, when the page knows it. */
  newestPolicyVersion?: number | null;
  className?: string;
}) {
  const [state, submit] = useActionState<ScenarioCheckState, FormData>(checkScenarioAlone, {});

  return (
    <form action={submit} className={`mt-3 ${className}`}>
      {"runCaseId" in target ? (
        <input type="hidden" name="runCaseId" value={target.runCaseId} />
      ) : (
        <>
          <input type="hidden" name="agentId" value={target.agentId} />
          <input type="hidden" name="suiteId" value={target.suiteId} />
          <input type="hidden" name="scenarioId" value={target.scenarioId} />
          <input type="hidden" name="locale" value={target.locale ?? "en"} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" size="sm" pendingLabel="Sending this scenario…">
          Try this scenario alone
        </SubmitButton>
        <span className="text-xs text-ink-faint">
          Against {newestPolicyVersion ? `policy v${newestPolicyVersion}, the newest` : "the newest policy version"}. Not counted in any score or report.
        </span>
      </div>
      {/* Said before it is pressed: one scenario re-checked while fixing a prompt costs a couple of
          grading calls, a whole suite run ninety, and only the run counts against the allowance. */}
      <p className="mt-1.5 text-xs text-ink-faint">{SINGLE_CHECK_ALLOWANCE_NOTE}</p>
      <Pending />
      {state.check && <CheckPanel check={state.check} remaining={state.remaining} />}
      {state.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-fail-text">
          {state.error}
          {state.remedy && (
            <>
              {" "}
              <Link href={state.remedy.href} className="text-ink underline underline-offset-2 hover:no-underline">{state.remedy.label}</Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <p role="status" className="mt-2 text-xs text-ink-soft">
      Sending the scenario to the agent and grading the reply. This usually takes a few seconds.
    </p>
  );
}

function CheckPanel({ check, remaining }: { check: NonNullable<ScenarioCheckState["check"]>; remaining?: number }) {
  const tone = check.verdict === "pass" ? "pass" : check.verdict === "fail" ? "fail" : "error";
  return (
    <section aria-label={CHECK_LABEL} aria-live="polite" className="mt-3 rounded-control border border-line bg-sunken p-3">
      <p className="type-pill text-ink-faint">{CHECK_LABEL}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <Badge tone={tone}>{check.verdict === "no_verdict" ? "no verdict" : check.verdict === "error" ? "no result" : check.verdict}</Badge>
        <span>{verdictWords(check.verdict, check.noVerdictReason)}</span>
        <span className="text-ink-faint">
          · policy v{check.policyVersion}
          {check.settledBy ? ` · settled by ${check.settledBy === "deterministic" ? "a rule" : check.settledBy === "read_back" ? "the read-back" : "the models"}` : ""}
        </span>
      </div>
      {check.reasons.length + check.failedAssertions.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink-soft">
          {check.reasons.map((r, i) => <li key={`r${i}`}>{r}</li>)}
          {check.failedAssertions.map((a, i) => <li key={`a${i}`}>Not met: {a}</li>)}
        </ul>
      )}
      {check.readBack && (
        <p className="mt-2 text-xs text-ink-soft">Read-back: {check.readBack.status}. {check.readBack.detail}</p>
      )}
      <p className="mt-2 text-xs text-ink-faint">
        Rerun the suite for evidence a report can carry.
        {typeof remaining === "number" ? ` ${remaining} single-scenario ${remaining === 1 ? "check" : "checks"} left this hour.` : ""}
      </p>
    </section>
  );
}
