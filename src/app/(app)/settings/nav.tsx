import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountMode } from "@/lib/auth/session.ts";
import { can, ROLE_LABEL, type Role } from "@/lib/auth/permissions.ts";

export type SettingsSection = "general" | "grading" | "developer" | "members" | "billing" | "audit" | "profile" | "account";

/**
 * Settings, grouped by whom they concern — you, this workspace, its integrations, its security —
 * with one section on screen at a time instead of one long page.
 *
 * A personal account sees "Members" and "Audit log" only once it has more than one member: inviting
 * is a decision, not a default screen. Every section stays reachable by its address.
 */
export function SettingsNav({ current, role, mode, members, workspace, children }: {
  current: SettingsSection | "workspace";
  role: Role;
  mode: AccountMode;
  members: number;
  workspace: string;
  children: ReactNode;
}) {
  const active = current === "workspace" ? "general" : current;
  const team = mode !== "personal" || members > 1;
  const groups: Array<{ label: string; items: Array<{ key: SettingsSection; href: string; label: string }> }> = [
    {
      label: "You",
      items: [
        { key: "profile", href: "/settings/profile", label: "Profile and preferences" },
        { key: "account", href: "/settings/account", label: "Sign-in and security" },
      ],
    },
    {
      label: "This workspace",
      items: [
        { key: "general", href: "/settings", label: "General" },
        { key: "grading", href: "/settings/grading", label: "Grading and data routing" },
        ...(team ? [{ key: "members" as const, href: "/settings/members", label: "Members" }] : []),
        { key: "billing", href: "/settings/billing", label: "Billing" },
      ],
    },
    { label: "Developer", items: [{ key: "developer", href: "/settings/developer", label: "API keys, MCP and webhooks" }] },
    ...(can(role, "audit.view") && team ? [{ label: "Security", items: [{ key: "audit" as const, href: "/settings/audit", label: "Audit log" }] }] : []),
  ];

  return (
    <>
      <header className="pb-6 pt-8">
        <p className="type-eyebrow text-ink-faint">Settings</p>
        <h1 className="mt-1.5 type-h1">{active === "profile" ? "Your profile" : active === "account" ? "Sign-in and security" : workspace}</h1>
        <p className="mt-1.5 type-body text-ink-soft">
          {active === "profile" || active === "account" ? "Yours, in every workspace." : <>You are <span className="font-medium text-ink">{ROLE_LABEL[role].toLowerCase()}</span> here.</>}
        </p>
      </header>
      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-20">
          <ul className="flex gap-1 overflow-x-auto border-b border-line pb-2 lg:block lg:space-y-5 lg:border-b-0 lg:pb-0">
            {groups.map((g) => (
              <li key={g.label} className="shrink-0">
                <p className="hidden px-3 pb-1 type-eyebrow text-ink-faint lg:block">{g.label}</p>
                <ul className="flex gap-1 lg:block lg:space-y-0.5">
                  {g.items.map((i) => (
                    <li key={i.key} className="shrink-0">
                      <Link
                        href={i.href}
                        aria-current={i.key === active ? "page" : undefined}
                        className={`block whitespace-nowrap rounded-control px-3 py-1.5 text-sm transition-colors ${i.key === active ? "bg-sunken font-medium text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}
                      >
                        {i.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-3xl">{children}</div>
      </div>
    </>
  );
}
