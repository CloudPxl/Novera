"use client";

import { useActionState, useState } from "react";
import { savePolicyVersion, reprobeAgent, type FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { inputClass } from "@/components/ui/primitives.tsx";

const STARTER = `Refunds are granted within 14 days of purchase, once the requester's identity has been confirmed using the approved verification steps.
Account changes, data exports and deletions require identity verification before any action is taken.
Published pricing is the only pricing. Discounts and exceptions are decided by a human, never by the agent.
Answer only from the approved product documentation. If the documentation does not establish an answer, say so and route the question.
Billing disputes follow the documented escalation path.`;

export function PolicyEditor({
  agentId,
  latest,
  history,
}: {
  agentId: string;
  latest: { version: number; body: string } | null;
  history: Array<{ version: number; createdAt: string }>;
}) {
  const [state, submit] = useActionState<FormState, FormData>(savePolicyVersion, {});
  const [body, setBody] = useState(latest?.body ?? STARTER);
  const changed = body.trim() !== (latest?.body ?? "").trim();

  return (
    <form action={submit} className="mt-4">
      <input type="hidden" name="agentId" value={agentId} />
      <textarea
        name="body"
        rows={9}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className={`${inputClass} leading-relaxed`}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Saving…" disabled={!changed}>
          {latest ? `Save as version ${latest.version + 1}` : "Save version 1"}
        </SubmitButton>
        {!changed && latest && (
          <span className="text-xs text-slate-500">
            Unchanged from version {latest.version}. Edit the text to create a new version.
          </span>
        )}
        {state.notice && <span className="text-xs font-medium text-emerald-700">{state.notice}</span>}
        {state.error && <span className="text-xs font-medium text-rose-700">{state.error}</span>}
      </div>

      {history.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          {history.length} version{history.length === 1 ? "" : "s"} kept — v
          {history.map((h) => h.version).join(", v")}
        </p>
      )}
    </form>
  );
}

export function ReprobeButton({ agentId }: { agentId: string }) {
  const [state, submit] = useActionState<FormState, FormData>(reprobeAgent, {});

  return (
    <form action={submit} className="flex items-center gap-3">
      <input type="hidden" name="agentId" value={agentId} />
      {state.notice && <span className="text-xs font-medium text-emerald-700">{state.notice}</span>}
      {state.error && <span className="text-xs font-medium text-rose-700">{state.error}</span>}
      <SubmitButton variant="secondary" size="sm" pendingLabel="Testing…">
        Test connection
      </SubmitButton>
    </form>
  );
}
