"use client";

import { useActionState, useState } from "react";
import { connectAgent, type FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";

export function ConnectAgentForm() {
  const [state, submit] = useActionState<FormState, FormData>(connectAgent, {});
  const [showAuth, setShowAuth] = useState(false);

  return (
    <form action={submit} className="mt-8 space-y-6">
      <Field label="Name" htmlFor="name" hint="How you'll recognise it. Your client never sees this.">
        <input id="name" name="name" required className={inputClass} placeholder="Northwind support bot" />
      </Field>

      <Field label="Endpoint URL" htmlFor="url" hint="Where Novera should POST each scenario.">
        <input
          id="url" name="url" type="url" required className={inputClass}
          placeholder="https://api.example.com/support/chat"
        />
      </Field>

      <Field
        label="Request body"
        htmlFor="bodyTemplate"
        hint={
          <>
            A JSON object. Put <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">{"{{input}}"}</code>{" "}
            where the scenario text goes, and{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">{"{{policy}}"}</code> where your
            policy should go, if your endpoint takes one.
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

      <div className="rounded-xl border border-slate-200 p-4">
        <button
          type="button"
          onClick={() => setShowAuth(!showAuth)}
          className="flex w-full items-center justify-between text-sm font-medium"
          aria-expanded={showAuth}
        >
          Authentication
          <span className={`text-slate-400 transition-transform duration-200 ${showAuth ? "rotate-90" : ""}`}>›</span>
        </button>
        {showAuth && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Header name" htmlFor="authHeaderName">
              <input id="authHeaderName" name="authHeaderName" className={`${inputClass} font-mono text-xs`} placeholder="authorization" />
            </Field>
            <Field label="Header value" htmlFor="authValue" hint="Encrypted before it is stored. Never shown again.">
              <input id="authValue" name="authValue" type="password" className={`${inputClass} font-mono text-xs`} placeholder="Bearer …" />
            </Field>
          </div>
        )}
      </div>

      <label className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm leading-relaxed">
        <input type="checkbox" name="attested" className="mt-0.5 size-4 shrink-0 accent-slate-900" />
        <span>
          <span className="font-medium">I own this agent, or I am authorised to test it.</span>
          <br />
          <span className="text-slate-600">
            Recorded with your email and today&apos;s date, and attached to every run, so a report can
            always say on whose authority the testing happened.
          </span>
        </span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </p>
      )}

      <SubmitButton pendingLabel="Connecting and testing…">Connect and test</SubmitButton>
    </form>
  );
}
