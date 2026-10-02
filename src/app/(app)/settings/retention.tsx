"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { RETENTION_CHOICES } from "@/lib/privacy/retention.ts";
import { setRetention, type RetentionFormState } from "@/lib/workflow/retention.ts";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";

/** Choosing the period. A shorter one is said to be irreversible before it is saved. */
export function RetentionForm({ current, isOwner }: { current: number; isOwner: boolean }) {
  const [state, submit] = useActionState<RetentionFormState, FormData>(setRetention, {});
  const keepValues = useKeepValuesOnError(state);
  const [days, setDays] = useState(current);
  const shorter = days < current;

  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <Field label="Keep raw replies for" htmlFor="retention-days">
        <select
          id="retention-days" name="days" value={days} disabled={!isOwner}
          onChange={(e) => setDays(Number(e.target.value))} className={inputClass}
        >
          {RETENTION_CHOICES.map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </Field>
      {shorter && (
        <p role="status" className="rounded-control bg-warning-surface px-3 py-2 text-sm leading-relaxed text-warning-text ring-1 ring-warning-border">
          Replies graded more than {days} days ago will be removed at the next daily pass. That cannot be undone;
          their verdicts, reasons and fingerprints are kept.
        </p>
      )}
      {isOwner ? (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…" disabled={days === current}>Save</SubmitButton>
          {state.error && <p role="status" className="text-sm text-fail-text">{state.error}</p>}
          {state.notice && <p role="status" className="text-sm text-pass-text">{state.notice}</p>}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">Only the workspace owner can change this.</p>
      )}
    </form>
  );
}
