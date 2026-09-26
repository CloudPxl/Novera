"use client";

import { useActionState, useMemo, useState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import type { FormState } from "@/lib/workflow/actions.ts";
import { submitProductionFailure } from "@/lib/workflow/scenarios.ts";
import { OBLIGATION_LABELS } from "@/lib/report/payload.ts";
import { redact, NOT_DETECTED } from "@/lib/redact/pii.ts";

/**
 * Recording a production failure.
 *
 * The preview is the same redaction the server applies before storing, run as you type,
 * so a person sees exactly what will be kept — and can see what it did not catch.
 */
export function FailureForm({ agents }: { agents: Array<{ id: string; name: string }> }) {
  const [state, submit] = useActionState<FormState, FormData>(submitProductionFailure, {});
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const preview = useMemo(() => {
    const m = redact(message);
    const r = redact(reply);
    const counts: Record<string, number> = {};
    for (const c of [m.counts, r.counts]) for (const [k, n] of Object.entries(c)) counts[k] = (counts[k] ?? 0) + (n ?? 0);
    return { message: m.text, reply: r.text, counts };
  }, [message, reply]);
  const removed = Object.entries(preview.counts);

  return (
    <form action={submit} className="mt-4 space-y-4">
      <Field label="What the customer sent" htmlFor="customerMessage" hint="This becomes the message the scenario sends to your agent.">
        <textarea
          id="customerMessage" name="customerMessage" required rows={4} maxLength={4000}
          value={message} onChange={(e) => setMessage(e.target.value)}
          className={`${inputClass} leading-relaxed`}
        />
      </Field>

      <Field label="What the agent replied (optional)" htmlFor="agentReply" hint="Kept beside the failure for context. Never sent anywhere.">
        <textarea
          id="agentReply" name="agentReply" rows={3} maxLength={8000}
          value={reply} onChange={(e) => setReply(e.target.value)}
          className={`${inputClass} leading-relaxed`}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What should have happened" htmlFor="expectedBehavior" hint="In one sentence. The scenario passes only if the agent does this.">
          <input id="expectedBehavior" name="expectedBehavior" required maxLength={1000} className={inputClass}
            placeholder="e.g. Refuses until the caller's identity is verified" />
        </Field>
        <Field label="What went wrong (optional)" htmlFor="whatWentWrong" hint="A reply that does this again fails the scenario.">
          <input id="whatWentWrong" name="whatWentWrong" maxLength={1000} className={inputClass}
            placeholder="e.g. Issued the refund without checking" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Obligation it broke" htmlFor="failure-obligation">
          <select id="failure-obligation" name="obligation" className={inputClass} defaultValue="policy_accuracy" required>
            {Object.entries(OBLIGATION_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </Field>
        <Field label="Severity" htmlFor="failure-severity">
          <select id="failure-severity" name="severity" className={inputClass} defaultValue="high" required>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Agent (optional)" htmlFor="failure-agent">
          <select id="failure-agent" name="agentId" className={inputClass} defaultValue="">
            <option value="">Not specified</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="When it happened (optional)" htmlFor="occurredOn">
          <input id="occurredOn" name="occurredOn" type="date" className={inputClass} />
        </Field>
      </div>

      {(message || reply) && (
        <div className="rounded-control border border-line bg-ground p-3 text-sm">
          <p className="type-pill text-ink-faint">What will be stored</p>
          <p className="mt-2 whitespace-pre-wrap text-ink">{preview.message || "—"}</p>
          {preview.reply && <p className="mt-2 whitespace-pre-wrap text-ink-soft">{preview.reply}</p>}
          <p className="mt-2 text-xs text-ink-soft">
            {removed.length
              ? `Removed automatically: ${removed.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}.`
              : "Nothing was removed automatically."}{" "}
            <span className="font-medium text-warning-text">{NOT_DETECTED}</span> The original text is not kept.
          </p>
        </div>
      )}

      <div>
        <SubmitButton pendingLabel="Recording…">Record and draft a scenario</SubmitButton>
        {(state.error || state.notice) && (
          <p role="status" className={`mt-3 type-body ${state.error ? "text-fail-text" : "text-pass-text"}`}>
            {state.error ?? state.notice}
          </p>
        )}
      </div>
    </form>
  );
}
