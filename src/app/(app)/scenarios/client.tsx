"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import type { FormState } from "@/lib/workflow/actions.ts";
import {
  draftScenarios,
  decideScenarioDraft,
  promoteApprovedScenarios,
} from "@/lib/workflow/scenarios.ts";

function Message({ state }: { state: FormState }) {
  if (!state.error && !state.notice) return null;
  return (
    <p
      role="status"
      className={`mt-3 type-body ${state.error ? "text-fail-text" : "text-pass-text"}`}
    >
      {state.error ?? state.notice}
    </p>
  );
}

export function DraftForm({
  agents,
}: {
  agents: Array<{ id: string; name: string; is_production: boolean }>;
}) {
  const [state, submit] = useActionState<FormState, FormData>(draftScenarios, {});

  if (agents.length === 0) {
    return (
      <p className="mt-3 type-body text-ink-soft">
        Connect an agent and write a policy version first — a scenario needs a written duty to test.
      </p>
    );
  }

  return (
    <form action={submit} className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr]">
      <Field label="Agent" htmlFor="agentId" hint="Its most recent policy version is what gets read.">
        <select id="agentId" name="agentId" className={inputClass} required>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.is_production ? "" : " (test target)"}
            </option>
          ))}
        </select>
      </Field>

      <Field label="How many" htmlFor="count" hint="Six at most — you have to read every one.">
        <input
          id="count" name="count" type="number" min={1} max={6} defaultValue={5}
          className={`${inputClass} tnum`}
        />
      </Field>

      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Reading your policy…">Draft scenarios</SubmitButton>
        <Message state={state} />
      </div>
    </form>
  );
}

/**
 * Approve, or reject with a reason.
 *
 * The reason field appears only once rejection is chosen, because asking for it up
 * front reads as a form to fill in rather than a decision to make — and it is
 * required, since a rejection nobody explained teaches the next draft nothing.
 */
export function DecideForm({ draftId }: { draftId: string }) {
  const [state, submit] = useActionState<FormState, FormData>(decideScenarioDraft, {});
  const [rejecting, setRejecting] = useState(false);

  return (
    <form action={submit} className="mt-5 border-t border-line pt-4">
      <input type="hidden" name="draftId" value={draftId} />

      {rejecting ? (
        <div className="space-y-3">
          <Field label="Why not?" htmlFor={`reason-${draftId}`}>
            <input
              id={`reason-${draftId}`}
              name="reason"
              required
              placeholder="e.g. we do not offer this at all, so the case cannot fail honestly"
              className={inputClass}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="decision" value="reject" variant="danger" pendingLabel="Rejecting…">
              Reject this scenario
            </SubmitButton>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="text-sm text-ink-faint underline-offset-2 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton name="decision" value="approve" pendingLabel="Approving…">
            Approve
          </SubmitButton>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="text-sm text-ink-soft underline-offset-2 hover:underline"
          >
            Reject
          </button>
        </div>
      )}

      <Message state={state} />
    </form>
  );
}

export function PromoteForm({
  suites,
}: {
  suites: Array<{ id: string; key: string; version: number; name: string }>;
}) {
  const [state, submit] = useActionState<FormState, FormData>(promoteApprovedScenarios, {});

  return (
    <form action={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Suite key" htmlFor="key" hint="Lowercase. It identifies the suite across versions.">
        <input id="key" name="key" required defaultValue="own-policy" className={`${inputClass} font-mono text-xs`} />
      </Field>

      <Field label="Suite name" htmlFor="name">
        <input id="name" name="name" required defaultValue="Scenarios from our policy" className={inputClass} />
      </Field>

      <div className="sm:col-span-2">
        <Field
          label="Start from"
          htmlFor="extend"
          hint="Carries an existing version's scenarios into the new one. The version you pick is read, never changed."
        >
          <select id="extend" name="extend" className={inputClass} defaultValue="">
            <option value="">Nothing — just the approved scenarios</option>
            {suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.key} v{s.version})
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Creating the version…">Promote into a new suite version</SubmitButton>
        <Message state={state} />
      </div>
    </form>
  );
}
