"use client";

import { useActionState } from "react";
import { connectAgent, type FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";

export function ConnectAgentForm() {
  const [state, submit] = useActionState<FormState, FormData>(connectAgent, {});
  const keepValues = useKeepValuesOnError(state);

  return (
    <form onSubmitCapture={keepValues} action={submit} className="mt-8 space-y-6">
      <Field label="Name" htmlFor="name" hint="How you'll recognise it. Your client never sees this.">
        <input id="name" name="name" required className={inputClass} placeholder="Northwind support bot" />
      </Field>

      <Field label="Endpoint URL" htmlFor="url" hint="Where Novera should POST each scenario.">
        <input
          id="url" name="url" type="url" required className={inputClass}
          placeholder="https://api.example.com/support/chat"
        />
      </Field>

      {/* Most agents take the defaults; the probe right after connecting shows whether they
          do, and suggests a reply path from what came back. So the format is one click away
          rather than the first thing a new person has to understand. */}
      <details className="group rounded-panel border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
          <span>
            <span className="font-medium">Request and reply format</span>
            <span className="mt-0.5 block text-xs text-ink-faint">
              Sends <code className="font-mono">{'{"message": "{{input}}"}'}</code>, reads the reply at <code className="font-mono">reply</code>. Change only if your endpoint differs.
            </span>
          </span>
          <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
        </summary>
        <div className="space-y-6 border-t border-line px-4 py-4">
        <Field
          label="Request body"
          htmlFor="bodyTemplate"
          hint={
            <>
              A JSON object. Put <code className="rounded bg-sunken px-1 py-0.5 font-mono text-ink">{"{{input}}"}</code>{" "}
              where the scenario text goes, and{" "}
              <code className="rounded bg-sunken px-1 py-0.5 font-mono text-ink">{"{{policy}}"}</code> where your
              policy should go, if your endpoint takes one. Add{" "}
              <code className="rounded bg-sunken px-1 py-0.5 font-mono text-ink">{"{{context}}"}</code> if your
              agent receives account or user metadata alongside the message — scenarios that attack that
              channel are skipped, not rerouted through the message, when there is nowhere to put them. For
              conversation scenarios, add{" "}
              <code className="rounded bg-sunken px-1 py-0.5 font-mono text-ink">{"{{history}}"}</code> (the earlier
              turns, as a list of chat messages) or{" "}
              <code className="rounded bg-sunken px-1 py-0.5 font-mono text-ink">{"{{conversation_id}}"}</code> (if
              your agent remembers conversations itself); without either, they are skipped too.
            </>
          }
        >
          <textarea
            id="bodyTemplate" name="bodyTemplate" rows={4}
            className={`${inputClass} font-mono text-xs`}
            defaultValue={'{\n  "message": "{{input}}"\n}'}
          />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Reply path" htmlFor="responsePath" hint="Dot path to the reply text, e.g. reply or choices.0.message.content">
            <input id="responsePath" name="responsePath" required defaultValue="reply" className={`${inputClass} font-mono text-xs`} />
          </Field>
          <Field label="Tool activity path" htmlFor="toolActivityPath" hint="Optional. Where your agent reports the actions it took.">
            <input id="toolActivityPath" name="toolActivityPath" className={`${inputClass} font-mono text-xs`} placeholder="tool_calls" />
          </Field>
        </div>
        </div>
      </details>

      <details className="group rounded-panel border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
          <span>
            <span className="font-medium">Authentication</span>
            <span className="mt-0.5 block text-xs text-ink-faint">Only if your endpoint needs a header. Encrypted before storage, never shown again.</span>
          </span>
          <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
        </summary>
        <div className="grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-2">
          <Field label="Header name" htmlFor="authHeaderName">
            <input id="authHeaderName" name="authHeaderName" className={`${inputClass} font-mono text-xs`} placeholder="authorization" />
          </Field>
          <Field label="Header value" htmlFor="authValue" hint="Encrypted before it is stored. Never shown again.">
            <input id="authValue" name="authValue" type="password" className={`${inputClass} font-mono text-xs`} placeholder="Bearer …" />
          </Field>
        </div>
      </details>

      <label className="flex gap-3 rounded-xl border border-line bg-ground/60 p-4 text-sm leading-relaxed">
        <input type="checkbox" name="attested" className="mt-0.5 size-4 shrink-0 accent-slate-900" />
        <span>
          <span className="font-medium">I own this agent, or I am authorised to test it.</span>
          <br />
          <span className="text-ink-soft">
            Recorded with your email and today&apos;s date, and attached to every run, so a report can
            always say on whose authority the testing happened.
          </span>
        </span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">
          {state.error}
        </p>
      )}

      <SubmitButton pendingLabel="Connecting and testing…">Connect and test</SubmitButton>
    </form>
  );
}
