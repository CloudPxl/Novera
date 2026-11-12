"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { CUSTOM_PRESET, PRESETS, detectPreset, normalisePresetUrl, presetByKey, presetFormValues, type ConnectionPreset } from "@/lib/agents/presets.ts";
import { importCurl, type CurlImport } from "@/lib/agents/curl.ts";

const code = "rounded bg-sunken px-1 py-0.5 font-mono text-ink";

/** Writes values into the surrounding form's own fields, as a person typing them would. */
function fill(form: HTMLFormElement | null | undefined, values: Record<string, string | undefined>) {
  if (!form) return;
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = value;
  }
}

/**
 * Where a new connection starts: a platform's format, or a `curl` command from its documentation.
 * Both only fill the form below — the same fields a person could type — and both run in the page:
 * nothing is sent anywhere until the connection is verified or saved.
 */
export function ConnectionStarter() {
  const anchor = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<ConnectionPreset>(PRESETS[0]);
  const [offered, setOffered] = useState<ConnectionPreset | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [imported, setImported] = useState<CurlImport | { error: string } | null>(null);
  const form = () => anchor.current?.closest("form");

  function apply(next: ConnectionPreset) {
    setPreset(next);
    setOffered(null);
    fill(form(), presetFormValues(next));
    const url = form()?.elements.namedItem("url");
    if (url instanceof HTMLInputElement) {
      url.placeholder = next.urlExample;
      if (next.key === "voiceflow" && !url.value) url.value = next.urlExample;
      settleUrl(next, url);
    }
  }

  function settleUrl(current: ConnectionPreset, url: HTMLInputElement) {
    if (!url.value.trim()) return;
    const settled = normalisePresetUrl(current.key, url.value);
    if (settled.note) url.value = settled.url;
    setNote(settled.note);
  }

  function onUrlBlur(event: React.FocusEvent<HTMLDivElement>) {
    const url = event.target;
    if (!(url instanceof HTMLInputElement) || url.name !== "url") return;
    if (preset.key === CUSTOM_PRESET) {
      const guess = detectPreset(url.value);
      setOffered(guess && guess.key !== CUSTOM_PRESET ? guess : null);
    } else {
      settleUrl(preset, url);
    }
  }

  function readCurl() {
    const box = anchor.current?.querySelector<HTMLTextAreaElement>("#curl-command");
    if (!box || !box.value.trim()) return;
    const result = importCurl(box.value);
    setImported(result);
    if ("error" in result) return;
    const chosen = presetByKey(result.values.preset) ?? PRESETS[0];
    setPreset(chosen);
    setOffered(null);
    fill(form(), { ...(result.values.preset ? presetFormValues(chosen) : {}), ...result.values });
    const url = form()?.elements.namedItem("url");
    if (url instanceof HTMLInputElement) settleUrl(chosen, url);
    // The command carried a credential: it is in the form's password field now, and not kept here.
    box.value = "";
  }

  return (
    <div ref={anchor} className="space-y-6" onBlur={onUrlBlur}>
      <Field label="Start from" htmlFor="preset-picker" hint={preset.about}>
        <select
          id="preset-picker" className={inputClass} value={preset.key}
          onChange={(e) => apply(presetByKey(e.target.value) ?? PRESETS[0])}
        >
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </Field>
      {preset.edit && (
        <p className="rounded-control border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-text">{preset.edit}</p>
      )}

      <details className="group rounded-panel border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
          <span>
            <span className="font-medium">Or paste a curl command from your platform&apos;s API documentation</span>
            <span className="mt-0.5 block text-xs text-ink-faint">Read in this page to fill the form: the address, the headers and the request body. The command is never run and never sent to Novera.</span>
          </span>
          <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
        </summary>
        <div className="space-y-3 border-t border-line px-4 py-4">
          <label htmlFor="curl-command" className="sr-only">curl command</label>
          <textarea
            id="curl-command" rows={5} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true"
            className={`${inputClass} font-mono text-xs`}
            placeholder={"curl -X POST 'https://api.example.com/v1/chat-messages' \\\n  -H 'Authorization: Bearer YOUR-KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"query\": \"Hello\"}'"}
          />
          <Button type="button" variant="secondary" size="sm" onClick={readCurl}>Read the command and fill the form</Button>
          <div role="status" aria-live="polite">
            {imported && "error" in imported && <p className="text-sm text-fail-text">{imported.error}</p>}
            {imported && !("error" in imported) && (
              <div className="rounded-control border border-line bg-ground/60 px-3 py-2 text-sm">
                <p className="font-medium text-ink">Read from the command</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
                  {imported.found.map((line) => <li key={line} className="[overflow-wrap:anywhere]">{line}</li>)}
                </ul>
                {imported.todo.length > 0 && (
                  <>
                    <p className="mt-2 font-medium text-warning-text">Still to check</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
                      {imported.todo.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </>
                )}
                <p className="mt-2 text-xs text-ink-faint">The fields below now hold these values. Verify the connection to see what the endpoint answers.</p>
              </div>
            )}
          </div>
        </div>
      </details>

      <Field label="Endpoint URL" htmlFor="url" hint="Where Novera sends each scenario, as a POST. Checked to be a public address.">
        <input id="url" name="url" required className={inputClass} placeholder={preset.urlExample} inputMode="url" autoCapitalize="none" spellCheck={false} />
      </Field>
      <div role="status" aria-live="polite" className="-mt-3 space-y-2 empty:hidden">
        {note && <p className="text-xs text-ink-soft">{note}</p>}
        {offered && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span>This address looks like {offered.label}.</span>
            <Button type="button" variant="secondary" size="sm" onClick={() => apply(offered)}>Use that format</Button>
          </p>
        )}
      </div>
    </div>
  );
}

export interface AdvancedDefaults {
  headers: string;
  streamPath: string;
  conversationIdPath: string;
  inlineChannels: boolean;
  preset: string;
}

/**
 * The rest of how a request is made and its answer read: fixed headers, a streamed reply, an id
 * the agent issues. Most connections leave these empty.
 */
export function AdvancedConnectionFields({ idPrefix, defaults }: { idPrefix: string; defaults: AdvancedDefaults }) {
  return (
    <>
      <input type="hidden" name="preset" defaultValue={defaults.preset} />
      <Field
        label="Other headers" htmlFor={`${idPrefix}-headers`}
        hint={<>Optional, one per line as <code className={code}>Name: value</code>. Stored as written and never secret: a header that carries a key belongs under Authentication.</>}
      >
        <textarea id={`${idPrefix}-headers`} name="headers" rows={2} defaultValue={defaults.headers} className={`${inputClass} font-mono text-xs`} placeholder="anthropic-version: 2023-06-01" spellCheck={false} />
      </Field>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Stream path" htmlFor={`${idPrefix}-stream`} hint="Optional. For an endpoint that answers as a stream of events: the field each event carries its piece of the reply in. Empty uses the reply path.">
          <input id={`${idPrefix}-stream`} name="streamPath" defaultValue={defaults.streamPath} className={`${inputClass} font-mono text-xs`} placeholder="answer" />
        </Field>
        <Field label="Conversation id path" htmlFor={`${idPrefix}-conversation`} hint={<>Optional. For a platform that issues its own conversation id: where it sits in the reply. It is then sent back in <code className={code}>{"{{conversation_id}}"}</code>.</>}>
          <input id={`${idPrefix}-conversation`} name="conversationIdPath" defaultValue={defaults.conversationIdPath} className={`${inputClass} font-mono text-xs`} placeholder="conversation_id" />
        </Field>
      </div>
    </>
  );
}

/**
 * The delivery choice, said where it is made: what happens to a scenario's metadata and earlier
 * turns when the request has no field for them.
 */
export function DeliveryChoice({ idPrefix, defaultChecked }: { idPrefix: string; defaultChecked: boolean }) {
  return (
    <label htmlFor={`${idPrefix}-inline`} className="flex gap-3 rounded-xl border border-line bg-ground/60 p-4 text-sm leading-relaxed">
      <input id={`${idPrefix}-inline`} type="checkbox" name="inlineChannels" defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 accent-slate-900" />
      <span>
        <span className="font-medium">Deliver metadata and earlier turns in the message when the request has no field for them.</span>
        <br />
        <span className="text-ink-soft">
          Some scenarios carry a retrieved document or a tool&apos;s result alongside the customer&apos;s message, or a turn that came before it.
          With this ticked they are sent as a labelled block at the top of the message, and the report says so beside each such scenario:
          a pass then shows the agent resisted that content inside a message, not through its own retrieval or tools.
          Unticked, those scenarios are not sent and the report lists them as not run.
        </span>
      </span>
    </label>
  );
}
