import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { obligationLabel } from "@/lib/report/payload.ts";
import { TryScenarioAlone } from "@/components/ui/try-scenario-alone.tsx";
import { Button } from "@/components/ui/button.tsx";
import { SEVERITIES } from "@/lib/suites/validate.ts";
import { TIER_DESCRIPTIONS, TIER_LABELS, TIERS } from "@/lib/suites/tiers.ts";
import {
  matchesFilter, TIER_BUCKETS, type CatalogFilter, type CatalogSuite, type CatalogVersion, type TierBucket,
} from "@/lib/suites/catalog.ts";

/**
 * The suite catalog (Investigate level): every built-in suite version as stored, newest first
 * within each suite. Every figure is computed from the rows — scenario counts, tiers, severities,
 * what changed from the version before — and the digest is the one a new run's manifest records.
 * Filters are links, so they work without JavaScript and can be bookmarked.
 */

/**
 * Trying one scenario alone from the catalog: the agent is chosen once (`?agent=`), then a
 * scenario's "Try alone" link opens the check beside it (`?try=<suite id>:<scenario id>`). Links,
 * so nothing waits for JavaScript and only the opened scenario renders a form.
 */
export interface CatalogTrial {
  agents: Array<{ id: string; name: string; isProduction: boolean }>;
  agentId: string | null;
  tryKey: string | null;
}

const BUCKET_LABEL: Record<TierBucket, string> = { ...TIER_LABELS, unclassified: "Not classified" };
const SHORT = 12;

function href(filter: CatalogFilter): string {
  const q = new URLSearchParams({ tab: "catalog" });
  if (filter.tier) q.set("tier", filter.tier);
  if (filter.severity) q.set("severity", filter.severity);
  return `/scenarios?${q.toString()}#catalog`;
}

function Pill({ to, current, children }: { to: string; current: boolean; children: ReactNode }) {
  return (
    <li>
      <Link href={to} scroll={false} aria-current={current ? "true" : undefined}
        className={`novera-press inline-block rounded-full border px-3 py-1 text-xs font-medium ${current ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface text-ink-soft hover:text-ink"}`}>
        {children}
      </Link>
    </li>
  );
}

function Filters({ filter }: { filter: CatalogFilter }) {
  return (
    <nav aria-label="Filter scenarios" className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-8">
      <div className="flex flex-wrap items-center gap-2">
        <span id="catalog-tier-label" className="text-xs font-medium text-ink-faint">Tier</span>
        <ul aria-labelledby="catalog-tier-label" className="flex flex-wrap gap-1.5">
          <Pill to={href({ ...filter, tier: null })} current={!filter.tier}>All</Pill>
          {TIER_BUCKETS.map((b) => <Pill key={b} to={href({ ...filter, tier: b })} current={filter.tier === b}>{BUCKET_LABEL[b]}</Pill>)}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span id="catalog-severity-label" className="text-xs font-medium text-ink-faint">Severity</span>
        <ul aria-labelledby="catalog-severity-label" className="flex flex-wrap gap-1.5">
          <Pill to={href({ ...filter, severity: null })} current={!filter.severity}>All</Pill>
          {SEVERITIES.map((s) => <Pill key={s} to={href({ ...filter, severity: s })} current={filter.severity === s}>{s}</Pill>)}
        </ul>
      </div>
    </nav>
  );
}

function Ids({ ids }: { ids: string[] }) {
  return <span className="type-mono text-xs text-ink-soft [overflow-wrap:anywhere]">{ids.join(", ")}</span>;
}

function tryHref(filter: CatalogFilter, agentId: string, key: string | null): string {
  const q = new URLSearchParams({ tab: "catalog", agent: agentId });
  if (filter.tier) q.set("tier", filter.tier);
  if (filter.severity) q.set("severity", filter.severity);
  if (key) q.set("try", key);
  return `/scenarios?${q.toString()}${key ? `#try-${key.split(":")[1]}` : ""}`;
}

function AgentPicker({ trial, filter }: { trial: CatalogTrial; filter: CatalogFilter }) {
  return (
    <form method="get" action="/scenarios" className="mt-4 flex flex-wrap items-end gap-2 text-sm">
      <input type="hidden" name="tab" value="catalog" />
      {filter.tier && <input type="hidden" name="tier" value={filter.tier} />}
      {filter.severity && <input type="hidden" name="severity" value={filter.severity} />}
      <label className="grid gap-1">
        <span className="font-medium">Try a scenario alone against</span>
        <select name="agent" defaultValue={trial.agentId ?? ""} className="rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink">
          <option value="" disabled>Choose an agent</option>
          {trial.agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isProduction ? " (production)" : ""}</option>)}
        </select>
      </label>
      <Button type="submit" variant="secondary" size="sm">Choose</Button>
      <p className="w-full text-xs text-ink-faint">
        Sends one scenario and grades it as a run would. It is not a sealed run: no score, report or run allowance changes.
      </p>
    </form>
  );
}

function Version({ v, newest, filter, trial }: { v: CatalogVersion; newest: boolean; filter: CatalogFilter; trial?: CatalogTrial }) {
  const headingId = `suite-${v.id}`;
  const shown = v.scenarios.filter((s) => matchesFilter(s, filter));
  const filtered = Boolean(filter.tier || filter.severity);
  const log = v.changes?.log;
  return (
    <article aria-labelledby={headingId} className="overflow-hidden rounded-shell border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4">
        <h4 id={headingId} className="text-base font-semibold">
          {v.key} v{v.version}
          <span className="font-normal text-ink-soft"> · {v.scenarios.length} scenarios</span>
        </h4>
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          {newest && <Badge tone="neutral">Newest</Badge>}
          {v.changes && <span>Supersedes v{v.changes.from}</span>}
          {v.supersededBy !== null && <span>Superseded by v{v.supersededBy}</span>}
        </p>
      </header>

      <dl className="grid gap-x-8 gap-y-4 px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-ink-faint">By tier</dt>
          <dd className="mt-1">
            <ul className="max-w-56 space-y-0.5">
              {TIER_BUCKETS.filter((b) => b !== "unclassified" || v.byTier.unclassified > 0).map((b) => (
                <li key={b} className="flex justify-between gap-4"><span>{BUCKET_LABEL[b]}</span><span className="tnum">{v.byTier[b]}</span></li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-ink-faint">By severity</dt>
          <dd className="mt-1">
            <ul className="max-w-56 space-y-0.5">
              {SEVERITIES.map((s) => (
                <li key={s} className="flex justify-between gap-4"><span>{s}</span><span className="tnum">{v.bySeverity[s]}</span></li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <dt className="text-xs font-medium text-ink-faint">{v.changes ? `Changes from v${v.changes.from}` : "Changes"}</dt>
          <dd className="mt-1">
            {!log ? <p className="text-ink-soft">The first version of this suite.</p> : (
              <ul className="space-y-1">
                <li>{log.added.length ? <>{log.added.length} added: <Ids ids={log.added} /></> : "None added"}</li>
                <li>{log.retired.length ? <>{log.retired.length} retired: <Ids ids={log.retired} /></> : "None retired"}</li>
                <li>{log.redefined.length ? <>{log.redefined.length} redefined: <Ids ids={log.redefined} /></> : "None redefined"}</li>
                <li className="text-ink-soft">{log.unchanged.length} unchanged</li>
              </ul>
            )}
          </dd>
        </div>
      </dl>

      <details className="group border-t border-line">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-5 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
          <span className="font-medium">Suite digest</span>
          <span className="type-mono text-xs text-ink-soft">{v.digest.slice(0, SHORT)}…</span>
          <span className="text-xs text-ink-faint group-open:hidden">show in full</span>
        </summary>
        <div className="px-5 pb-3">
          <p className="type-mono break-all text-xs text-ink-soft">{v.digest}</p>
          <p className="mt-1 text-xs text-ink-faint">SHA-256 over this version&apos;s key, version, name and scenarios, in canonical form.</p>
        </div>
      </details>

      <details open={newest} className="group border-t border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>Scenarios{filtered ? ` · ${shown.length} of ${v.scenarios.length} match` : ""}</span>
          <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
        </summary>
        {shown.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-ink-soft">No scenario in this version matches the filter.</p>
        ) : (
          <ul aria-label={`Scenarios in ${v.key} v${v.version}`} className="divide-y divide-line border-t border-line">
            {shown.map((s) => (
              <li key={s.id} className="grid gap-x-3 gap-y-1 px-5 py-2.5 text-sm sm:grid-cols-[4rem_minmax(0,1fr)_6rem_minmax(0,14rem)] sm:items-center">
                <span className="type-mono text-xs text-ink-faint">{s.id}</span>
                <span className="min-w-0">{obligationLabel(s.obligation)}<span className="text-ink-faint"> · {s.category.replace(/_/g, " ")}</span></span>
                <span><Badge tone={(SEVERITIES as readonly string[]).includes(s.severity) ? (s.severity as "critical") : "neutral"}>{s.severity}</Badge></span>
                <span className="text-xs">
                  {trial?.agentId && (
                    <Link href={tryHref(filter, trial.agentId, `${v.id}:${s.id}`)} className="mr-2 font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">
                      Try alone<span className="sr-only"> {s.id}</span>
                    </Link>
                  )}
                  {s.tier ? (
                    <>
                      <span className="font-medium">{TIER_LABELS[s.tier]}</span>
                      {s.tierFrom !== v.version && <span className="text-ink-faint"> · as classified in v{s.tierFrom}</span>}
                    </>
                  ) : <span className="text-ink-faint">Not classified</span>}
                </span>
                {trial?.agentId && trial.tryKey === `${v.id}:${s.id}` && (
                  <div id={`try-${s.id}`} className="scroll-mt-20 sm:col-span-4">
                    <TryScenarioAlone target={{ agentId: trial.agentId, suiteId: v.id, scenarioId: s.id }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-5 py-2.5 text-sm">
          <Link href={`/scenarios?suite=${v.id}`} className="font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">
            Each scenario in full, with its results here →
          </Link>
        </p>
      </details>
    </article>
  );
}

export function Catalog({ suites, filter, trial }: { suites: CatalogSuite[]; filter: CatalogFilter; trial?: CatalogTrial }) {
  return (
    <section id="catalog" aria-labelledby="catalog-heading" className="mt-6 scroll-mt-20">
      <h2 id="catalog-heading" className="type-h2">Suite catalog</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-soft">
        Every built-in suite version, newest first, computed from the stored rows. A version never changes once
        published. Its digest is recorded in the manifest of each run started from it, so the run&apos;s report
        commits to exactly these scenarios.
      </p>

      <dl className="mt-4 grid max-w-4xl gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t}>
            <dt className="font-medium">{TIER_LABELS[t]}</dt>
            <dd className="text-xs text-ink-soft">{TIER_DESCRIPTIONS[t]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 max-w-3xl text-xs text-ink-faint">
        Tiers are Novera&apos;s triage classification, kept beside each suite rather than in it: a tier can be
        corrected without a new suite version, it is not part of any report, and it is not a legal conclusion.
        An older version shows a scenario&apos;s tier only where its definition is identical to a classified one.
      </p>

      <Filters filter={filter} />
      {trial && trial.agents.length > 0 && <AgentPicker trial={trial} filter={filter} />}

      {suites.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No built-in suite is loaded">The built-in suites are added to the database when Novera is deployed.</EmptyState>
        </div>
      ) : suites.map((s) => (
        <section key={s.key} aria-labelledby={`catalog-${s.key}`} className="mt-8">
          <h3 id={`catalog-${s.key}`} className="text-lg font-semibold tracking-tight">
            {s.name} <span className="type-mono text-sm font-normal text-ink-faint">{s.key}</span>
          </h3>
          <p className="text-xs text-ink-soft">{s.versions.length} {s.versions.length === 1 ? "version" : "versions"}</p>
          <div className="mt-3 space-y-4">
            {s.versions.map((v, i) => <Version key={v.id} v={v} newest={i === 0} filter={filter} trial={trial} />)}
          </div>
        </section>
      ))}
    </section>
  );
}
