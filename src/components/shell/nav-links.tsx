"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The operator's places, with the current one marked.
 *
 * Marked twice on purpose: `aria-current` for assistive tech and a visible
 * background for everyone else. Colour alone would leave the state invisible to
 * a reader who cannot see it and to anyone printing the page.
 */
export function NavLinks({ items, variant }: { items: NavItem[]; variant: "bar" | "stack" }) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              variant === "bar"
                ? `rounded-control px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-sunken text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"
                  }`
                : `block rounded-control px-3 py-2 text-sm transition-colors ${
                    active ? "bg-sunken font-medium text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"
                  }`
            }
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
