import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { isStaff } from "@/lib/auth/staff.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { createRun } from "@/lib/workflow/actions.ts";
import { signOut } from "@/app/sign-in/actions.ts";
import { Badge } from "@/components/ui/primitives.tsx";
import { Menu, menuItemClass } from "@/components/ui/menu.tsx";
import { NavLinks, type NavItem } from "./nav-links.tsx";
import { RunLauncher, type LaunchAgent, type LaunchSuite } from "./run-launcher.tsx";
import { ImportSuite } from "./import-suite.tsx";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/scenarios", label: "Scenarios" },
];

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
 * The chrome every operator page now shares.
 *
 * Before this, each page rendered its own header and its own set of buttons, so
 * "where am I and what can I do" was answered differently on every screen and
 * starting a run meant navigating to the right agent first.
 */
export async function TopBar() {
  const { user, workspace } = await requireWorkspace();
  const db = await sessionClient();

  const [{ data: agentRows }, { data: suiteRows }] = await Promise.all([
    db.from("agents").select("id, name, config").order("created_at"),
    db.from("suites").select("id, key, name, version, cases").order("key"),
  ]);

  const admin = await assertMembership(user.id, workspace.id);
  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });

  const agents: LaunchAgent[] = (agentRows ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    host: hostOf(a.config),
  }));
  const suites: LaunchSuite[] = (suiteRows ?? []).map((s) => ({
    id: s.id as string,
    key: s.key as string,
    name: s.name as string,
    version: s.version as number,
    caseCount: Array.isArray(s.cases) ? s.cases.length : 0,
  }));

  const runsLeft = Math.max(0, TRIAL_RUN_LIMIT - entitlement.runsUsed);
  const nav = isStaff(user.email) ? [...NAV, { href: "/inbox", label: "Inbox" }] : NAV;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-2 px-4 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ink">
          <span aria-hidden className="grid size-7 place-items-center rounded-control bg-ink text-xs font-bold text-on-ink">N</span>
          {/* The wordmark is hidden below sm, which left the link with no accessible
              name at phone width — the mark beside it is decorative. */}
          <span className="sr-only">Novera home</span>
          <span aria-hidden className="hidden text-sm font-semibold tracking-tight sm:inline">Novera</span>
        </Link>

        <span aria-hidden className="hidden h-5 w-px bg-line md:block" />

        <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex">
          <NavLinks items={nav} variant="bar" />
        </nav>

        {/* The agent selector. Deliberately a list of endpoints rather than names
            alone: two agents called "Support" pointing at staging and production
            are indistinguishable by name, and that mistake costs a whole run. */}
        <Menu
          label={<span className="max-w-32 truncate">{agents.length ? "Agents" : "No agents"}</span>}
          align="left"
          className="hidden md:block"
          triggerClassName="px-2.5 py-1.5 text-ink-soft hover:bg-sunken"
          panelClassName="w-72"
        >
          {agents.length === 0 ? (
            <p className="px-3 py-2 text-sm leading-relaxed text-ink-soft">
              Nothing connected yet.
            </p>
          ) : (
            agents.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}`} className={menuItemClass}>
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block truncate type-mono text-xs text-ink-faint">{a.host}</span>
              </Link>
            ))
          )}
          <Link href="/agents/new" className={`${menuItemClass} border-t border-line text-ink-soft`}>
            Connect an agent…
          </Link>
        </Menu>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden lg:inline">
            {/* What is really stored, not an invented environment label: a report has
                to say who funded the grading, so the bar says it too. */}
            <Badge tone={entitlement.ownKey ? "pass" : "neutral"}>
              {entitlement.ownKey ? `Own key · ${entitlement.provider}` : `Trial · ${runsLeft} of ${TRIAL_RUN_LIMIT} runs left`}
            </Badge>
          </span>

          <span className="hidden sm:inline"><ImportSuite /></span>

          <RunLauncher agents={agents} suites={suites} action={createRun} />

          <Menu
            label={<span className="sr-only">Menu</span>}
            triggerClassName="border border-line-strong px-2.5 py-2 text-ink-soft hover:bg-sunken"
            panelClassName="w-60"
          >
            <div className="border-b border-line px-3 py-2">
              <p className="truncate text-sm font-medium text-ink">{workspace.name}</p>
              <p className="truncate text-xs text-ink-faint">{user.email}</p>
              <p className="mt-1.5 text-xs text-ink-soft lg:hidden">
                {entitlement.ownKey ? `Own key · ${entitlement.provider}` : `Trial · ${runsLeft} of ${TRIAL_RUN_LIMIT} runs left`}
              </p>
            </div>

            <div className="py-1 md:hidden">
              <NavLinks items={nav} variant="stack" />
            </div>

            <div className="border-t border-line py-1 md:border-t-0">
              <Link href="/agents/new" className={menuItemClass}>Connect an agent</Link>
              <Link href="/settings" className={menuItemClass}>Settings</Link>
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
