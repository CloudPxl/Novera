import Link from "next/link";
import { SECTIONS, type SectionKey } from "./nav-model.ts";

/**
 * The views inside one place — Runs (All runs, Review, Reports, Compare) or Scenarios (Library,
 * Catalog, Drafts, Draft or import, Builder, Regressions) — drawn above the page header of each.
 *
 * Addresses, like every tab here: rendered on the server, bookmarkable, nothing waits for
 * JavaScript. Styled as the top bar's places rather than as a page's own `TabNav`, because it is
 * navigation between pages, not views of one page; a page with views of its own (Review's
 * queues, a scenario's catalog filters) keeps its `TabNav` below the header, and the two never
 * look like one row of tabs.
 */
export function SectionNav({ section, current, counts }: {
  section: SectionKey;
  current: string;
  /** A number beside a tab, read from stored rows by the page (Drafts waiting for a decision). */
  counts?: Partial<Record<string, number>>;
}) {
  const { label, tabs } = SECTIONS[section];
  return (
    <nav aria-label={`${label} section`} className="print-hide -mb-4 pt-6">
      <ul className="flex flex-wrap items-center gap-1">
        {tabs.map((t) => {
          const active = t.key === current;
          const count = counts?.[t.key];
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-sm transition-colors ${active ? "bg-sunken font-medium text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}
              >
                {t.label}
                {count !== undefined && count > 0 && <span className="rounded-full bg-surface px-1.5 text-[11px] tnum text-ink-soft ring-1 ring-line">{count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
