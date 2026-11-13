"use client";

import { useRef, useState, useTransition } from "react";
import { testAgentConnection, type PreflightView } from "@/lib/workflow/connection-actions.ts";
import type { PreflightInspector, PreflightResult } from "@/lib/agents/preflight.ts";
import { addToInputs } from "./connection-fields.tsx";
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
export function ConnectionTest({ idPrefix, label = "Test connection" }: { idPrefix: string; label?: string }) {
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
          {pending ? "Testing…" : label}
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
      {r.inputForm && <DeclaredInputs form={r.inputForm} />}
      {r.inspector && <Inspector inspector={r.inspector} statusCode={r.statusCode} latencyMs={r.latencyMs} onUsePath={onUsePath} />}
    </div>
  );
}

const FORMAT_WORDS = {
  json: "JSON", event_stream: "a stream of server-sent events", json_lines: "JSON lines", text_stream: "a text stream", text: "plain text",
} as const;

/**
 * What was sent and how the answer was read, for the person configuring the connection. Prove
 * level: behind a disclosure, exact, and nothing in it is stored. The credential is never shown.
 */
function Inspector({ inspector, statusCode, latencyMs, onUsePath }: {
  inspector: PreflightInspector; statusCode: number | null; latencyMs: number | null; onUsePath: (path: string) => void;
}) {
  const { request, response, fields, notes } = inspector;
  const mono = "rounded bg-sunken px-1 py-0.5 font-mono text-ink";
  return (
    <details className="group mt-3 rounded-control border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span>What was sent and what came back</span>
        <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3 text-xs text-ink-soft">
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
          <dt className="text-ink-faint">Sent</dt>
          <dd className="[overflow-wrap:anywhere]"><code className={mono}>{request.method} {request.address}</code></dd>
          <dt className="text-ink-faint">Headers</dt>
          <dd className="[overflow-wrap:anywhere]">{request.headers.join(" · ")}</dd>
          <dt className="text-ink-faint">Answered</dt>
          <dd>{statusCode !== null ? `HTTP ${statusCode}` : "No HTTP answer"}{latencyMs !== null ? ` in ${latencyMs} ms` : ""}</dd>
          <dt className="text-ink-faint">Content type</dt>
          <dd className="[overflow-wrap:anywhere]">{response.contentType ?? "not stated"}</dd>
          <dt className="text-ink-faint">Read as</dt>
          <dd>{response.format ? FORMAT_WORDS[response.format] : "nothing readable"}{response.pieces !== null ? `, ${response.pieces} piece${response.pieces === 1 ? "" : "s"} of the reply` : ""}</dd>
          <dt className="text-ink-faint">Reply read at</dt>
          <dd>{response.matchedPath ? <code className={mono}>{response.matchedPath}</code> : "not found"}{response.structured ? ", structured data read as JSON" : ""}</dd>
          {response.eventKinds && (
            <>
              <dt className="text-ink-faint">Events</dt>
              <dd className="[overflow-wrap:anywhere]">{Object.entries(response.eventKinds).map(([k, n]) => `${k} ×${n}`).join(", ")}</dd>
            </>
          )}
        </dl>
        <div>
          <p className="text-ink-faint">Request body{request.bodyTruncated ? " (cut)" : ""}</p>
          <pre className="mt-1 max-h-56 overflow-auto rounded-control bg-sunken p-2 font-mono text-[11px] leading-relaxed text-ink [overflow-wrap:anywhere] whitespace-pre-wrap">{request.body}</pre>
        </div>
        {fields.length > 0 && (
          <div>
            <p className="text-ink-faint">Text fields in the answer. Choose the one that holds the agent&apos;s reply.</p>
            <ul className="mt-1 divide-y divide-line">
              {fields.map((f) => (
                <li key={f.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <code className={mono}>{f.path}</code>
                  <span className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{f.preview}</span>
                  <Button type="button" variant="secondary" size="sm" onClick={() => onUsePath(f.path)}>Use as reply path</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="list-disc space-y-1 pl-4">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>
    </details>
  );
}

/**
 * The input variables a Dify app declares, with the required ones the request body does not carry.
 * Adding them only writes into the form's request body; the person still tests and saves it.
 */
export function DeclaredInputs({ form }: { form: NonNullable<PreflightResult["inputForm"]> }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState<string | null>(null);
  const missing = new Set(form.missing);
  const add = () => setSaid(addToInputs(anchor.current?.closest("form"), form.variables.map((v) => [v.variable, v.defaultValue ?? (v.options?.[0] ?? "")] as const)));
  return (
    <div ref={anchor} className="mt-3 rounded-control bg-surface px-3 py-2 text-xs leading-relaxed text-ink-soft ring-1 ring-line">
      <p className="font-medium text-ink">
        This Dify app declares {form.variables.length} input variable{form.variables.length === 1 ? "" : "s"}
        {form.missing.length ? `; ${form.missing.length} required one${form.missing.length === 1 ? " is" : "s are"} missing from the request body` : ""}.
      </p>
      <ul className="mt-1 space-y-0.5">
        {form.variables.map((v) => (
          <li key={v.variable} className="[overflow-wrap:anywhere]">
            <code className="rounded bg-sunken px-1 py-0.5 font-mono text-ink">{v.variable}</code>
            {" "}{v.type}{v.required ? ", required" : ", optional"}
            {v.defaultValue !== null ? `, default "${v.defaultValue}"` : ""}
            {missing.has(v.variable) && <span className="font-medium text-fail-text"> — missing</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={add}>Add them to the request body</Button>
        <span>Defaults are filled in where the app has one. Give every required variable a value before testing again: a run sends what is saved, nothing more.</span>
      </p>
      {said && <p role="status" className="mt-1">{said}</p>}
    </div>
  );
}
