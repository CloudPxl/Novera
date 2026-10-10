"use client";

import { useActionState, useState } from "react";
import { updateAgentConnection, archiveAgent, restoreAgent } from "@/lib/workflow/agent-admin.ts";
import type { FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";
import { MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS } from "@/lib/agents/connection.ts";

export interface EditableConnection {
  name: string;
  url: string;
  bodyTemplate: string;
  responsePath: string;
  toolActivityPath: string;
  timeoutSeconds: string;
  authHeaderName: string;
}

const code = "rounded bg-sunken px-1 py-0.5 font-mono text-ink";

/**
 * Changing how Novera reaches an agent. The credential is write-only: this form is told
 * only whether one is stored, never what it is, and it is never put back after a refusal.
 */
export function ConnectionEditor({ agentId, current, hasCredential }: {
  agentId: string;
  current: EditableConnection;
  hasCredential: boolean;
}) {
  const [state, submit] = useActionState<FormState, FormData>(updateAgentConnection, {});
  const keepValues = useKeepValuesOnError(state);

  return (
    <details className="group mt-3 rounded-panel border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <span>
          <span className="font-medium">Change the connection</span>
          <span className="mt-0.5 block text-xs text-ink-faint">Name, address, request and reply format, timeout, credential. Runs already made keep what they declared.</span>
        </span>
        <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
      </summary>
      <form onSubmitCapture={keepValues} action={submit} className="space-y-5 border-t border-line px-4 py-4">
        <input type="hidden" name="agentId" value={agentId} />
        <Field label="Name" htmlFor="edit-name" hint="Shown in Novera and on reports sealed from now on. Reports already sealed keep the name they were sealed with.">
          <input id="edit-name" name="name" required maxLength={120} defaultValue={current.name} className={inputClass} />
        </Field>
        <Field label="Endpoint URL" htmlFor="edit-url" hint="Checked to be a public address when saved, and again on every call.">
          <input id="edit-url" name="url" type="url" required defaultValue={current.url} className={inputClass} />
        </Field>
        <Field
          label="Request body"
          htmlFor="edit-body"
          hint={<>A JSON object with <code className={code}>{"{{input}}"}</code>. It may also carry <code className={code}>{"{{policy}}"}</code>, <code className={code}>{"{{context}}"}</code>, <code className={code}>{"{{history}}"}</code> and <code className={code}>{"{{conversation_id}}"}</code>; any other placeholder is refused, because it would reach your agent as written.</>}
        >
          <textarea id="edit-body" name="bodyTemplate" rows={5} defaultValue={current.bodyTemplate} className={`${inputClass} font-mono text-xs`} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Reply path" htmlFor="edit-reply" hint="Dot path to the reply text, e.g. reply or choices.0.message.content">
            <input id="edit-reply" name="responsePath" required defaultValue={current.responsePath} className={`${inputClass} font-mono text-xs`} />
          </Field>
          <Field label="Tool activity path" htmlFor="edit-tools" hint="Optional. Leave empty if your agent does not report its actions.">
            <input id="edit-tools" name="toolActivityPath" defaultValue={current.toolActivityPath} className={`${inputClass} font-mono text-xs`} />
          </Field>
        </div>
        <Field label="Timeout (seconds)" htmlFor="edit-timeout" hint={`Optional, ${MIN_TIMEOUT_SECONDS}–${MAX_TIMEOUT_SECONDS}. Empty waits the longest Novera can, ${MAX_TIMEOUT_SECONDS} s: a run works in time slices.`}>
          <input id="edit-timeout" name="timeoutSeconds" type="number" inputMode="numeric" min={MIN_TIMEOUT_SECONDS} max={MAX_TIMEOUT_SECONDS} step={1} defaultValue={current.timeoutSeconds} className={`${inputClass} sm:max-w-40`} />
        </Field>
        <fieldset className="rounded-control bg-ground/60 p-4 ring-1 ring-line">
          <legend className="px-1 text-sm font-medium">Authentication</legend>
          <p className="text-xs text-ink-soft">
            {hasCredential
              ? "A credential is stored for this agent. It is never shown, here or anywhere else."
              : "No credential is stored for this agent."}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Header name" htmlFor="edit-header">
              <input id="edit-header" name="authHeaderName" defaultValue={current.authHeaderName} placeholder="authorization" className={`${inputClass} font-mono text-xs`} />
            </Field>
            <Field label={hasCredential ? "Replace the credential" : "Credential"} htmlFor="edit-credential" hint="Encrypted before it is stored. Leave empty to keep what is stored.">
              <input id="edit-credential" name="credential" type="password" autoComplete="off" placeholder={hasCredential ? "Paste a new one to replace it" : "Bearer …"} className={`${inputClass} font-mono text-xs`} />
            </Field>
          </div>
          {hasCredential && (
            <label className="mt-3 flex items-start gap-2 text-sm text-ink-soft">
              <input type="checkbox" name="removeCredential" className="mt-0.5 size-4 accent-ink" />
              <span>Remove the stored credential. Requests are then sent without it.</span>
            </label>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton size="sm" pendingLabel="Saving and checking…">Save and check</SubmitButton>
          <span className="text-xs text-ink-faint">Saved first, then one harmless request proves it; the receipt above is replaced.</span>
        </div>
        {state.error && <p role="alert" className="text-sm text-fail-text">{state.error}</p>}
        {state.notice && <p role="status" className="text-sm text-pass-text">{state.notice}</p>}
      </form>
    </details>
  );
}

/**
 * Archive: type the name to confirm. Restore: one press. Both owner or admin (`agent.archive`).
 */
export function ArchiveAgent({ agentId, name, archived, canArchive }: {
  agentId: string;
  name: string;
  archived: { at: string } | null;
  canArchive: boolean;
}) {
  const [archiveState, archive] = useActionState<FormState, FormData>(archiveAgent, {});
  const [restoreState, restore] = useActionState<FormState, FormData>(restoreAgent, {});
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === name.trim();

  if (archived) {
    return (
      <div className="mt-3 rounded-control bg-surface p-4 ring-1 ring-line">
        <p className="text-sm leading-relaxed text-ink">
          Archived on {archived.at.slice(0, 10)}. No new run, retest or schedule can start for it. Its runs, reports and evidence are kept and still open.
        </p>
        {canArchive ? (
          <form action={restore} className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <input type="hidden" name="agentId" value={agentId} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Restoring…">Restore this agent</SubmitButton>
            <span className="text-xs text-ink-faint">Schedules paused by archiving stay paused until you resume them.</span>
            {restoreState.error && <p role="alert" className="basis-full text-sm text-fail-text">{restoreState.error}</p>}
            {restoreState.notice && <p role="status" className="basis-full text-sm text-pass-text">{restoreState.notice}</p>}
          </form>
        ) : (
          <p className="mt-2 text-xs text-ink-faint">Only the owner or an admin can restore it.</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-control bg-surface p-4 ring-1 ring-line">
      <p className="text-sm leading-relaxed text-ink">
        Archiving takes this agent out of the lists and stops new runs, retests and schedules. Nothing is deleted:
        its runs, reports and evidence stay, and it can be restored. Its active schedules are paused, not cancelled.
        It cannot be archived while a run of it is queued or running.
      </p>
      {canArchive ? (
        <form action={archive} className="mt-3 space-y-3 border-t border-line pt-3">
          <input type="hidden" name="agentId" value={agentId} />
          <Field label={`Type ${name} to confirm`} htmlFor="archive-confirm">
            <input
              id="archive-confirm" name="confirmName" autoComplete="off" value={typed}
              onChange={(e) => setTyped(e.target.value)} className={`${inputClass} sm:max-w-sm`}
            />
          </Field>
          <SubmitButton variant="danger" size="sm" pendingLabel="Archiving…" disabled={!matches}>Archive this agent</SubmitButton>
          {archiveState.error && <p role="alert" className="text-sm text-fail-text">{archiveState.error}</p>}
          {archiveState.notice && <p role="status" className="text-sm text-pass-text">{archiveState.notice}</p>}
        </form>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">Only the owner or an admin can archive an agent.</p>
      )}
    </div>
  );
}
