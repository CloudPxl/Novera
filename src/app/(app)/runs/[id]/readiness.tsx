"use client";

import { useActionState } from "react";
import { withdrawReport, type FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/primitives.tsx";
import type { Readiness, ReadinessCheck } from "@/lib/report/readiness.ts";

const TONE: Record<Readiness, "pass" | "fail" | "neutral" | "error"> = {
  READY_TO_SHARE: "pass",
  READY_FOR_INTERNAL_REVIEW: "neutral",
  INCOMPLETE: "error",
  WITHHELD: "error",
  BLOCKED_BY_EVIDENCE: "fail",
  REVOKED: "neutral",
  EXPIRED: "neutral",
};
const MARK = { ok: "✓", gap: "!", note: "·" } as const;
const SAID = { ok: "met", gap: "not met", note: "note" } as const;

/**
 * Whether the sealed report is something to hand a client, from stored rows
 * (src/lib/report/readiness.ts), and the one control that takes it back.
 */
export function ReadinessPanel({ state, label, checks, token }: { state: Readiness; label: string; checks: ReadinessCheck[]; token: string }) {
  const [result, submit] = useActionState<FormState, FormData>(withdrawReport, {});
  const open = state !== "REVOKED" && state !== "EXPIRED";
  return (
    <section aria-label="Before you send the report" className="mt-4 rounded-control bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Before you send it</h2>
        <Badge tone={TONE[state]}>{label}</Badge>
      </div>
      <ul className="mt-3 space-y-1.5">
        {checks.map((c) => (
          <li key={c.label} className="flex gap-2 text-sm leading-relaxed">
            <span aria-hidden className={`w-3 shrink-0 text-center ${c.result === "gap" ? "text-fail-text" : c.result === "ok" ? "text-pass-text" : "text-ink-faint"}`}>{MARK[c.result]}</span>
            <span className="min-w-0">
              <span className="sr-only">{SAID[c.result]}: </span>
              <span className="text-ink">{c.label}.</span> <span className="text-ink-soft">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {open && (
        <form action={submit} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <input type="hidden" name="token" value={token} />
          <label className="flex items-start gap-2 text-sm text-ink-soft">
            <input type="checkbox" name="confirm" required className="mt-0.5 size-4 accent-ink" />
            <span>Withdraw it: this run&rsquo;s report links — the original and any reissue — and every download stop working for everyone who has them. This cannot be undone.</span>
          </label>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Withdrawing…">Withdraw this report</SubmitButton>
          {result.error && <p role="alert" className="basis-full text-xs font-medium text-fail-text">{result.error}</p>}
        </form>
      )}
      {/* Outside the form: once withdrawn, the form is gone and this is what is left to say. */}
      {result.notice && <p role="status" className="mt-3 text-xs font-medium text-pass-text">{result.notice}</p>}
    </section>
  );
}
