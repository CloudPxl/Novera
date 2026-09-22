"use client";

import { useActionState, useState } from "react";
import { importSuite, type FormState } from "@/lib/workflow/actions.ts";
import { Menu } from "@/components/ui/menu.tsx";
import { SubmitButton } from "@/components/ui/button.tsx";
import { inputClass } from "@/components/ui/primitives.tsx";

/**
 * Bringing a workspace's own scenarios in.
 *
 * A JSON suite names itself. A CSV does not, so the key, name and version are asked
 * for — and they are asked for as three separate things because `key` and `version`
 * together are what a report cites. Getting them from a filename would make a
 * client-facing citation depend on what someone called a download.
 */
export function ImportSuite() {
  const [state, submit] = useActionState<FormState, FormData>(importSuite, {});
  const [isCsv, setIsCsv] = useState(false);

  return (
    <Menu
      label="Import"
      triggerClassName="border border-line-strong px-2.5 py-2 text-ink-soft hover:bg-sunken"
      panelClassName="w-80 p-3"
    >
      <form action={submit} className="space-y-3">
        <div>
          <label htmlFor="suite-file" className="type-pill text-ink-faint">Suite file</label>
          <input
            id="suite-file"
            name="file"
            type="file"
            accept=".json,.csv,application/json,text/csv"
            required
            onChange={(e) => setIsCsv(Boolean(e.target.files?.[0]?.name.toLowerCase().endsWith(".csv")))}
            className="mt-1 block w-full text-sm text-ink-soft file:mr-3 file:rounded-control file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label htmlFor="suite-key" className="type-pill text-ink-faint">Key {isCsv && "(required)"}</label>
            <input id="suite-key" name="key" placeholder="acme-support" className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label htmlFor="suite-name" className="type-pill text-ink-faint">Name {isCsv && "(required)"}</label>
            <input id="suite-name" name="name" placeholder="Acme support" className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label htmlFor="suite-version" className="type-pill text-ink-faint">Version {isCsv && "(required)"}</label>
            <input id="suite-version" name="version" type="number" min={1} placeholder="1" className={`${inputClass} mt-1`} />
          </div>
        </div>

        <p className="rounded-control bg-sunken px-2.5 py-2 text-xs leading-relaxed text-ink-soft">
          {isCsv
            ? "Columns: id, category, obligation, severity, input, expected_behavior, assertions, forbidden. Separate several assertions in one cell with a pipe (|)."
            : "A JSON suite supplies its own key, name and version; the fields above override them. A version is never overwritten — import a change as a new version."}
        </p>

        <SubmitButton size="sm" pendingLabel="Checking every scenario…" className="w-full">
          Import suite
        </SubmitButton>

        {state.notice && <p className="text-xs font-medium text-pass-text">{state.notice}</p>}
        {state.error && (
          <p role="alert" className="text-xs leading-relaxed font-medium text-fail-text">{state.error}</p>
        )}
      </form>
    </Menu>
  );
}
