"use client";

import { useRouter } from "next/navigation";

/**
 * Choosing which run to compare against.
 *
 * The options are built on the server and are only ever completed runs of the same suite
 * key against the same agent — at this version or another, since a scenario is compared
 * only with an identical definition of itself. A comparison across suites would list
 * scenarios as fixed or broken when they were never the same scenarios.
 *
 * The choice is an address (`?tab=comparison&compare=<run>`), so the comparison a person
 * is looking at can be linked to. It is a GET form: with JavaScript the change navigates at
 * once, without it the button submits the same address.
 */
export function BaselinePicker({
  runId,
  current,
  options,
  placeholder = false,
}: {
  runId: string;
  current: string | null;
  options: Array<{ id: string; label: string }>;
  /** True when no baseline is chosen yet, so the select does not imply one is. */
  placeholder?: boolean;
}) {
  const router = useRouter();

  return (
    <form method="get" action={`/runs/${runId}`} className="flex items-center gap-2">
      <input type="hidden" name="tab" value="comparison" />
      <label htmlFor="baseline" className="type-pill text-ink-faint">Against</label>
      <select
        id="baseline"
        name="compare"
        defaultValue={current ?? ""}
        onChange={(e) => {
          if (e.target.value) router.push(`/runs/${runId}?tab=comparison&compare=${e.target.value}`);
        }}
        className="rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
      >
        {placeholder && <option value="">Choose a run…</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm font-medium text-ink">Compare</button>
      </noscript>
    </form>
  );
}
