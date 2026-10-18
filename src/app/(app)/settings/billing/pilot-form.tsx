"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";
import { redeemPilotCode, type PilotFormState } from "@/lib/billing/pilot-actions.ts";

/** The sentence, with its next step linked where the sentence names it. */
function Sentence({ text, link }: { text: string; link?: PilotFormState["link"] }) {
  const at = link ? text.indexOf(link.phrase) : -1;
  if (!link || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Link href={link.href} className="font-medium text-ink underline underline-offset-2">{link.phrase}</Link>
      {text.slice(at + link.phrase.length)}
    </>
  );
}

/**
 * One field, the code. The workspace, the runs and the dates are the server's to decide
 * (src/lib/billing/pilot-actions.ts). A refused code stays in the field to be corrected.
 *
 * Once the workspace has redeemed a code (`redeemed`), only the answer stays: the page refreshes
 * after a redemption, and this component keeps its place so "Pilot unlocked: …" is still read.
 */
export function PilotCodeForm({ maxLength, redeemed = false }: { maxLength: number; redeemed?: boolean }) {
  const [state, submit] = useActionState<PilotFormState, FormData>(redeemPilotCode, {});
  const keepValues = useKeepValuesOnError(state);

  if (redeemed) {
    return state.notice ? <p role="status" className="text-sm font-medium text-pass-text">{state.notice}</p> : null;
  }

  return (
    <form onSubmitCapture={keepValues} action={submit} className="space-y-3">
      <Field
        label="Pilot code"
        htmlFor="pilot-code"
        hint={<>The code Novera sent you, for example <span className="whitespace-nowrap">PILOT-EXAMPLE-30</span>. Capitals and spaces do not matter.</>}
      >
        <input
          id="pilot-code"
          name="code"
          type="text"
          required
          maxLength={maxLength}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className={`${inputClass} font-mono uppercase sm:max-w-sm`}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Checking the code…">Unlock pilot runs</SubmitButton>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-fail-text"><Sentence text={state.error} link={state.link} /></p>
      )}
      {state.notice && <p role="status" className="text-sm font-medium text-pass-text">{state.notice}</p>}
    </form>
  );
}
