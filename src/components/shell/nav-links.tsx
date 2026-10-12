"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "@/components/ui/menu.tsx";
import { menuItemClass } from "@/components/ui/menu-item.ts";

export interface NavItem {
  href: string;
  label: string;
  /** Other paths this place lives at — `/billing` is Settings → Billing. */
  also?: string[];
}

/** A named group of places — "Work", "Library" — shown as one entry with its pages inside. */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => "items" in e;
const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);
/** How closely an item matches the current path: the length of its longest matching path, or 0. */
const matchLength = (pathname: string, item: NavItem) =>
  Math.max(0, ...[item.href, ...(item.also ?? [])].filter((p) => under(pathname, p)).map((p) => p.length));

/**
 * The one place that is current: the closest match. Billing lives under /settings, and both
 * "Settings" and "Billing" lit at once said nothing about where the person was.
 */
function currentHref(pathname: string, items: NavEntry[]): string | null {
  let best: { href: string; length: number } | null = null;
  for (const item of items.flatMap((e) => (isGroup(e) ? e.items : [e]))) {
    const length = matchLength(pathname, item);
    if (length > (best?.length ?? 0)) best = { href: item.href, length };
  }
  return best?.href ?? null;
}

/**
 * The operator's places, with the current one marked.
 *
 * Marked twice on purpose: `aria-current` for assistive tech and a visible background for
 * everyone else. A group is marked when any page inside it is the current one, so "Work" stays
 * lit on the review queue, a run and the regressions alike.
 */
export function NavLinks({ items, variant }: { items: NavEntry[]; variant: "bar" | "stack" }) {
  const pathname = usePathname();
  const current = currentHref(pathname, items);
  const isCurrent = (href: string) => href === current;

  if (variant === "stack") {
    return (
      <>
        {items.map((e) =>
          isGroup(e) ? (
            <div key={e.label} className="py-1">
              <p className="px-3 pb-0.5 pt-1.5 type-eyebrow text-ink-faint">{e.label}</p>
              {e.items.map((i) => <StackLink key={i.href} item={i} active={isCurrent(i.href)} />)}
            </div>
          ) : (
            <StackLink key={e.href} item={e} active={isCurrent(e.href)} />
          ),
        )}
      </>
    );
  }

  return (
    <>
      {items.map((e) => {
        if (!isGroup(e)) {
          const active = isCurrent(e.href);
          return (
            <Link key={e.href} href={e.href} aria-current={active ? "page" : undefined}
              className={`rounded-control px-2.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-sunken text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}>
              {e.label}
            </Link>
          );
        }
        const active = e.items.some((i) => isCurrent(i.href));
        return (
          <Menu
            key={e.label}
            label={<span>{e.label}</span>}
            align="left"
            triggerClassName={`px-2.5 py-1.5 ${active ? "bg-sunken text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}
            panelClassName="w-52"
          >
            {e.items.map((i) => (
              <Link key={i.href} href={i.href} aria-current={isCurrent(i.href) ? "page" : undefined} className={menuItemClass}>
                {i.label}
              </Link>
            ))}
          </Menu>
        );
      })}
    </>
  );
}

function StackLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined}
      className={`block rounded-control px-3 py-2 text-sm transition-colors ${active ? "bg-sunken font-medium text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}>
      {item.label}
    </Link>
  );
}
