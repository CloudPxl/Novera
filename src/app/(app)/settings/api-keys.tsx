"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { createApiKey, revokeApiKey, type KeyFormState } from "@/lib/workflow/api-keys.ts";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";

/**
 * Creating a key. The key appears once, in this component's state, and is gone on the
 * next navigation — Novera keeps only a fingerprint of it.
 */
export function CreateApiKey() {
  const [state, submit] = useActionState<KeyFormState, FormData>(createApiKey, {});
  const keepValues = useKeepValuesOnError(state);
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-4">
      <form onSubmitCapture={keepValues} action={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Field label="Name" htmlFor="api-key-name" hint="Where it will be used, so you know which one to revoke.">
            <input id="api-key-name" name="name" required maxLength={80} placeholder="e.g. GitHub Actions" className={inputClass} />
          </Field>
        </div>
        <SubmitButton size="sm" pendingLabel="Creating…">Create key</SubmitButton>
        <label className="flex w-full items-start gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="canRun" className="mt-0.5 size-4 accent-ink" />
          <span>
            Can also start runs. Each run it starts uses one of your trial runs, or grades on your own
            model key. Leave this off for a key that only reads.
          </span>
        </label>
        <label className="flex w-full items-start gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="canWrite" className="mt-0.5 size-4 accent-ink" />
          <span>
            Can also ask for scenario drafts and failure diagnoses from an AI assistant through MCP, and
            record failures from production through the API. They arrive as drafts and proposals for you
            to approve or reject here; no key can approve, publish or change anything.
          </span>
        </label>
        <label className="flex w-full items-start gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="canReadResponses" className="mt-0.5 size-4 accent-ink" />
          <span>
            Can also read your agent&apos;s replies and what each scenario sent, through the API and MCP.
            Without it, a key sees verdicts, reasons and counts, with personal data shown as placeholders.
            Every read of the replies is listed below.
          </span>
        </label>
      </form>

      {state.error && <p role="status" className="mt-3 text-sm text-fail-text">{state.error}</p>}
      {state.key && (
        <div role="status" className="mt-4 rounded-control border border-warning-border bg-warning-surface p-3">
          <p className="text-sm font-medium text-warning-text">{state.notice}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="new-api-key" className="sr-only">Your new API key</label>
            <input
              id="new-api-key" readOnly value={state.key}
              onFocus={(e) => e.currentTarget.select()}
              className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.key!);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
              className="rounded-control border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink hover:bg-sunken"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Revoking, in two steps: it cannot be undone, and a pipeline using the key stops. */
export function RevokeApiKey({ keyId, name }: { keyId: string; name: string }) {
  const [state, submit] = useActionState<KeyFormState, FormData>(revokeApiKey, {});
  const [confirming, setConfirming] = useState(false);

  if (state.notice) return <span role="status" className="text-xs text-pass-text">{state.notice}</span>;
  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="keyId" value={keyId} />
      {confirming ? (
        <>
          <span className="text-xs text-ink-soft">Revoke “{name}” for good?</span>
          <SubmitButton size="sm" variant="danger" pendingLabel="Revoking…">Revoke</SubmitButton>
          <button type="button" onClick={() => setConfirming(false)} className="text-xs text-ink-faint underline-offset-2 hover:underline">
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
          Revoke
        </button>
      )}
      {state.error && <span role="status" className="text-xs text-fail-text">{state.error}</span>}
    </form>
  );
}
