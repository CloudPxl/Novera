import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { isStaff } from "@/lib/auth/staff.ts";
import { can, ROLE_LABEL } from "@/lib/auth/permissions.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { createRun } from "@/lib/workflow/actions.ts";
import { WorkspaceSwitcher } from "./workspace-switcher.tsx";
import { signOut } from "@/app/sign-in/actions.ts";
import { Badge } from "@/components/ui/primitives.tsx";
import { Menu } from "@/components/ui/menu.tsx";
import { menuItemClass } from "@/components/ui/menu-item.ts";
import { NavLinks, type NavEntry } from "./nav-links.tsx";
import { RunLauncher, type LaunchAgent, type LaunchSuite } from "./run-launcher.tsx";

/** An endpoint's host, which is what identifies an agent to an operator in a hurry. */
function hostOf(config: unknown): string {
  const url = (config as { url?: unknown } | null)?.url;
  if (typeof url !== "string") return "no endpoint";
  try {
    return new URL(url).host;
  } catch {
    return "no endpoint";
  }
}

/**
 * The chrome every operator page shares.
 *
 * Everything it lists belongs to the active workspace: the agents, the suites, the trial
 * count. A person in several workspaces sees which one is active and switches here; a person
 * in one, in personal mode, never sees a switcher at all. Controls a role cannot use are not
 * drawn — the server refuses them regardless.
 */
export async function TopBar() {
  const { user, workspace, role, context } = await requireWorkspace();
  const db = await sessionClient();
  const mode = context.accountMode;
  const multi = context.memberships.length > 1;

  const [{ data: agentRows }, { data: suiteRows }] = await Promise.all([
    db.from("agents").select("id, name, config").eq("workspace_id", workspace.id).order("created_at"),
    // Built-in suites (no workspace) and this workspace's own; never another membership's.
    db.from("suites").select("id, key, name, version, cases").or(`workspace_id.is.null,workspace_id.eq.${workspace.id}`).neq("approval", "exploratory")
      .order("key").order("version", { ascending: false }),
  ]);

  const admin = await assertMembership(user.id, workspace.id);
  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });

  const agents: LaunchAgent[] = (agentRows ?? []).map((a) => ({ id: a.id as string, name: a.name as string, host: hostOf(a.config) }));
  const suites: LaunchSuite[] = (suiteRows ?? []).map((s) => ({
    id: s.id as string, key: s.key as string, name: s.name as string, version: s.version as number,
    caseCount: Array.isArray(s.cases) ? s.cases.length : 0,
  }));

  const runsLeft = Math.max(0, TRIAL_RUN_LIMIT - entitlement.runsUsed);
  // Navigation by account mode (2026-10-02 IA refactor). Personal: five plain places.
  // Agency: work grouped by what you do with it. Enterprise: agency plus workspaces and audit.
  // Every existing URL still resolves; this only decides what is offered first.
  const work: NavEntry = { label: "Work", items: [{ href: "/review", label: "Review queue" }, { href: "/runs", label: "Runs" }, { href: "/regressions", label: "Regressions" }] };
  const library: NavEntry = { label: "Library", items: [{ href: "/agents", label: "Agents and policies" }, { href: "/scenarios", label: "Scenarios" }] };
  const nav: NavEntry[] = mode === "personal" && !multi
    ? [
        { href: "/dashboard", label: "Overview" },
        { href: "/agents", label: agents.length === 1 ? "My agent" : "My agents" },
        { href: "/runs", label: "My runs" },
        { href: "/reports", label: "My reports" },
        { href: "/settings", label: "Settings" },
      ]
    : [
        { href: "/dashboard", label: "Overview" },
        ...(mode === "enterprise" ? [{ href: "/workspaces", label: "Workspaces" }] : []),
        work,
        { href: "/reports", label: "Reports" },
        library,
        ...(mode === "enterprise" && can(role, "audit.view") ? [{ href: "/settings/audit", label: "Audit" }] : []),
        { href: "/settings", label: "Settings" },
      ];
  if (isStaff(user.email)) nav.push({ href: "/inbox", label: "Inbox" });
  const funding = entitlement.ownKey ? `Own key · ${entitlement.provider}` : `Trial · ${runsLeft} of ${TRIAL_RUN_LIMIT} runs left`;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[80rem] items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ink">
          <span aria-hidden className="grid size-7 place-items-center rounded-control bg-ink text-xs font-bold text-on-ink">N</span>
          {/* The wordmark is hidden below sm, which left the link with no accessible
              name at phone width — the mark beside it is decorative. */}
          <span className="sr-only">Novera home</span>
          <span aria-hidden className="hidden text-sm font-semibold tracking-tight sm:inline">Novera</span>
        </Link>

        {(multi || mode !== "personal") && (
          <WorkspaceSwitcher
            current={{ id: workspace.id, name: workspace.name }}
            workspaces={context.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: ROLE_LABEL[m.role].toLowerCase() }))}
            heading={mode === "agency" ? "Clients" : "Workspaces"}
            allLabel={mode === "agency" ? "All clients, and add one…" : "All workspaces, and add one…"}
          />
        )}

        <span aria-hidden className="hidden h-5 w-px bg-line lg:block" />

        {/* From lg only. At md the links, the agent menu, Import, Run and Menu came to
            785 px in a 720 px bar; below lg they are in the menu, as on a phone. */}
        <nav aria-label="Primary" className="hidden items-center gap-0.5 lg:flex">
          <NavLinks items={nav} variant="bar" />
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden xl:inline">
            {/* What is really stored, not an invented environment label: a report has
                to say who funded the grading, so the bar says it too. */}
            <Badge tone={entitlement.ownKey ? "pass" : "neutral"}>{funding}</Badge>
          </span>
          {role !== "owner" && <span className="hidden xl:inline"><Badge tone="neutral">{ROLE_LABEL[role]}</Badge></span>}

          {can(role, "run.start") && (
            <RunLauncher
              agents={agents}
              suites={suites}
              action={createRun}
              defaultAgentId={context.profile.default_agent_id ?? undefined}
              defaultSuiteKey={context.profile.preferred_suite_key}
            />
          )}

          <Menu
            label={<span className="sr-only">Menu</span>}
            triggerClassName="border border-line-strong px-2.5 py-2 text-ink-soft hover:bg-sunken"
            panelClassName="w-60"
          >
            <div className="border-b border-line px-3 py-2">
              <p className="truncate text-sm font-medium text-ink">{context.profile.display_name ?? user.email}</p>
              <p className="truncate text-xs text-ink-faint">{workspace.name} · {ROLE_LABEL[role].toLowerCase()}</p>
              <p className="mt-1.5 text-xs text-ink-soft xl:hidden">{funding}</p>
            </div>

            <div className="py-1 lg:hidden">
              <NavLinks items={nav} variant="stack" />
            </div>

            <div className="border-t border-line py-1 lg:border-t-0">
              {can(role, "agent.write") && <Link href="/agents/new" className={menuItemClass}>Connect an agent</Link>}
              <Link href="/settings" className={menuItemClass}>Workspace settings</Link>
              {(mode !== "personal" || multi) && <Link href="/settings/members" className={menuItemClass}>Members</Link>}
              {can(role, "audit.view") && mode !== "personal" && <Link href="/settings/audit" className={menuItemClass}>Audit log</Link>}
              <Link href="/settings/profile" className={menuItemClass}>Your profile</Link>
              <Link href="/guide" className={menuItemClass}>Step-by-step guide</Link>
              <Link href="/docs" className={menuItemClass}>Documentation</Link>
              <Link href="/" className={menuItemClass}>Home page</Link>
            </div>

            <form action={signOut} className="border-t border-line py-1">
              <button type="submit" className={menuItemClass}>Sign out</button>
            </form>
          </Menu>
        </div>
      </div>
    </header>
  );
}
