"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestDiagnosis, decideDiagnosis, type FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton, Spinner } from "@/components/ui/button.tsx";
import { Card, Badge } from "@/components/ui/primitives.tsx";

export interface Proposal {
  id: string;
  analysis: string;
  quotedOld: string | null;
  proposedNew: string;
  risks: string[];
  status: "proposed" | "approved" | "rejected";
  decidedAt: string | null;
  resultingPolicyVersion: number | null;
}

/** Asks for a proposal on one failed scenario. */
export function DiagnoseButton({ runCaseId, hasProposal }: { runCaseId: string; hasProposal: boolean }) {
  const [state, submit] = useActionState<FormState, FormData>(requestDiagnosis, {});

  return (
    <form action={submit} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="runCaseId" value={runCaseId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Reading the policy…">
        {hasProposal ? "Propose another change" : "Why did this fail?"}
      </SubmitButton>
      {state.notice && <span className="text-xs font-medium text-emerald-700">{state.notice}</span>}
      {state.error && (
        <span role="alert" className="text-xs font-medium text-rose-700">
          {state.error}
        </span>
      )}
    </form>
  );
}

/**
 * One proposed policy change, with the decision that was made about it.
 *
 * The change is shown as what it removes and what it puts there, never as a finished
 * policy: a person approving this is agreeing to a specific edit, and should be able
 * to see exactly which words leave and which arrive.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [state, submit] = useActionState<FormState, FormData>(decideDiagnosis, {});
  const open = proposal.status === "proposed";

  return (
    <Card className="mt-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={open ? "live" : proposal.status === "approved" ? "pass" : "neutral"}>
          {open ? "proposed change" : proposal.status}
        </Badge>
        {proposal.resultingPolicyVersion !== null && (
          <span className="text-xs text-slate-500">became policy v{proposal.resultingPolicyVersion}</span>
        )}
        {proposal.decidedAt && (
          <span className="text-xs text-slate-500">
            {new Date(proposal.decidedAt).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-700">{proposal.analysis}</p>

      <div className="mt-4 space-y-2">
        {proposal.quotedOld !== null ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700">Replaces</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-rose-900 line-through decoration-rose-400">
              {proposal.quotedOld}
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            This change adds a new instruction rather than replacing existing text.
          </p>
        )}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
            {proposal.quotedOld !== null ? "With" : "Adds"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-emerald-900">
            {proposal.proposedNew}
          </p>
        </div>
      </div>

      {proposal.risks.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-900">What this could break</p>
          <ul className="mt-1.5 space-y-1">
            {proposal.risks.map((risk, i) => (
              <li key={i} className="text-sm leading-relaxed text-slate-600">
                — {risk}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <form action={submit} className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <input type="hidden" name="diagnosisId" value={proposal.id} />
          <DecisionButtons />
          {state.error && (
            <span role="alert" className="text-xs font-medium text-rose-700">
              {state.error}
            </span>
          )}
          {state.notice && <span className="text-xs font-medium text-emerald-700">{state.notice}</span>}
        </form>
      )}
    </Card>
  );
}


/**
 * Approve and Reject, each carrying its own decision.
 *
 * Both are named submit buttons rather than one button plus a hidden default: the
 * decision has to come from the button the person actually pressed. A hidden field
 * would silently supply an answer for a click that never happened.
 */
function DecisionButtons() {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        name="decision"
        value="approved"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-all duration-150 hover:bg-slate-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-400 disabled:active:scale-100"
      >
        {pending && <Spinner />}
        {pending ? "Working…" : "Approve and create a new version"}
      </button>
      <button
        type="submit"
        name="decision"
        value="rejected"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-all duration-150 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:text-slate-400 disabled:active:scale-100"
      >
        Reject
      </button>
    </>
  );
}
