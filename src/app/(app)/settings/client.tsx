"use client";

import { useActionState, useState } from "react";
import { saveJudgeKey, removeJudgeKey, type FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";

/** A model each provider offers on its free tier, used to prove the key works. */
const SUGGESTED_MODEL: Record<string, string> = {
  groq: "openai/gpt-oss-120b",
  google: "gemini-3.5-flash-lite",
  openrouter: "nvidia/nemotron-3-super-120b-a12b:free",
  anthropic: "claude-opus-5",
};

export function JudgeKeyForm() {
  const [state, submit] = useActionState<FormState, FormData>(saveJudgeKey, {});
  const [provider, setProvider] = useState("groq");

  return (
    <form action={submit} className="mt-5 space-y-4">
      <Field label="Provider" htmlFor="provider">
        <select
          id="provider"
          name="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className={inputClass}
        >
          <option value="groq">Groq</option>
          <option value="google">Google AI Studio</option>
          <option value="openrouter">OpenRouter</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </Field>

      <Field
        label="API key"
        htmlFor="apiKey"
        hint="Encrypted before storage and only decrypted on the server."
      >
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          required
          placeholder="Paste the key"
          className={`${inputClass} font-mono`}
        />
      </Field>

      <Field
        label="Model to test it with"
        htmlFor="model"
        hint="We send one short request to prove the key works before saving it."
      >
        <input
          id="model"
          name="model"
          defaultValue={SUGGESTED_MODEL[provider]}
          key={provider}
          required
          className={`${inputClass} font-mono`}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Testing the key…">Connect this key</SubmitButton>
        {state.notice && <span className="text-xs font-medium text-emerald-700">{state.notice}</span>}
        {state.error && (
          <span role="alert" className="text-xs font-medium text-rose-700">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

export function RemoveKeyButton() {
  const [state, submit] = useActionState<FormState, FormData>(removeJudgeKey, {});

  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="confirm" value="remove" />
      <SubmitButton variant="danger" size="sm" pendingLabel="Removing…">
        Remove this key
      </SubmitButton>
      <span className="text-xs text-slate-500">
        Runs would go back to the capped trial allowance.
      </span>
      {state.notice && <span className="text-xs font-medium text-emerald-700">{state.notice}</span>}
      {state.error && <span className="text-xs font-medium text-rose-700">{state.error}</span>}
    </form>
  );
}
