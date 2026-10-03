"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";
import type { FormState } from "@/lib/workflow/actions.ts";
import { AUTHORISE_FETCH, AUTHORISE_MATERIAL } from "@/lib/builder/constants.ts";
import {
  startBuildAction, addSourceAction, extractAction, observeAction, decideAction, editAction, answerAction,
  bulkApproveAction, attachProductionAction, scanAction, publishAction, abandonAction, sourceAsPolicyAction,
} from "@/lib/workflow/builder.ts";

function Message({ state }: { state: FormState }) {
  if (!state.error && !state.notice) return null;
  return (
    <p role="status" className={`mt-3 text-sm ${state.error ? "text-fail-text" : "text-pass-text"}`}>
      {state.error ?? state.notice}
    </p>
  );
}

export interface PackOption {
  key: string;
  title: string;
  version: number;
  scenarios: number;
  quick: number;
  minutesQuick: number;
  minutesFull: number;
}

export function StartForm({ packs, suggested, agents, goal, agency }: {
  packs: PackOption[];
  suggested: { key: string; quick: boolean };
  agents: Array<{ id: string; name: string }>;
  goal: string | null;
  agency: boolean;
}) {
  const [state, submit] = useActionState<FormState, FormData>(startBuildAction, {});
  const keepValues = useKeepValuesOnError(state);
  const [pack, setPack] = useState(suggested.key);
  const chosen = packs.find((p) => p.key === pack);
  return (
    <form onSubmitCapture={keepValues} action={submit} className="grid gap-5">
      <input type="hidden" name="goal" value={goal ?? ""} />
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-ink">Start from</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {packs.map((p) => (
            <label key={p.key} className={`flex cursor-pointer items-start gap-3 rounded-panel border px-3 py-2.5 text-sm ${pack === p.key ? "border-ink bg-surface" : "border-line bg-surface hover:border-line-strong"}`}>
              <input type="radio" name="pack" value={p.key} checked={pack === p.key} onChange={() => setPack(p.key)} className="mt-1" />
              <span className="min-w-0">
                <span className="block font-medium text-ink">{p.title} <span className="font-normal text-ink-faint">v{p.version}</span></span>
                <span className="block text-ink-soft">{p.scenarios} scenarios · quick start {p.quick}</span>
              </span>
            </label>
          ))}
          <label className={`flex cursor-pointer items-start gap-3 rounded-panel border px-3 py-2.5 text-sm ${pack === "none" ? "border-ink bg-surface" : "border-line bg-surface hover:border-line-strong"}`}>
            <input type="radio" name="pack" value="none" checked={pack === "none"} onChange={() => setPack("none")} className="mt-1" />
            <span className="min-w-0">
              <span className="block font-medium text-ink">No pack</span>
              <span className="block text-ink-soft">Only your own documents and observations</span>
            </span>
          </label>
        </div>
      </fieldset>

      {chosen && (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-ink">Size</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="size" value="quick" defaultChecked={suggested.quick} />
            Quick start — {chosen.quick} scenarios, about {chosen.minutesQuick} min to review
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="size" value="full" defaultChecked={!suggested.quick} />
            The whole pack — {chosen.scenarios} scenarios, about {chosen.minutesFull} min to review
          </label>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Suite name" htmlFor="name" hint="It becomes the suite's name when you publish it.">
          <input id="name" name="name" required maxLength={120} className={inputClass} defaultValue={chosen ? chosen.title : "Our support suite"} />
        </Field>
        {agents.length > 0 && (
          <Field label="Agent" htmlFor="agentId" hint="Optional now; needed for a scan.">
            <select id="agentId" name="agentId" className={inputClass} defaultValue={agents[0].id}>
              <option value="">Choose later</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        {agency && (
          <Field label="Prepared for" htmlFor="preparedFor" hint="The client this suite is for. Invite them as a reviewer to approve it.">
            <input id="preparedFor" name="preparedFor" maxLength={120} className={inputClass} />
          </Field>
        )}
      </div>
      <div>
        <SubmitButton pendingLabel="Starting…">Start the suite</SubmitButton>
        <Message state={state} />
      </div>
    </form>
  );
}

const KIND_LABEL = { pasted: "Paste text", upload: "Upload a file", url: "One public page", tool_schema: "Tool list or OpenAPI" } as const;

export function SourceForm({ buildId }: { buildId: string }) {
  const [state, submit] = useActionState<FormState, FormData>(addSourceAction, {});
  const keepValues = useKeepValuesOnError(state);
  const [kind, setKind] = useState<keyof typeof KIND_LABEL>("pasted");
  return (
    <form onSubmitCapture={keepValues} action={submit} className="grid gap-4">
      <input type="hidden" name="buildId" value={buildId} />
      <fieldset>
        <legend className="sr-only">What you are adding</legend>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
            <label key={k} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink ${kind === k ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface text-ink-soft"}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              {KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      {kind !== "url" && kind !== "upload" && (
        <Field label="Title" htmlFor="title" hint="What this is, e.g. “Refund policy”.">
          <input id="title" name="title" maxLength={200} className={inputClass} />
        </Field>
      )}
      {kind === "pasted" && (
        <Field label="Text" htmlFor="text" hint="Markdown or plain text, up to 300,000 characters. Email addresses, phone numbers and card numbers are replaced before it is stored.">
          <textarea id="text" name="text" rows={8} className={inputClass} />
        </Field>
      )}
      {kind === "tool_schema" && (
        <Field label="Tools" htmlFor="text" hint="A JSON list of tools ({name, description, parameters}) or an OpenAPI document. Recorded as declared by you.">
          <textarea id="text" name="text" rows={8} className={`${inputClass} font-mono text-xs`} />
        </Field>
      )}
      {kind === "upload" && (
        <Field label="File" htmlFor="file" hint=".docx, .md, .txt or .html, up to 2 MB. PDF is not read yet. The file itself is not kept: only its text and a SHA-256 of it.">
          <input id="file" name="file" type="file" accept=".docx,.md,.markdown,.txt,.html,.htm" className="text-sm" />
        </Field>
      )}
      {kind === "url" && (
        <Field label="Address of one page" htmlFor="url" hint="Fetched once, now. No links are followed; robots.txt is respected; public addresses only. Up to 2 MB.">
          <input id="url" name="url" type="url" inputMode="url" placeholder="https://help.example.com/refunds" className={inputClass} />
        </Field>
      )}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="authorised" className="mt-1" />
        <span>{kind === "url" ? AUTHORISE_FETCH : AUTHORISE_MATERIAL}</span>
      </label>
      <div>
        <SubmitButton pendingLabel={kind === "url" ? "Fetching…" : "Reading…"}>Add source</SubmitButton>
        <Message state={state} />
      </div>
    </form>
  );
}

/**
 * Stays on the page after the last part is read, disabled, so the result of that last
 * read — what was found, what was dropped and why — is not unmounted with the button.
 */
export function ExtractButton({ buildId, sourceId, label, done }: { buildId: string; sourceId: string; label: string; done: boolean }) {
  const [state, submit] = useActionState<FormState, FormData>(extractAction, {});
  return (
    <form action={submit}>
      <input type="hidden" name="buildId" value={buildId} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <SubmitButton size="sm" variant="secondary" disabled={done} pendingLabel="Reading… (up to a minute)">{done ? "Every part read" : label}</SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function PolicyFromSource({ buildId, sourceId, agentId, agentName }: { buildId: string; sourceId: string; agentId: string; agentName: string }) {
  const [state, submit] = useActionState<FormState, FormData>(sourceAsPolicyAction, {});
  return (
    <form action={submit}>
      <input type="hidden" name="buildId" value={buildId} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="agentId" value={agentId} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Use as {agentName}’s policy</SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function ObserveForm({ buildId, agents, defaultAgent }: { buildId: string; agents: Array<{ id: string; name: string }>; defaultAgent: string | null }) {
  const [state, submit] = useActionState<FormState, FormData>(observeAction, {});
  if (!agents.length) return <p className="text-sm text-ink-soft">Connect an agent first; then Novera can record what it observes.</p>;
  return (
    <form action={submit} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="buildId" value={buildId} />
      <Field label="Agent" htmlFor="observe-agent">
        <select id="observe-agent" name="agentId" className={inputClass} defaultValue={defaultAgent ?? agents[0].id}>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Observing…">Observe the agent</SubmitButton>
      <div className="basis-full"><Message state={state} /></div>
    </form>
  );
}

export function DecideForm({ buildId, draftId, canDecide, canEdit, blocked }: {
  buildId: string; draftId: string; canDecide: boolean; canEdit: boolean;
  /** Why approval is held, when an open question blocks it. */
  blocked: string | null;
}) {
  const [state, submit] = useActionState<FormState, FormData>(decideAction, {});
  if (!canDecide && !canEdit) return null;
  return (
    <form action={submit} className="grid gap-2">
      <input type="hidden" name="buildId" value={buildId} />
      <input type="hidden" name="draftId" value={draftId} />
      {blocked && <p className="text-sm text-warning-text">{blocked}</p>}
      <label className="sr-only" htmlFor={`reason-${draftId}`}>Reason</label>
      <input id={`reason-${draftId}`} name="reason" maxLength={1000} placeholder="Reason — needed to reject, mark not applicable or ask" className={inputClass} />
      <div className="flex flex-wrap gap-2">
        {canDecide && !blocked && <SubmitButton size="sm" name="decision" value="approve" pendingLabel="Saving…">Approve</SubmitButton>}
        {canDecide && <SubmitButton size="sm" variant="secondary" name="decision" value="reject" pendingLabel="Saving…">Reject</SubmitButton>}
        {canDecide && <SubmitButton size="sm" variant="secondary" name="decision" value="not_applicable" pendingLabel="Saving…">Not applicable</SubmitButton>}
        <SubmitButton size="sm" variant="secondary" name="decision" value="clarify" pendingLabel="Saving…">Ask for clarification</SubmitButton>
      </div>
      <Message state={state} />
    </form>
  );
}

export function EditForm({ buildId, draftId, input, expected, assertions, severity }: {
  buildId: string; draftId: string; input: string; expected: string; assertions: string[]; severity: string;
}) {
  const [state, submit] = useActionState<FormState, FormData>(editAction, {});
  const keepValues = useKeepValuesOnError(state);
  return (
    <form onSubmitCapture={keepValues} action={submit} className="grid gap-3">
      <input type="hidden" name="buildId" value={buildId} />
      <input type="hidden" name="draftId" value={draftId} />
      <Field label="Customer message" htmlFor={`in-${draftId}`}><textarea id={`in-${draftId}`} name="input" rows={3} defaultValue={input} className={inputClass} /></Field>
      <Field label="Expected behaviour" htmlFor={`ex-${draftId}`}><textarea id={`ex-${draftId}`} name="expected" rows={2} defaultValue={expected} className={inputClass} /></Field>
      <Field label="Assertions" htmlFor={`as-${draftId}`} hint="One claim per line, each checkable from the reply or its tool activity.">
        <textarea id={`as-${draftId}`} name="assertions" rows={3} defaultValue={assertions.join("\n")} className={inputClass} />
      </Field>
      <Field label="Severity" htmlFor={`sv-${draftId}`}>
        <select id={`sv-${draftId}`} name="severity" defaultValue={severity} className={inputClass}>
          {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Save as a new draft</SubmitButton>
        <Message state={state} />
      </div>
    </form>
  );
}

export function AnswerForm({ buildId, obligationId, suggestions }: {
  buildId: string; obligationId: string; suggestions: Array<{ answer: string; citation: string }>;
}) {
  const [state, submit] = useActionState<FormState, FormData>(answerAction, {});
  const keepValues = useKeepValuesOnError(state);
  const [answer, setAnswer] = useState("");
  return (
    <form onSubmitCapture={keepValues} action={submit} className="grid gap-2">
      <input type="hidden" name="buildId" value={buildId} />
      <input type="hidden" name="obligationId" value={obligationId} />
      {suggestions.length > 0 && (
        <ul className="grid gap-2">
          {suggestions.map((s, i) => (
            <li key={i} className="rounded-control border border-line bg-ground px-3 py-2 text-sm">
              <p className="text-ink">{s.answer}</p>
              <p className="mt-1 text-xs text-ink-soft">Cited: “{s.citation}”</p>
              <button type="button" onClick={() => setAnswer(s.answer)} className="mt-1 text-xs font-medium text-ink underline underline-offset-2">Use this answer</button>
            </li>
          ))}
        </ul>
      )}
      <label className="sr-only" htmlFor={`answer-${obligationId}`}>Your answer</label>
      <textarea id={`answer-${obligationId}`} name="answer" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer — it is yours, not a model's" className={inputClass} />
      <label className="sr-only" htmlFor={`na-${obligationId}`}>Why it does not apply</label>
      <input id={`na-${obligationId}`} name="reason" maxLength={1000} placeholder="Or: why it does not apply to you" className={inputClass} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" name="decision" value="answer" pendingLabel="Saving…">Answer</SubmitButton>
        <SubmitButton size="sm" variant="secondary" name="decision" value="not_applicable" pendingLabel="Saving…">Not applicable</SubmitButton>
      </div>
      <Message state={state} />
    </form>
  );
}

export function BulkApproveForm({ buildId, candidates }: { buildId: string; candidates: Array<{ id: string; label: string }> }) {
  const [state, submit] = useActionState<FormState, FormData>(bulkApproveAction, {});
  return (
    <form action={submit} className="grid gap-3">
      <input type="hidden" name="buildId" value={buildId} />
      <fieldset>
        <legend className="text-sm text-ink-soft">Low- and medium-severity drafts with no question, conflict or flag. Untick any you want to read first.</legend>
        <ul className="mt-2 grid gap-1">
          {candidates.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" name="draftId" value={c.id} defaultChecked className="mt-1" />
                <span>{c.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div>
        <SubmitButton size="sm" pendingLabel="Approving…">Approve the ticked ones</SubmitButton>
        <Message state={state} />
      </div>
    </form>
  );
}

export function AttachProductionForm({ buildId, waiting }: { buildId: string; waiting: number }) {
  const [state, submit] = useActionState<FormState, FormData>(attachProductionAction, {});
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="buildId" value={buildId} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Adding…">Add {waiting} production-failure draft{waiting === 1 ? "" : "s"}</SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function ScanForm({ buildId, agents, defaultAgent, scenarios }: { buildId: string; agents: Array<{ id: string; name: string }>; defaultAgent: string | null; scenarios: number }) {
  const [state, submit] = useActionState<FormState, FormData>(scanAction, {});
  if (!agents.length) return null;
  return (
    <form action={submit} className="grid gap-2">
      <input type="hidden" name="buildId" value={buildId} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Scan against" htmlFor="scan-agent">
          <select id="scan-agent" name="agentId" className={inputClass} defaultValue={defaultAgent ?? agents[0].id}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <SubmitButton variant="secondary" pendingLabel="Starting…">Run an exploratory scan ({scenarios})</SubmitButton>
      </div>
      <p className="text-xs text-ink-soft">Exploratory scan — not a conformity report. It runs the drafts as they are, uses one run, and never seals a report.</p>
      <Message state={state} />
    </form>
  );
}

export function PublishForm({ buildId, name, scope, gaps, acknowledgement }: {
  buildId: string; name: string; scope: string; gaps: { openQuestions: number; undecided: number }; acknowledgement: string;
}) {
  const [state, submit] = useActionState<FormState, FormData>(publishAction, {});
  const keepValues = useKeepValuesOnError(state);
  const hasGaps = gaps.openQuestions + gaps.undecided > 0;
  return (
    <form onSubmitCapture={keepValues} action={submit} className="grid gap-4">
      <input type="hidden" name="buildId" value={buildId} />
      <Field label="Suite name" htmlFor="pub-name"><input id="pub-name" name="name" required maxLength={120} defaultValue={name} className={inputClass} /></Field>
      <Field label="Scope" htmlFor="pub-scope" hint="Which agent and channel, what it is for, what it leaves out. Stored with the suite.">
        <textarea id="pub-scope" name="scope" rows={3} required maxLength={2000} defaultValue={scope} className={inputClass} />
      </Field>
      {hasGaps && (
        <Field label="Publish without what is still open" htmlFor="pub-gaps" hint={`${gaps.openQuestions} open question(s) and ${gaps.undecided} undecided draft(s) will not be in the suite. Say why; your name and reason are stored with it.`}>
          <textarea id="pub-gaps" name="gapsReason" rows={2} maxLength={1000} className={inputClass} />
        </Field>
      )}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="acknowledged" required className="mt-1" />
        <span>{acknowledgement}</span>
      </label>
      <div>
        <SubmitButton pendingLabel="Publishing…">Approve and publish</SubmitButton>
        <Message state={state} />
      </div>
    </form>
  );
}

export function AbandonForm({ buildId }: { buildId: string }) {
  const [state, submit] = useActionState<FormState, FormData>(abandonAction, {});
  return (
    <form action={submit}>
      <input type="hidden" name="buildId" value={buildId} />
      <SubmitButton size="sm" variant="danger" pendingLabel="Abandoning…">Abandon this build</SubmitButton>
      <Message state={state} />
    </form>
  );
}
