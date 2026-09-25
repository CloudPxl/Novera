"use client";

import { useActionState, useState } from "react";
import { reviewVerdict, type FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Badge, Field, inputClass } from "@/components/ui/primitives.tsx";
import { REVIEW_NOTE_MAX, REVIEW_NOTE_MIN } from "@/lib/evidence/reviews.ts";

export interface ReviewEntry {
  id: string;
  verdictStatus: "pass" | "fail" | "error";
  finding: "pass" | "fail";
  note: string;
  createdAt: string;
  /** Whether the person signed in wrote it. Names of other members are not sent here. */
  mine: boolean;
}

const label = (s: "pass" | "fail" | "error") => (s === "error" ? "no result" : s);

/**
 * A person's finding on this verdict.
 *
 * Offered on every settled scenario, passes included: a false pass is the verdict a
 * person most needs to be able to dispute, because nothing else in a report will. The
 * verdict itself never changes — the form says so before it is used, not after.
 */
export function ReviewVerdict({ runCaseId, status }: { runCaseId: string; status: "pass" | "fail" | "error" }) {
  const [state, submit] = useActionState<FormState, FormData>(reviewVerdict, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        Record your own finding on this verdict
      </button>
    );
  }

  return (
    <form action={submit} className="mt-3 space-y-3 rounded-lg border border-line p-3">
      <input type="hidden" name="runCaseId" value={runCaseId} />
      <p className="text-xs leading-relaxed text-ink-soft">
        The automated verdict here is <strong className="font-semibold text-ink">{label(status)}</strong> and
        stays that way. Your finding is kept beside it, with your reason, on this page. A
        client report already sealed from this run does not change: its hash is what proves
        nothing was edited after it was issued.
      </p>

      <fieldset>
        <legend className="text-sm font-medium text-ink">Having read the transcript, this scenario</legend>
        <div className="mt-1.5 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="finding" value="pass" required /> passed
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="finding" value="fail" required /> failed
          </label>
        </div>
      </fieldset>

      <Field
        label="Why"
        htmlFor={`note-${runCaseId}`}
        hint={`What in the transcript decides it. Between ${REVIEW_NOTE_MIN} and ${REVIEW_NOTE_MAX.toLocaleString("en-GB")} characters.`}
      >
        <textarea
          id={`note-${runCaseId}`}
          name="note"
          rows={3}
          required
          minLength={REVIEW_NOTE_MIN}
          maxLength={REVIEW_NOTE_MAX}
          className={`${inputClass} leading-relaxed`}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Recording…">Record finding</SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {state.notice && <p role="status" className="text-xs font-medium text-pass-text">{state.notice}</p>}
      {state.error && <p role="alert" className="text-xs font-medium text-fail-text">{state.error}</p>}
    </form>
  );
}

/** Every review of this scenario, newest first. Earlier ones are kept, not replaced. */
export function ReviewHistory({ reviews }: { reviews: ReviewEntry[] }) {
  if (reviews.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="type-pill text-ink-faint">Reviewed by a person</p>
      <ul className="mt-1.5 space-y-2">
        {reviews.map((r, i) => {
          const agrees = r.verdictStatus === r.finding;
          return (
            <li key={r.id} className={`text-xs leading-relaxed ${i > 0 ? "text-ink-faint" : "text-ink-soft"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.finding === "pass" ? "pass" : "fail"}>found {r.finding}</Badge>
                <span>
                  {r.verdictStatus === "error"
                    ? "on a scenario with no automated result"
                    : agrees
                      ? "agrees with the verdict"
                      : `disagrees with the verdict (${r.verdictStatus})`}
                  {r.mine ? " — you" : ""}
                  {i > 0 ? " — superseded" : ""}
                </span>
                <time dateTime={r.createdAt} className="tnum text-ink-faint">
                  {new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
                </time>
              </div>
              <p className="mt-0.5">{r.note}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
