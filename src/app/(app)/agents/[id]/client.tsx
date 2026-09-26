"use client";

import { useActionState, useState } from "react";
import {
  savePolicyVersion,
  reprobeAgent,
  saveVerificationEndpoint,
  applyResponsePath,
  type FormState,
} from "@/lib/workflow/actions.ts";
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
  // The first version starts empty. It used to start filled with the example below as
  // real text, so "Save version 1" pressed without reading saved someone else's rules
  // as this agent's policy — and every verdict is judged against that text. The example
  // is a placeholder, and becomes text only when asked for.
  const [body, setBody] = useState(latest?.body ?? "");
  const changed = body.trim() !== (latest?.body ?? "").trim() && body.trim() !== "";
  const isExample = body.trim() === STARTER.trim();

  return (
    <form action={submit} className="mt-4">
      <input type="hidden" name="agentId" value={agentId} />
      {/* The label is visually redundant beside the section heading and not remotely
          redundant to a screen reader, which otherwise announces "edit text, blank"
          for the box a whole policy goes in. */}
      <label htmlFor="policy-body" className="sr-only">
        Policy text
      </label>
      <textarea
        id="policy-body"
        name="body"
        rows={9}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={latest ? undefined : `For example:\n\n${STARTER}`}
        aria-describedby="policy-body-hint"
        className={`${inputClass} leading-relaxed`}
      />
      <p id="policy-body-hint" className="sr-only">
        Saving creates a new immutable version. Existing versions are never edited.
      </p>

      {!latest && body.trim() === "" && (
        <button
          type="button"
          onClick={() => setBody(STARTER)}
          className="mt-2 text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
        >
          Start from the example, then edit it
        </button>
      )}
      {isExample && (
        <p className="mt-2 text-xs text-warning-text">
          This is the example, word for word. Edit it to match the rules your agent is actually held to —
          every verdict is judged against this text.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Saving…" disabled={!changed}>
          {latest ? `Save as version ${latest.version + 1}` : "Save version 1"}
        </SubmitButton>
        {!changed && latest && (
          <span className="text-xs text-ink-faint">
            Unchanged from version {latest.version}. Edit the text to create a new version.
          </span>
        )}
        {state.notice && <span className="text-xs font-medium text-pass-text">{state.notice}</span>}
        {state.error && <span className="text-xs font-medium text-fail-text">{state.error}</span>}
      </div>

      {history.length > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
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
      {state.notice && <span className="text-xs font-medium text-pass-text">{state.notice}</span>}
      {state.error && <span className="text-xs font-medium text-fail-text">{state.error}</span>}
      <SubmitButton variant="secondary" size="sm" pendingLabel="Testing…">
        Test connection
      </SubmitButton>
    </form>
  );
}

/**
 * Where to read the customer's own system, so a claimed action can be checked
 * against it.
 *
 * Deliberately blunt about what it buys and what it costs. Without one, a scenario
 * that expects a change of state reports as unverified — which is honest, and is the
 * default. With one, the same scenario can be confirmed, or contradicted.
 */
export function VerificationEndpoint({
  agentId,
  current,
}: {
  agentId: string;
  current: { url?: string; authHeaderName?: string } | null;
}) {
  const [state, submit] = useActionState<FormState, FormData>(saveVerificationEndpoint, {});

  return (
    <form action={submit} className="mt-4">
      <input type="hidden" name="agentId" value={agentId} />

      <p className="text-sm leading-relaxed text-ink-soft">
        A read-only endpoint in your own system — an order lookup, an invoice status.
        When a scenario expects the agent to <em>do</em> something, Novera reads this
        afterwards to find out whether it actually happened. It is fetched with GET and
        nothing else, so it can never change anything.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-faint">
        Without one, those scenarios are reported as <strong>unable to verify</strong>{" "}
        rather than passed. That is the honest answer, and it is what every report says
        today.
      </p>

      <label className="mt-4 block type-h3 text-ink" htmlFor="verification-url">
        Endpoint
      </label>
      <input
        id="verification-url"
        name="url"
        type="url"
        defaultValue={current?.url ?? ""}
        placeholder="https://api.yourshop.example/status/"
        className={`${inputClass} mt-1.5`}
      />
      <p className="mt-1 text-xs text-ink-faint">
        Leave it empty to remove it. A scenario can only read paths underneath this one.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block type-h3 text-ink" htmlFor="verification-header">
            Auth header <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input
            id="verification-header"
            name="authHeaderName"
            defaultValue={current?.authHeaderName ?? ""}
            placeholder="x-api-key"
            className={`${inputClass} mt-1.5`}
          />
        </div>
        <div>
          <label className="block type-h3 text-ink" htmlFor="verification-credential">
            Credential <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input
            id="verification-credential"
            name="credential"
            type="password"
            autoComplete="off"
            placeholder={current?.authHeaderName ? "Stored — paste again to replace" : ""}
            className={`${inputClass} mt-1.5`}
          />
          <p className="mt-1 text-xs text-ink-faint">
            Encrypted at rest, never shown again, and never written into a report.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton>Check and save</SubmitButton>
        <span className="text-xs text-ink-faint">
          The endpoint is called once before anything is saved. If it does not answer,
          nothing is stored.
        </span>
      </div>

      {state.error && <p className="mt-3 text-sm text-fail-text">{state.error}</p>}
      {state.notice && <p className="mt-3 text-sm text-pass-text">{state.notice}</p>}
    </form>
  );
}

/**
 * Where the reply actually is.
 *
 * Shown against the probe that found it. The operator does not have to understand dot
 * paths, retype anything, or go back to a form: they see the text that came back, next
 * to the path it came back at, and press the one that is theirs.
 *
 * The current path is marked rather than hidden. "This is what you are reading now" is
 * the piece of information that makes the rest of the list make sense.
 */
export function ResponsePathPicker({
  agentId,
  current,
  currentTools,
  shape,
}: {
  agentId: string;
  current: string;
  currentTools: string | null;
  shape: {
    paths: Array<{ path: string; preview: string; length: number }>;
    replyPaths: string[];
    toolPaths: string[];
  };
}) {
  const [state, submit] = useActionState<FormState, FormData>(applyResponsePath, {});

  const ranked = [
    ...shape.replyPaths,
    ...shape.paths.map((p) => p.path).filter((p) => !shape.replyPaths.includes(p)),
  ].slice(0, 6);

  if (ranked.length === 0 && shape.toolPaths.length === 0) return null;

  const preview = (path: string) => shape.paths.find((p) => p.path === path);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="type-h3">What came back, and where</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        Read from the probe above. Pick the field that holds your agent&rsquo;s reply and
        Novera will re-probe to prove it.
      </p>

      <ul className="mt-3 space-y-1.5">
        {ranked.map((path) => {
          const p = preview(path);
          const isCurrent = path === current;
          return (
            <li key={path}>
              <form action={submit} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="agentId" value={agentId} />
                <input type="hidden" name="field" value="reply" />
                <input type="hidden" name="path" value={path} />
                <code className="type-mono rounded bg-sunken px-1.5 py-0.5 text-ink">{path}</code>
                {isCurrent ? (
                  <span className="text-xs font-medium text-pass-text">reading this now</span>
                ) : (
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Checking…">
                    Use this
                  </SubmitButton>
                )}
                {p && (
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-soft" title={p.preview}>
                    {p.preview}
                    {p.length > p.preview.length && (
                      <span className="text-ink-faint"> ({p.length} characters)</span>
                    )}
                  </span>
                )}
              </form>
            </li>
          );
        })}
      </ul>

      {shape.toolPaths.length > 0 && (
        <>
          <h3 className="mt-5 type-h3">Recorded tool activity</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            Without this, a scenario expecting the agent to <em>do</em> something can
            only be judged on what it said.
          </p>
          <ul className="mt-2 space-y-1.5">
            {shape.toolPaths.map((path) => (
              <li key={path}>
                <form action={submit} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="agentId" value={agentId} />
                  <input type="hidden" name="field" value="tools" />
                  <input type="hidden" name="path" value={path} />
                  <code className="type-mono rounded bg-sunken px-1.5 py-0.5 text-ink">{path}</code>
                  {path === currentTools ? (
                    <span className="text-xs font-medium text-pass-text">reading this now</span>
                  ) : (
                    <SubmitButton size="sm" variant="secondary" pendingLabel="Checking…">
                      Use this
                    </SubmitButton>
                  )}
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      {state.error && <p className="mt-3 text-sm text-fail-text">{state.error}</p>}
      {state.notice && <p className="mt-3 text-sm text-pass-text">{state.notice}</p>}
    </div>
  );
}
