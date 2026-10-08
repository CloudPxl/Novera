import { FIXTURE_ENVIRONMENT } from "@/lib/agents/environment.ts";

/**
 * Said on the operator's own pages, not only on the sealed report: a run against Novera's
 * scripted fixture is test data, and nothing on screen may let it pass for a real agent
 * (audit, 2026-10-08 — the run and agent pages never said so).
 */
export function FixtureNote({ className = "" }: { className?: string }) {
  return (
    <div role="note" className={`rounded-panel border border-warning-border bg-warning-surface px-4 py-3 text-warning-text ${className}`}>
      <p className="font-semibold">Test data</p>
      <p className="mt-1 text-sm">{FIXTURE_ENVIRONMENT}. Its verdicts say nothing about a customer&rsquo;s agent.</p>
    </div>
  );
}
