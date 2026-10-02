import Link from "next/link";
import type { AccountMode } from "@/lib/auth/session.ts";
import { can, ROLE_LABEL, type Role } from "@/lib/auth/permissions.ts";

/**
 * The settings sections, by who they are for. A personal account sees "Members" only once it
 * has more than one, because inviting is a decision, not a default screen; the audit log is
 * shown to the roles that may read it.
 */
export function SettingsNav({ current, role, mode, members, workspace }: {
  current: "workspace" | "members" | "profile" | "audit";
  role: Role;
  mode: AccountMode;
  members: number;
  workspace: string;
}) {
  const items: Array<{ key: typeof current; href: string; label: string }> = [
    { key: "workspace", href: "/settings", label: "Workspace" },
    ...(mode !== "personal" || members > 1 ? [{ key: "members" as const, href: "/settings/members", label: "Members" }] : []),
    ...(can(role, "audit.view") && (mode !== "personal" || members > 1) ? [{ key: "audit" as const, href: "/settings/audit", label: "Audit log" }] : []),
    { key: "profile", href: "/settings/profile", label: "Your profile" },
  ];
  return (
    <div className="mt-4 border-b border-line">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="type-h1">Settings</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {current === "profile" ? "Yours, in every workspace." : <>{workspace} · you are <span className="font-medium text-ink">{ROLE_LABEL[role].toLowerCase()}</span></>}
          </p>
        </div>
      </div>
      <nav aria-label="Settings sections" className="-mb-px mt-5 flex gap-1 overflow-x-auto">
        {items.map((i) => (
          <Link
            key={i.key}
            href={i.href}
            aria-current={i.key === current ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${i.key === current ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          >
            {i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
