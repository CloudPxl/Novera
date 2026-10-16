/**
 * What the operator's navigation offers, and which place is current — pure, so the tests read
 * the same table the top bar draws.
 *
 * Connect → Run → Share (Block 6, 2026-10-16). Five places, in the order the work happens:
 * Dashboard · Agents (connect one) · Scenarios (what it is tested on) · Runs (run it, review what
 * it found, share the sealed report) · Settings. The secondary views of a place are its section
 * tabs (`SECTIONS`), drawn at the top of each of those pages, never extra top-level items:
 *
 *   Runs       — Runs, Review, Reports, Compare. Review is the queue of what the runs found,
 *                and a report is a run's sealed result: both are read *from* runs.
 *   Scenarios  — Library, Catalog, Drafts, Draft or import, Builder, Regressions. A recorded
 *                production failure becomes a scenario draft, so Regressions is where scenarios
 *                come from, beside the Builder, not a third silo.
 *
 * Enterprise adds Workspaces and Audit. Every existing URL still resolves (`/suites` is the
 * catalog, `/billing` is Settings → Billing); `also` lists the paths each place lights up for.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Other paths this place lives at — `/reports` is Runs → Reports. */
  also?: string[];
}

/** A named group of places, shown as one entry with its pages inside (the staff menu). */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export type AccountMode = "personal" | "agency" | "enterprise";

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

/** Runs, and the views read from runs. */
export const RUNS_ALSO = ["/review", "/reports"];
/** Scenarios, and where scenarios come from. */
export const SCENARIOS_ALSO = ["/suites", "/builder", "/regressions"];

export function navFor(args: { mode: AccountMode; multi: boolean; agentCount: number; canAudit: boolean }): NavItem[] {
  const personal = args.mode === "personal" && !args.multi;
  return [
    { href: "/dashboard", label: "Dashboard" },
    ...(args.mode === "enterprise" ? [{ href: "/workspaces", label: "Workspaces" }] : []),
    { href: "/agents", label: personal ? (args.agentCount === 1 ? "My agent" : "My agents") : "Agents" },
    { href: "/scenarios", label: "Scenarios", also: SCENARIOS_ALSO },
    { href: "/runs", label: personal ? "My runs" : "Runs", also: RUNS_ALSO },
    ...(args.mode === "enterprise" && args.canAudit ? [{ href: "/settings/audit", label: "Audit" }] : []),
    { href: "/settings", label: "Settings", also: ["/billing"] },
  ];
}

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/** How closely an item matches the current path: the length of its longest matching path, or 0. */
const matchLength = (pathname: string, item: NavItem) =>
  Math.max(0, ...[item.href, ...(item.also ?? [])].filter((p) => under(pathname, p)).map((p) => p.length));

/**
 * The one place that is current: the closest match. Billing lives under /settings, and both
 * "Settings" and "Billing" lit at once said nothing about where the person was.
 */
export function currentHref(pathname: string, items: NavEntry[]): string | null {
  let best: { href: string; length: number } | null = null;
  for (const item of items.flatMap((e) => (isGroup(e) ? e.items : [e]))) {
    const length = matchLength(pathname, item);
    if (length > (best?.length ?? 0)) best = { href: item.href, length };
  }
  return best?.href ?? null;
}

// ------------------------------------------------------------------ section tabs

export type SectionKey = "runs" | "scenarios";

export interface SectionTab {
  key: string;
  label: string;
  href: string;
}

export const SECTIONS: Record<SectionKey, { label: string; tabs: SectionTab[] }> = {
  runs: {
    label: "Runs",
    tabs: [
      { key: "runs", label: "All runs", href: "/runs" },
      { key: "review", label: "Review", href: "/review" },
      { key: "reports", label: "Reports", href: "/reports" },
      { key: "compare", label: "Compare", href: "/runs/compare" },
    ],
  },
  scenarios: {
    label: "Scenarios",
    tabs: [
      { key: "library", label: "Library", href: "/scenarios" },
      { key: "catalog", label: "Catalog", href: "/scenarios?tab=catalog" },
      { key: "drafts", label: "Drafts", href: "/scenarios?tab=drafts" },
      { key: "create", label: "Draft or import", href: "/scenarios?tab=create" },
      { key: "builder", label: "Builder", href: "/builder" },
      { key: "regressions", label: "Regressions", href: "/regressions" },
    ],
  },
};

/**
 * Which section tab an address is: the section and the tab key, or null for a page outside
 * both sections. A run's own page and a loaded comparison are inside Runs without being one of
 * its tabs (they are a run and a pair of runs, with tabs of their own).
 */
export function sectionTabOf(pathname: string, search = ""): { section: SectionKey; tab: string } | null {
  const tab = new URLSearchParams(search).get("tab");
  const view = new URLSearchParams(search).get("view");
  if (pathname === "/runs") return { section: "runs", tab: "runs" };
  if (pathname === "/review") return { section: "runs", tab: "review" };
  if (pathname === "/reports") return { section: "runs", tab: "reports" };
  if (pathname === "/runs/compare") return { section: "runs", tab: "compare" };
  if (pathname === "/scenarios") {
    const key = tab === "drafts" || tab === "create" || tab === "catalog" ? tab : view === "catalog" ? "catalog" : "library";
    return { section: "scenarios", tab: key };
  }
  if (pathname === "/suites") return { section: "scenarios", tab: "catalog" };
  if (pathname === "/builder") return { section: "scenarios", tab: "builder" };
  if (pathname === "/regressions") return { section: "scenarios", tab: "regressions" };
  return null;
}
