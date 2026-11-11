"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Badge, Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";
import { CATEGORY_LABEL, FACT_KEYS, FACT_LABEL, classify, parseFacts, type TargetFacts } from "@/lib/insight/classify.ts";
import {
  abortInsightScan, createInsightTarget, markInsightDoNotContact, queueInsightScan, reclassifyInsightTarget, type InsightFormState,
} from "@/lib/workflow/insight.ts";
import { CATEGORY_TONE } from "./tone.ts";

function Answer({ state }: { state: InsightFormState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-fail-text">{state.error}</p>}
      {state.notice && <p role="status" className="text-sm font-medium text-pass-text">{state.notice}</p>}
    </>
  );
}

/** The yes/no facts, with the category they give shown as they change. The category is never picked. */
function Facts({ initial }: { initial: TargetFacts }) {
  const [facts, setFacts] = useState<TargetFacts>(initial);
  const { category, reasons } = classify(facts);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">What the bot can reach</legend>
      <p className="text-xs leading-relaxed text-ink-faint">Tick what is true. The category follows from these; it cannot be chosen.</p>
      {FACT_KEYS.map((key) => (
        <label key={key} className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name={key} defaultChecked={initial[key]} className="mt-1"
            onChange={(e) => setFacts((f) => ({ ...f, [key]: e.target.checked }))} />
          <span>{FACT_LABEL[key]}</span>
        </label>
      ))}
      <div className="mt-3 rounded-control border border-line bg-ground/60 px-3 py-2" aria-live="polite">
        <Badge tone={CATEGORY_TONE[category]}>Category {category}</Badge>
        <p className="mt-1 text-sm text-ink">{CATEGORY_LABEL[category]}</p>
        <ul className="mt-1 list-disc pl-5 text-xs text-ink-soft">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
    </fieldset>
  );
}

export function TargetForm() {
  const [state, submit] = useActionState<InsightFormState, FormData>(createInsightTarget, {});
  const keep = useKeepValuesOnError(state);
  return (
    <form onSubmitCapture={keep} action={submit} className="space-y-5">
      <Field label="Company or bot name" htmlFor="name">
        <input id="name" name="name" required maxLength={200} className={inputClass} autoComplete="off" />
      </Field>
      <Field label="Public demo page" htmlFor="demo_url" hint="The https address where anyone can open the chat, without an account.">
        <input id="demo_url" name="demo_url" type="url" required inputMode="url" placeholder="https://" className={inputClass} autoComplete="off" />
      </Field>
      <Field label="Sector (optional)" htmlFor="sector">
        <input id="sector" name="sector" maxLength={100} className={inputClass} autoComplete="off" />
      </Field>
      <Facts initial={parseFacts({})} />
      <Field label="Notes (optional)" htmlFor="notes" hint="For this workspace only. Never sent to the company or to a model.">
        <textarea id="notes" name="notes" maxLength={4000} rows={3} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save target</SubmitButton>
        <Answer state={state} />
      </div>
    </form>
  );
}

export function ReclassifyForm({ targetId, facts }: { targetId: string; facts: TargetFacts }) {
  const [state, submit] = useActionState<InsightFormState, FormData>(reclassifyInsightTarget, {});
  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="targetId" value={targetId} />
      <Facts initial={facts} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Save the facts</SubmitButton>
        <Answer state={state} />
      </div>
    </form>
  );
}

export function QueueScanForm({ targetId, scenarios }: { targetId: string; scenarios: number }) {
  const [state, submit] = useActionState<InsightFormState, FormData>(queueInsightScan, {});
  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="targetId" value={targetId} />
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="confirm" className="mt-1" required />
        <span>This page is a public demo that anyone may use without an account, and the facts above are true.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Queueing…">Run automated scan</SubmitButton>
        <span className="text-xs text-ink-faint">{scenarios} questions, one at a time, at least 12 s apart, by Novera&rsquo;s browser worker.</span>
      </div>
      <Answer state={state} />
    </form>
  );
}

export function DoNotContactForm({ targetId }: { targetId: string }) {
  const [state, submit] = useActionState<InsightFormState, FormData>(markInsightDoNotContact, {});
  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="targetId" value={targetId} />
      <p className="text-sm text-ink-soft">No scan will run for this target again, and a scan waiting or running for it ends now. This cannot be undone.</p>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="confirm" className="mt-1" required />
        <span>Mark this target do not contact</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Mark do not contact</SubmitButton>
        <Answer state={state} />
      </div>
    </form>
  );
}

export function AbortScanForm({ scanId }: { scanId: string }) {
  const [state, submit] = useActionState<InsightFormState, FormData>(abortInsightScan, {});
  const keep = useKeepValuesOnError(state);
  return (
    <form onSubmitCapture={keep} action={submit} className="space-y-3">
      <input type="hidden" name="scanId" value={scanId} />
      <Field label="Why" htmlFor="abort-reason" hint="Kept with the scan.">
        <input id="abort-reason" name="reason" required minLength={3} maxLength={500} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Aborting…">Abort scan</SubmitButton>
        <Answer state={state} />
      </div>
    </form>
  );
}

/** While a scan is queued or running, asks the server for the page again every few seconds. Reads only; drives nothing. */
export function LiveScan({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, router]);
  return active ? <p className="sr-only" role="status">This page updates while the scan runs.</p> : null;
}
