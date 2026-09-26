"use client";

import { useActionState, useState } from "react";
import { saveJudgeKey, removeJudgeKey, type FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";

export interface ProviderChoice {
  id: string;
  label: string;
  /** Models we ourselves call on this provider, offered as a starting point. */
  suggested: string[];
}

/**
 * The result of a server action, announced rather than merely rendered.
 *
 * Both outcomes are live regions: connecting a credential is the one action on this
 * page with a consequence, and finding out whether it worked should not depend on
 * noticing coloured text appear beside a button.
 */
function Outcome({ state }: { state: FormState }) {
  return (
    <>
      {state.notice && (
        <p role="status" className="text-xs font-medium leading-relaxed text-pass-text">
          {state.notice}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-xs font-medium leading-relaxed text-fail-text">
          {state.error}
        </p>
      )}
    </>
  );
}

/**
 * Connecting a key, and replacing one.
 *
 * They are the same form on purpose. Rotating a credential used to mean removing the
 * working key first, which dropped the workspace onto a trial allowance it had usually
 * exhausted, and left it with nothing at all if the new key then failed its test. Since
 * the key is proved before it is stored, replacing in place is strictly safer: a failed
 * replacement changes nothing.
 */
export function JudgeKeyForm({
  providers,
  replacing = false,
}: {
  providers: ProviderChoice[];
  replacing?: boolean;
}) {
  const [state, submit] = useActionState<FormState, FormData>(saveJudgeKey, {});
  const [provider, setProvider] = useState(providers[0]?.id ?? "groq");
  const chosen = providers.find((p) => p.id === provider);

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
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </Field>

      <Field
        label="API key"
        htmlFor="apiKey"
        hint="Encrypted before storage and only decrypted on the server, for the length of one request."
      >
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          required
          maxLength={500}
          placeholder="Paste the key"
          className={`${inputClass} font-mono`}
        />
      </Field>

      <Field
        label="Model to grade with"
        htmlFor="model"
        hint="Every verdict in your runs comes from this model. We send one short request to prove your key can reach it before saving anything."
      >
        <input
          id="model"
          name="model"
          defaultValue={chosen?.suggested[0] ?? ""}
          key={`${provider}-1`}
          required
          maxLength={120}
          className={`${inputClass} font-mono`}
        />
      </Field>

      <Field
        label="Second model, for corroboration"
        htmlFor="secondModel"
        hint="Optional, and it changes what a verdict means: with one model a case is graded by one opinion and reported as not corroborated. Two models from the same provider are corroborated within one vendor — which the report states, because they can still share a blind spot."
      >
        <input
          id="secondModel"
          name="secondModel"
          defaultValue={chosen?.suggested[1] ?? ""}
          key={`${provider}-2`}
          maxLength={120}
          placeholder="Leave empty for a single opinion"
          className={`${inputClass} font-mono`}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel={replacing ? "Testing the new key…" : "Testing the key…"}>
          {replacing ? "Replace the key" : "Connect this key"}
        </SubmitButton>
        {replacing && (
          <span className="text-xs text-ink-faint">
            The key in use now is kept until the new one has answered.
          </span>
        )}
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function RemoveKeyButton({ consequence }: { consequence: string }) {
  const [state, submit] = useActionState<FormState, FormData>(removeJudgeKey, {});

  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="confirm" value="remove" />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="danger" size="sm" pendingLabel="Removing…">
          Remove this key
        </SubmitButton>
        <span className="text-xs leading-relaxed text-ink-faint">{consequence}</span>
      </div>
      <Outcome state={state} />
    </form>
  );
}
