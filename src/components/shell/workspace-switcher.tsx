"use client";

import Link from "next/link";
import { Menu } from "@/components/ui/menu.tsx";
import { menuItemClass } from "@/components/ui/menu-item.ts";
import { switchWorkspace } from "@/lib/workflow/identity.ts";

/**
 * The active workspace, and the others the person belongs to. Takes plain data and renders its
 * own forms: a list of server-built form elements handed through the menu lost their keys when
 * the menu opened (React warned on every open, 2026-10-02).
 */
export function WorkspaceSwitcher({ current, workspaces, heading, allLabel }: {
  current: { id: string; name: string };
  workspaces: Array<{ id: string; name: string; role: string }>;
  heading: string;
  allLabel: string;
}) {
  return (
    <Menu
      label={<span className="flex max-w-24 items-center gap-1.5 truncate sm:max-w-40 lg:max-w-28 xl:max-w-40"><span aria-hidden className="size-1.5 shrink-0 rounded-full bg-trace" /><span className="truncate">{current.name}</span></span>}
      align="left"
      triggerClassName="border border-line px-2.5 py-1.5 text-ink hover:bg-sunken"
      panelClassName="w-72"
    >
      <p className="px-3 pb-1 pt-2 type-eyebrow text-ink-faint">{heading}</p>
      {workspaces.map((w) => (
        <form key={w.id} action={switchWorkspace}>
          <input type="hidden" name="workspaceId" value={w.id} />
          <button type="submit" aria-current={w.id === current.id ? "true" : undefined} className={`${menuItemClass} flex items-center justify-between gap-2`}>
            <span className="min-w-0 truncate font-medium">{w.name}</span>
            <span className="shrink-0 text-xs text-ink-faint">{w.id === current.id ? "open · " : ""}{w.role}</span>
          </button>
        </form>
      ))}
      <Link href="/workspaces" className={`${menuItemClass} border-t border-line text-ink-soft`}>{allLabel}</Link>
    </Menu>
  );
}
