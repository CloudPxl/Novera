"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "@/components/ui/menu.tsx";
import { menuItemClass } from "@/components/ui/menu-item.ts";

export interface NavItem {
  href: string;
  label: string;
}

/** A named group of places — "Work", "Library" — shown as one entry with its pages inside. */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => "items" in e;
const activeFor = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * The operator's places, with the current one marked.
 *
 * Marked twice on purpose: `aria-current` for assistive tech and a visible background for
 * everyone else. A group is marked when any page inside it is the current one, so "Work" stays
 * lit on the review queue, a run and the regressions alike.
 */
export function NavLinks({ items, variant }: { items: NavEntry[]; variant: "bar" | "stack" }) {
  const pathname = usePathname();

  if (variant === "stack") {
    return (
      <>
        {items.map((e) =>
          isGroup(e) ? (
            <div key={e.label} className="py-1">
              <p className="px-3 pb-0.5 pt-1.5 type-eyebrow text-ink-faint">{e.label}</p>
              {e.items.map((i) => <StackLink key={i.href} item={i} active={activeFor(pathname, i.href)} />)}
            </div>
          ) : (
            <StackLink key={e.href} item={e} active={activeFor(pathname, e.href)} />
          ),
        )}
      </>
    );
  }

  return (
    <>
      {items.map((e) => {
        if (!isGroup(e)) {
          const active = activeFor(pathname, e.href);
          return (
            <Link key={e.href} href={e.href} aria-current={active ? "page" : undefined}
              className={`rounded-control px-2.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-sunken text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}>
              {e.label}
            </Link>
          );
        }
        const active = e.items.some((i) => activeFor(pathname, i.href));
        return (
          <Menu
            key={e.label}
            label={<span>{e.label}</span>}
            align="left"
            triggerClassName={`px-2.5 py-1.5 ${active ? "bg-sunken text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}
            panelClassName="w-52"
          >
            {e.items.map((i) => (
              <Link key={i.href} href={i.href} aria-current={activeFor(pathname, i.href) ? "page" : undefined} className={menuItemClass}>
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
