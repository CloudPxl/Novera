"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { createWebhook, revokeWebhook, sendTestWebhook, type WebhookFormState } from "@/lib/workflow/webhooks.ts";

const EVENTS = [
  { key: "run.completed", label: "A run finished", hint: "with its counts, outcome and report link" },
  { key: "run.stopped", label: "A run was stopped", hint: "by a person, or ended by an error" },
  { key: "schedule.paused", label: "A schedule paused", hint: "with the reason, such as no runs left" },
] as const;

export function CreateWebhook() {
  const [state, submit] = useActionState<WebhookFormState, FormData>(createWebhook, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4">
      <form action={submit} className="space-y-3">
        <Field label="Endpoint address" htmlFor="webhook-url" hint="An https address on the public internet. Novera signs every delivery.">
          <input id="webhook-url" name="url" type="url" required maxLength={500} placeholder="https://hooks.example.com/novera" className={inputClass} />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-ink">Send when</legend>
          <div className="mt-2 space-y-1.5">
            {EVENTS.map((e) => (
              <label key={e.key} className="flex items-start gap-2 text-sm text-ink-soft">
                <input type="checkbox" name={`event:${e.key}`} defaultChecked={e.key !== "schedule.paused"} className="mt-0.5 size-4 accent-ink" />
                <span><span className="text-ink">{e.label}</span> — {e.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <SubmitButton size="sm" pendingLabel="Adding…">Add endpoint</SubmitButton>
      </form>
      {state.error && <p role="status" className="mt-3 text-sm text-fail-text">{state.error}</p>}
      {state.secret && (
        <div role="status" className="mt-4 rounded-control border border-warning-border bg-warning-surface p-3">
          <p className="text-sm font-medium text-warning-text">{state.notice}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="new-webhook-secret" className="sr-only">Signing secret</label>
            <input id="new-webhook-secret" readOnly value={state.secret} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} min-w-0 flex-1 font-mono text-xs`} />
            <button
              type="button"
              onClick={async () => { try { await navigator.clipboard.writeText(state.secret!); setCopied(true); } catch { setCopied(false); } }}
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

export function WebhookActions({ endpointId, url }: { endpointId: string; url: string }) {
  const [testState, test] = useActionState<WebhookFormState, FormData>(sendTestWebhook, {});
  const [revokeState, revoke] = useActionState<WebhookFormState, FormData>(revokeWebhook, {});
  const [confirming, setConfirming] = useState(false);
  if (revokeState.notice) return <span role="status" className="text-xs text-pass-text">{revokeState.notice}</span>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={test}>
        <input type="hidden" name="endpointId" value={endpointId} />
        <SubmitButton size="sm" variant="secondary" pendingLabel="Sending…">Send a test event</SubmitButton>
      </form>
      <form action={revoke} className="flex items-center gap-2">
        <input type="hidden" name="endpointId" value={endpointId} />
        {confirming ? (
          <>
            <span className="text-xs text-ink-soft">Stop sending to {new URL(url).host} for good?</span>
            <SubmitButton size="sm" variant="danger" pendingLabel="Revoking…">Revoke</SubmitButton>
            <button type="button" onClick={() => setConfirming(false)} className="text-xs text-ink-faint underline-offset-2 hover:underline">Cancel</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">Revoke</button>
        )}
      </form>
      {(testState.notice || testState.error) && (
        <span role="status" className={`w-full text-xs ${testState.error ? "text-fail-text" : "text-pass-text"}`}>{testState.notice ?? testState.error}</span>
      )}
      {revokeState.error && <span role="status" className="w-full text-xs text-fail-text">{revokeState.error}</span>}
    </div>
  );
}
