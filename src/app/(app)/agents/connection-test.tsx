"use client";

import { useRef, useState, useTransition } from "react";
import { testAgentConnection, type PreflightView } from "@/lib/workflow/connection-actions.ts";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/primitives.tsx";

/**
 * "Test connection": sends the form's unsaved values as one diagnostic message and shows what
 * came back. Called on click rather than as the form's action, so React never resets the form —
 * everything typed, the credential included, is still there after the test.
 *
 * Decide level: one line saying what happened, with the reply or the keys behind a quiet
 * second line. Nothing here is stored.
 */
export function ConnectionTest({ idPrefix }: { idPrefix: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PreflightView | null>(null);
  const [pending, start] = useTransition();
  const resultId = `${idPrefix}-test-result`;

  function test() {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const data = new FormData(form);
    start(async () => {
      try {
        setView(await testAgentConnection(data));
      } catch {
        setView({ refused: "The test could not be run just now. Nothing was sent; try again in a moment." });
      }
    });
  }

  function applyPath(path: string) {
    const form = anchor.current?.closest("form");
    const input = form?.elements.namedItem("responsePath");
    if (!(input instanceof HTMLInputElement)) return;
    input.value = path;
    input.closest("details")?.setAttribute("open", "");
    input.focus();
  }

  return (
    <div ref={anchor} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={test} disabled={pending} aria-describedby={view ? resultId : undefined}>
          {pending ? "Testing…" : "Test connection"}
        </Button>
        <span className="text-xs text-ink-faint">Sends one short message from what is in the form now. Nothing is saved.</span>
      </div>
      <div id={resultId} role="status" aria-live="polite">
        {view && !pending && <Result view={view} onUsePath={applyPath} />}
      </div>
    </div>
  );
}

function Result({ view, onUsePath }: { view: PreflightView; onUsePath: (path: string) => void }) {
  if ("refused" in view) {
    return (
      <p className="rounded-control border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-text">
        Not tested: {view.refused}
      </p>
    );
  }
  const r = view.result;
  return (
    <div className={`rounded-control border px-4 py-3 text-sm ${r.ok ? "border-pass-border bg-pass-surface" : "border-fail-border bg-fail-surface"}`}>
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={r.ok ? "pass" : "fail"}>{r.ok ? "Answered" : "Did not work"}</Badge>
        <span className={`font-medium ${r.ok ? "text-pass-text" : "text-fail-text"}`}>{r.headline}</span>
      </p>
      {r.replyPreview !== undefined && (
        <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-ink [overflow-wrap:anywhere]">
          {r.replyPreview}
        </blockquote>
      )}
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">{r.detail}</p>
      {r.topLevelKeys && r.topLevelKeys.length > 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          Top-level keys:{" "}
          {r.topLevelKeys.map((k, i) => (
            <span key={`${k}-${i}`}>{i > 0 ? ", " : ""}<code className="rounded bg-sunken px-1 py-0.5 font-mono text-ink">{k}</code></span>
          ))}
        </p>
      )}
      {r.suggestedPath && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <span>The reply looks like it is at <code className="rounded bg-sunken px-1 py-0.5 font-mono text-ink">{r.suggestedPath}</code>.</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => onUsePath(r.suggestedPath as string)}>
            Use this reply path
          </Button>
        </p>
      )}
    </div>
  );
}
