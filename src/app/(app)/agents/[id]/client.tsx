"use client";

import { useActionState, useState } from "react";
import {
  savePolicyVersion,
  reprobeAgent,
  saveVerificationEndpoint,
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
