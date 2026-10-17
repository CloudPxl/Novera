"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";
import { acceptContractTerms, type AcceptanceFormState } from "@/lib/legal/actions.ts";

export interface ClauseLine {
  section: string;
  heading: string;
  covers: string;
  anchor: string;
}

/**
 * The business details and acceptance before a paid plan (legal build brief §2–3). Four
 * declarations, each its own checkbox, none pre-ticked: the documents; the clauses Romanian law
 * requires to be accepted expressly and separately (Civil Code art. 1203), each named with its
 * section; acquisition exclusively for business purposes; and authority to bind the organisation
 * (separate since 2026-10-16, as the founder's memo asks). The server checks all
 * of it again and records exactly which versions were on this page (`set`).
 */
export function TermsAcceptanceForm({ set, clauses, documents, draft }: {
  set: string;
  clauses: ClauseLine[];
  documents: Array<{ slug: string; title: string; version: string }>;
  draft: boolean;
}) {
  const [state, submit] = useActionState<AcceptanceFormState, FormData>(acceptContractTerms, {});
  const keep = useKeepValuesOnError(state);
  const invalid = (field: string) => (state.field === field ? { "aria-invalid": true as const, "aria-describedby": "terms-error" } : {});
  const doc = (slug: string) => documents.find((d) => d.slug === slug);
  const link = (slug: string, anchor?: string) => {
    const d = doc(slug);
    return d ? (
      <Link href={`/legal/${slug}${anchor ? `#${anchor}` : ""}`} target="_blank" className="font-medium text-ink underline underline-offset-2">
        {d.title}
      </Link>
    ) : null;
  };

  return (
    <form action={submit} onSubmit={keep} className="space-y-5">
      <input type="hidden" name="set" value={set} />
      {draft && (
        <p className="rounded-control border border-warning-border bg-warning-surface px-3 py-2 text-xs leading-relaxed text-warning-text">
          Draft texts, awaiting counsel review. Accepting them here is for the Stripe sandbox only; live billing asks again once the final versions are approved.
        </p>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">The organisation</legend>
        <label className="block text-sm sm:col-span-2">
          <span className="text-ink-soft">Registered legal name</span>
          <input name="legalName" required maxLength={200} autoComplete="organization" className={`${inputClass} mt-1`} {...invalid("legalName")} />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-ink-soft">Registered address</span>
          <textarea name="registeredAddress" required maxLength={500} rows={2} autoComplete="street-address" className={`${inputClass} mt-1`} {...invalid("registeredAddress")} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Country of establishment (two-letter code, for example RO)</span>
          <input name="country" required minLength={2} maxLength={2} autoComplete="country" className={`${inputClass} mt-1 uppercase`} {...invalid("country")} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">VAT number, if any</span>
          <input name="vatId" maxLength={20} className={`${inputClass} mt-1 uppercase`} aria-describedby="vat-hint" {...invalid("vatId")} />
          <span id="vat-hint" className="mt-1 block text-xs text-ink-faint">Recorded as you give it. Novera does not validate VAT numbers yet.</span>
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">You</legend>
        <label className="block text-sm">
          <span className="text-ink-soft">Full name</span>
          <input name="signerName" required maxLength={120} autoComplete="name" className={`${inputClass} mt-1`} {...invalid("signerName")} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">Role in the organisation</span>
          <input name="signerTitle" required maxLength={120} autoComplete="organization-title" className={`${inputClass} mt-1`} {...invalid("signerTitle")} />
        </label>
      </fieldset>

      <fieldset className="space-y-3 text-sm leading-relaxed">
        <legend className="mb-1 text-sm font-medium">Acceptance</legend>
        <label className="flex gap-3">
          <input type="checkbox" name="accept_terms" required className="mt-1 size-4 shrink-0" {...invalid("accept_terms")} />
          <span>
            I confirm that I have read and accept the {link("terms")}, {link("privacy")}, {link("dpa")}, {link("acceptable-use")},{" "}
            {link("refunds")} and {link("ai-testing-scope")}.
          </span>
        </label>
        <label className="flex gap-3">
          <input type="checkbox" name="accept_unusual" required className="mt-1 size-4 shrink-0" {...invalid("accept_unusual")} />
          <span>
            I expressly and separately accept these clauses of the Terms of Service:
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-ink-soft">
              {clauses.map((c) => (
                <li key={c.section}>
                  <Link href={`/legal/terms#${c.anchor}`} target="_blank" className="text-ink underline underline-offset-2">Section {c.section}</Link>: {c.covers}
                </li>
              ))}
            </ul>
          </span>
        </label>
        <label className="flex gap-3">
          <input type="checkbox" name="accept_business" required className="mt-1 size-4 shrink-0" {...invalid("accept_business")} />
          <span>
            I confirm that the organisation acquires Novera exclusively for its trade, business, craft or profession, and not as a consumer.
          </span>
        </label>
        <label className="flex gap-3">
          <input type="checkbox" name="accept_authority" required className="mt-1 size-4 shrink-0" {...invalid("accept_authority")} />
          <span>I confirm that I have authority to bind the organisation to these terms.</span>
        </label>
      </fieldset>

      {state.error && <p id="terms-error" role="alert" className="text-sm text-fail-text">{state.error}</p>}
      {state.notice && <p role="status" className="text-sm text-ink-soft">{state.notice}</p>}
      <SubmitButton size="sm" pendingLabel="Recording…">Record and accept</SubmitButton>
    </form>
  );
}
