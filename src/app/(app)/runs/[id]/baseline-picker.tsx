"use client";

import { useRouter } from "next/navigation";

/**
 * Choosing which run to compare against.
 *
 * The options are built on the server and are only ever runs of the same suite
 * against the same agent — a comparison across suites would list scenarios as fixed
 * or broken when they were never the same scenarios. The choice is a URL parameter
 * rather than local state so the comparison a person is looking at can be linked to.
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
    <div className="flex items-center gap-2">
      <label htmlFor="baseline" className="type-pill text-ink-faint">Against</label>
      <select
        id="baseline"
        defaultValue={current ?? ""}
        onChange={(e) => {
          if (e.target.value) router.push(`/runs/${runId}?compare=${e.target.value}`);
        }}
        className="rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
      >
        {placeholder && <option value="">Choose a run…</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
