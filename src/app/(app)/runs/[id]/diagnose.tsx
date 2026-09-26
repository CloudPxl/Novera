"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { requestDiagnosis, decideDiagnosis, retestOneCase, type FormState } from "@/lib/workflow/actions.ts";
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
      {state.notice && <span className="text-xs font-medium text-pass-text">{state.notice}</span>}
      {state.error && (
        <span role="alert" className="text-xs font-medium text-fail-text">
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
          <span className="text-xs text-ink-faint">became policy v{proposal.resultingPolicyVersion}</span>
        )}
        {proposal.decidedAt && (
          <span className="text-xs text-ink-faint">
            {new Date(proposal.decidedAt).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{proposal.analysis}</p>

      <DiffView quotedOld={proposal.quotedOld} proposedNew={proposal.proposedNew} />

      {proposal.risks.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-ink">What this could break</p>
          <ul className="mt-1.5 space-y-1">
            {proposal.risks.map((risk, i) => (
              <li key={i} className="text-sm leading-relaxed text-ink-soft">
                — {risk}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <form action={submit} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <input type="hidden" name="diagnosisId" value={proposal.id} />
          <DecisionButtons />
          {state.error && (
            <span role="alert" className="text-xs font-medium text-fail-text">
              {state.error}
            </span>
          )}
          {state.notice && <span className="text-xs font-medium text-pass-text">{state.notice}</span>}
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
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-on-ink transition-all duration-150 hover:bg-ink-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-ink-ghost disabled:active:scale-100"
      >
        {pending && <Spinner />}
        {pending ? "Working…" : "Approve and create a new version"}
      </button>
      <button
        type="submit"
        name="decision"
        value="rejected"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft transition-all duration-150 hover:border-ink-ghost hover:bg-ground active:scale-[0.98] disabled:cursor-not-allowed disabled:text-ink-ghost disabled:active:scale-100"
      >
        Reject
      </button>
    </>
  );
}


/**
 * The change, as a diff.
 *
 * A proposal already *is* a diff — `quotedOld` is the exact text being replaced and
 * `proposedNew` is what replaces it — so it is drawn as one rather than as two
 * paragraphs a reader has to compare by eye. Someone approving this is agreeing to a
 * specific edit and needs to see precisely which words leave and which arrive.
 *
 * A null `quotedOld` is an addition, not a replacement, and is labelled as one: an
 * empty red block would imply something was removed.
 */
function DiffView({ quotedOld, proposedNew }: { quotedOld: string | null; proposedNew: string }) {
  const removed = quotedOld === null ? [] : quotedOld.split("\n");
  const added = proposedNew.split("\n");

  return (
    <figure className="mt-4">
      <figcaption className="type-pill text-ink-faint">
        {quotedOld === null ? "Adds a new instruction" : "Replaces existing policy text"}
      </figcaption>
      <div className="mt-1.5 overflow-hidden rounded-control border border-line type-mono">
        {removed.map((line, i) => (
          <span key={`r${i}`} className="diff-line diff-line-removed">
            <span aria-hidden className="mr-2 select-none opacity-60">-</span>
            {line || "\u00a0"}
          </span>
        ))}
        {added.map((line, i) => (
          <span key={`a${i}`} className="diff-line diff-line-added">
            <span aria-hidden className="mr-2 select-none opacity-60">+</span>
            {line || "\u00a0"}
          </span>
        ))}
      </div>
    </figure>
  );
}

/**
 * Re-runs this one scenario against the policy as it stands now.
 *
 * Labelled as what it is. It is not a run: it produces no score, moves no coverage
 * figure and never appears in a client report — only a whole suite against one policy
 * version does that. Saying so on the button is cheaper than explaining later why a
 * green retest did not change the report the client is holding.
 */
export function RetestButton({ runCaseId }: { runCaseId: string }) {
  const [state, submit] = useActionState<FormState, FormData>(retestOneCase, {});

  return (
    <form action={submit} className="mt-3">
      <input type="hidden" name="runCaseId" value={runCaseId} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" size="sm" pendingLabel="Re-running this scenario…">
          Retest this scenario only
        </SubmitButton>
        <span className="text-xs text-ink-faint">
          Against the newest policy version. Not counted in any score or report.
        </span>
      </div>
      {state.notice && <p className="mt-2 text-xs font-medium text-pass-text">{state.notice}</p>}
      {state.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-fail-text">{state.error}</p>
      )}
    </form>
  );
}

/** Previous retests of this scenario, newest first. Evidence, not a score. */
export interface Retest {
  id: string;
  status: "pass" | "fail" | "error";
  policyVersion: number | null;
  rationale: string | null;
  error: string | null;
  createdAt: string;
}

export function RetestHistory({ retests }: { retests: Retest[] }) {
  if (retests.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="type-pill text-ink-faint">Retests of this scenario</p>
      <ul className="mt-1.5 space-y-1.5">
        {retests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <Badge tone={r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : "error"}>
              {r.status === "error" ? "no result" : r.status}
            </Badge>
            <span>against policy v{r.policyVersion ?? "?"}</span>
            <time dateTime={r.createdAt} className="tnum text-ink-faint">
              {new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")}
            </time>
            {(r.rationale || r.error) && (
              <span className="basis-full text-ink-soft">{r.rationale ?? r.error}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
