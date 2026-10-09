"use client";

import { useActionState, useState } from "react";
import {
  approveDraft, sendDraft, closeRequest, writeDraft, eraseRequest, type InboundState,
} from "@/lib/support/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";

/**
 * Both outcomes announced, not only the bad one.
 *
 * The error was an alert and the confirmation was a plain span — on the page whose
 * actions approve wording and put it in a stranger's inbox. "Sent." is exactly the
 * sentence a person needs to hear without having to go and look for it.
 */
function Feedback({ state }: { state: InboundState }) {
  if (state.notice) {
    return <span role="status" className="text-xs font-medium text-pass-text">{state.notice}</span>;
  }
  if (state.error) return <span role="alert" className="text-xs font-medium text-fail-text">{state.error}</span>;
  return null;
}

export function ApproveButton({ draftId }: { draftId: string }) {
  const [state, submit] = useActionState<InboundState, FormData>(approveDraft, {});
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="draftId" value={draftId} />
      <SubmitButton size="sm" pendingLabel="Approving…">Approve</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

/**
 * Sending is a separate click from approving, on purpose.
 *
 * Approving says "these words are right". Sending says "put them in someone's inbox".
 * Collapsing the two into one button is how a draft goes out while you are still
 * reading it.
 */
export function SendButton({ draftId, to, retry = false }: { draftId: string; to: string; retry?: boolean }) {
  const [state, submit] = useActionState<InboundState, FormData>(sendDraft, {});
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="draftId" value={draftId} />
      {/* After a failed send the draft stays approved, so the same button is the retry — said in its label. */}
      <SubmitButton size="sm" pendingLabel="Sending…">{retry || state.error ? `Try sending again to ${to}` : `Send to ${to}`}</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export function CloseButton({ requestId }: { requestId: string }) {
  const [state, submit] = useActionState<InboundState, FormData>(closeRequest, {});
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Closing…">Close without replying</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export function DraftEditor({ requestId, seed }: { requestId: string; seed: string }) {
  const [state, submit] = useActionState<InboundState, FormData>(writeDraft, {});
  const keepValues = useKeepValuesOnError(state);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(seed);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        Write a different reply
      </button>
    );
  }

  return (
    <form onSubmitCapture={keepValues} action={submit} className="mt-2 space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <textarea
        name="body"
        rows={7}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className={`${inputClass} leading-relaxed`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Saving…">Save as a new draft</SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          Cancel
        </button>
        <Feedback state={state} />
      </div>
      <p className="text-xs text-ink-faint">
        The existing draft is kept. Editing never overwrites what was drafted before.
      </p>
    </form>
  );
}


/**
 * Erasing a message on request.
 *
 * Two clicks, because it cannot be undone and because the thing it removes is
 * somebody's message rather than a row we own.
 */
export function EraseButton({ requestId }: { requestId: string }) {
  const [state, submit] = useActionState<InboundState, FormData>(eraseRequest, {});
  const [armed, setArmed] = useState(false);

  if (state.notice) {
    return <span role="status" className="text-xs font-medium text-pass-text">{state.notice}</span>;
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="text-xs text-ink-faint underline underline-offset-2 hover:text-fail-text"
      >
        Erase this message
      </button>
    );
  }

  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="confirm" value="erase" />
      <SubmitButton variant="danger" size="sm" pendingLabel="Erasing…">
        Erase permanently
      </SubmitButton>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
      >
        Cancel
      </button>
      <span className="text-xs text-ink-faint">
        Removes the message and every draft. Cannot be undone.
      </span>
      <Feedback state={state} />
    </form>
  );
}
