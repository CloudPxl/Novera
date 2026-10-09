"use client";

import { useActionState } from "react";
import { requestWorkspaceExport, type ExportState } from "@/lib/workflow/workspace-export.ts";
import { SubmitButton } from "@/components/ui/button.tsx";

/** Asks for an export, then offers its one-time download link. */
export function ExportWorkspaceForm() {
  const [state, submit] = useActionState<ExportState, FormData>(requestWorkspaceExport, {});
  return (
    <form action={submit} className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="includeRawEvidence" className="mt-0.5 size-4 accent-current" />
        <span>
          Include the agent&apos;s raw replies, transcripts and the scenario inputs sent, where retention still holds them.
          <span className="block text-xs text-ink-faint">They may contain personal data. Without them, personal data a grader quoted is shown as placeholders, as in a sealed report.</span>
        </span>
      </label>
      {state.error && <p role="alert" className="rounded-control border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">{state.error}</p>}
      {state.notice && <p role="status" className="rounded-control border border-pass-border bg-pass-surface px-3 py-2 text-sm text-pass-text">{state.notice}</p>}
      {state.link && (
        <p>
          <a href={state.link} download className="text-sm font-medium text-ink underline underline-offset-2">Download the export (JSON)</a>
        </p>
      )}
      <SubmitButton size="sm" variant="secondary" pendingLabel="Preparing…">Prepare an export</SubmitButton>
    </form>
  );
}
