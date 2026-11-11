"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";
import type { InsightFormState } from "@/lib/workflow/insight.ts";
import {
  advanceInsightOutreach, decideInsightFix, draftInsightOutreach, linkInsightHandoff, proposeInsightFix,
} from "@/lib/workflow/insight-followup.ts";

function Answer({ state }: { state: InsightFormState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-fail-text">{state.error}</p>}
      {state.notice && <p role="status" className="text-sm font-medium text-pass-text">{state.notice}</p>}
    </>
  );
}

export function ProposeFixForm({ observationId }: { observationId: string }) {
  const [state, submit] = useActionState<InsightFormState, FormData>(proposeInsightFix, {});
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="observationId" value={observationId} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Asking a model…">Suggest a fix</SubmitButton>
      <Answer state={state} />
    </form>
  );
}

export function DecideFixForm({ suggestionId }: { suggestionId: string }) {
  const [state, submit] = useActionState<InsightFormState, FormData>(decideInsightFix, {});
  const keep = useKeepValuesOnError(state);
  return (
    <form onSubmitCapture={keep} action={submit} className="space-y-3">
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <Field label="Reason (needed to reject)" htmlFor={`reason-${suggestionId}`}>
        <input id={`reason-${suggestionId}`} name="reason" maxLength={1000} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" name="decision" value="accepted" pendingLabel="Saving…">Accept</SubmitButton>
        <SubmitButton size="sm" variant="secondary" name="decision" value="rejected" pendingLabel="Saving…">Reject</SubmitButton>
        <Answer state={state} />
      </div>
    </form>
  );
}

export function DraftOutreachForm({ targetId, kinds }: { targetId: string; kinds: Array<{ value: string; label: string }> }) {
  const [state, submit] = useActionState<InsightFormState, FormData>(draftInsightOutreach, {});
  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="targetId" value={targetId} />
      <Field label="What to draft" htmlFor="outreach-kind">
        <select id="outreach-kind" name="kind" className={inputClass} defaultValue={kinds[0]?.value}>
          {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Drafting…">Draft from the template</SubmitButton>
        <Answer state={state} />
      </div>
    </form>
  );
}

export function OutreachStepForm({ draftId, step, options }: {
  draftId: string;
  step: "approve" | "sent" | "outcome";
  options?: Array<{ value: string; label: string }>;
}) {
  const [state, submit] = useActionState<InsightFormState, FormData>(advanceInsightOutreach, {});
  const field = step === "sent" ? "channel" : "outcome";
  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="step" value={step} />
      {step === "approve" ? (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="confirm" className="mt-1" required />
          <span>I read this draft. It may be sent, by hand, by someone in this workspace.</span>
        </label>
      ) : (
        <Field label={step === "sent" ? "How it was sent" : "What came of it"} htmlFor={`${field}-${draftId}`}>
          <select id={`${field}-${draftId}`} name={field} className={inputClass} defaultValue={options?.[0]?.value}>
            {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" variant={step === "approve" ? "primary" : "secondary"} pendingLabel="Saving…">
          {step === "approve" ? "Approve" : step === "sent" ? "Record as sent" : "Record the outcome"}
        </SubmitButton>
        <Answer state={state} />
      </div>
    </form>
  );
}

export function HandoffForm({ targetId, agents }: { targetId: string; agents: Array<{ id: string; name: string }> }) {
  const [state, submit] = useActionState<InsightFormState, FormData>(linkInsightHandoff, {});
  const keep = useKeepValuesOnError(state);
  return (
    <form onSubmitCapture={keep} action={submit} className="space-y-3">
      <input type="hidden" name="targetId" value={targetId} />
      <Field label="Agent" htmlFor="handoff-agent" hint="Connected in Agents, with the owner's authorisation attested there.">
        <select id="handoff-agent" name="agentId" className={inputClass} required>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Note (optional)" htmlFor="handoff-note">
        <input id="handoff-note" name="note" maxLength={1000} className={inputClass} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="confirm" className="mt-1" required />
        <span>The bot&rsquo;s owner authorised this evaluation of the agent named above.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Linking…">Link the agent</SubmitButton>
        <Answer state={state} />
      </div>
    </form>
  );
}
