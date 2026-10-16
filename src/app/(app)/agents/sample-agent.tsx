"use client";

import { useActionState } from "react";
import { createSampleAgent } from "@/lib/workflow/connection-actions.ts";
import type { FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { SAMPLE_RUN_NOTE } from "@/lib/agents/sample.ts";

/**
 * "Or try a sample support agent first": Novera's own scripted fixture, connected in one press
 * and labelled test data everywhere it appears. A second press opens the one already there.
 */
export function SampleAgentButton({ className = "" }: { className?: string }) {
  const [state, submit] = useActionState<FormState, FormData>(createSampleAgent, {});
  return (
    <form action={submit} className={className}>
      <SubmitButton variant="secondary" size="sm" pendingLabel="Adding the sample…">
        Or try a sample support agent first
      </SubmitButton>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
        Novera&rsquo;s own scripted test fixture, with failures planted on purpose; its runs are labelled test data. {SAMPLE_RUN_NOTE}
      </p>
      {state.error && <p role="alert" className="mt-2 text-sm text-fail-text">{state.error}</p>}
    </form>
  );
}
