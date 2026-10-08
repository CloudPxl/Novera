import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The page's layout vocabulary (2026-10-02 information-architecture refactor).
 *
 * Every page answers "what is this for?" in its header within two seconds: an eyebrow for
 * where you are, a title for what it is, one sentence at most, one primary action. Below it,
 * sections with a title and an optional "View all" — never a wall of cards. Three levels:
 *
 *   Decide      — page header, health line, three metrics, at most five attention items
 *   Investigate — lists, filters, comparisons (Review, a run's cases)
 *   Prove       — a case's evidence chain, technical detail behind an explicit disclosure
 *
 * Level-3 material does not appear on Level-1 pages.
 */

export function PageHeader({ eyebrow, title, description, action, status, back }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** One primary action. A second, if any, is quieter and lives in the page. */
  action?: ReactNode;
  /** A compact status beside the title — the page's state in a few words. */
  status?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="pb-6 pt-8">
      {back && (
        <Link href={back.href} className="text-sm text-ink-faint underline-offset-2 hover:text-ink hover:underline">← {back.label}</Link>
      )}
      <div className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-4 ${back ? "mt-3" : ""}`}>
        <div className="min-w-0 max-w-3xl">
          {eyebrow && <p className="type-eyebrow text-ink-faint">{eyebrow}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="type-h1 [overflow-wrap:anywhere]">{title}</h1>
            {status}
          </div>
          {description && <p className="mt-1.5 type-body text-ink-soft">{description}</p>}
        </div>
        {/* max-w-full: an action wider than a phone (the agent page's run form, 448 px) pushed every
            such page 74 px past a 390 px screen, measured on production 2026-10-08. */}
        {action && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}

/** A titled group. Generous space above; the title and its one link on one line. */
export function Section({ title, id, action, children, className = "" }: {
  title: ReactNode;
  id?: string;
  /** Usually a ViewAll. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`mt-10 scroll-mt-20 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="type-h2">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ViewAll({ href, children = "View all" }: { href: string; children?: ReactNode }) {
  return <Link href={href} className="text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">{children} →</Link>;
}

/**
 * One panel holding a list of rows: one border for the group, dividers between rows, instead
 * of a card per row. The calmest way to show several things of one kind.
 */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-shell border border-line bg-surface ${className}`}>{children}</div>;
}

export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return <ul aria-label={label} className="divide-y divide-line">{children}</ul>;
}

/**
 * Up to three or four figures in one row — the page's essential numbers, nothing else. A list
 * rather than a definition list, so a whole figure can be one link (a link around a dt/dd pair
 * is invalid, and axe said so).
 */
export function Metrics({ items }: { items: Array<{ label: string; value: ReactNode; note?: ReactNode; href?: string }> }) {
  return (
    <ul aria-label="Key figures" className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((m) => {
        const body = (
          <>
            <span className="block text-xs font-medium text-ink-faint">{m.label}</span>
            <span className="mt-1 block text-xl font-semibold tnum">{m.value}</span>
            {m.note && <span className="mt-0.5 block text-xs text-ink-soft">{m.note}</span>}
          </>
        );
        return (
          <li key={m.label}>
            {m.href
              ? <Link href={m.href} className="block h-full px-5 py-4 transition-colors hover:bg-ground">{body}</Link>
              : <div className="px-5 py-4">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export type AttentionTone = "fail" | "high" | "medium" | "info";
const DOT: Record<AttentionTone, string> = { fail: "bg-fail-text", high: "bg-high-text", medium: "bg-warning-text", info: "bg-trace" };
const WORD: Record<AttentionTone, string> = { fail: "Broken", high: "Needs action", medium: "Waiting", info: "In progress" };

/**
 * Things that need someone, at most five. Each states itself in one sentence and links to the
 * place it is resolved. The tone is a word as well as a dot, never colour alone.
 */
export function AttentionList({ items, more }: {
  items: Array<{ text: ReactNode; href: string; action: string; tone: AttentionTone }>;
  more?: { href: string; count: number };
}) {
  const shown = items.slice(0, 5);
  return (
    <Panel>
      <Rows label="Needs attention">
        {shown.map((item, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 sm:flex-nowrap">
            <span className="flex w-28 shrink-0 items-center gap-2 text-xs font-medium text-ink-soft">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[item.tone]}`} />{WORD[item.tone]}
            </span>
            <span className="min-w-0 flex-1 basis-60 text-sm">{item.text}</span>
            <Link href={item.href} className="shrink-0 text-sm font-medium underline-offset-2 hover:underline">{item.action} →</Link>
          </li>
        ))}
      </Rows>
      {more && more.count > shown.length && (
        <div className="border-t border-line px-5 py-2.5 text-sm"><ViewAll href={more.href}>{more.count - shown.length} more</ViewAll></div>
      )}
    </Panel>
  );
}

/**
 * Tabs as links: each tab is an address (`?tab=cases`), so a view can be bookmarked and the
 * back button works, and every tab renders on the server — nothing waits for JavaScript.
 */
export function TabNav({ tabs, current, label }: {
  tabs: Array<{ key: string; label: ReactNode; href: string; count?: number }>;
  current: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <li key={t.key} className="shrink-0">
            <Link
              href={t.href}
              aria-current={t.key === current ? "page" : undefined}
              scroll={false}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${t.key === current ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
            >
              {t.label}
              {t.count !== undefined && <span className="rounded-full bg-sunken px-1.5 text-[11px] tnum text-ink-soft">{t.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Secondary information one predictable click away — "Why this matters", "Technical evidence",
 * "Advanced". Native <details>: works without JavaScript, announced as a disclosure.
 * One level only; a disclosure inside a disclosure is a page that should exist instead.
 */
export function Disclosure({ summary, children, defaultOpen = false, tone = "plain" }: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: "plain" | "danger";
}) {
  return (
    <details open={defaultOpen} className="group rounded-panel border border-line bg-surface">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden ${tone === "danger" ? "text-fail-text" : "text-ink"}`}>
        <span>{summary}</span>
        <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

/** A single sentence that states the page's state, in the weight of a headline. */
export function HealthLine({ tone, title, detail }: { tone: "pass" | "fail" | "warning" | "neutral" | "info"; title: string; detail?: ReactNode }) {
  const mark = { pass: "bg-pass-text", fail: "bg-fail-text", warning: "bg-warning-text", neutral: "bg-ink-ghost", info: "bg-trace" }[tone];
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span aria-hidden className={`mt-2 size-2.5 shrink-0 rounded-full ${mark}`} />
      <div className="min-w-0">
        <p className="text-lg font-semibold tracking-tight">{title}</p>
        {detail && <p className="mt-0.5 text-sm text-ink-soft">{detail}</p>}
      </div>
    </div>
  );
}
