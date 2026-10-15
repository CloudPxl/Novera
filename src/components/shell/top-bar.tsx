import { LogoMark } from "@/components/ui/logo.tsx";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement } from "@/lib/auth/entitlement.ts";
import { BILLING_PATH, needsBillingAction, remedyFor } from "@/lib/billing/remedy.ts";
import { isStaff } from "@/lib/auth/staff.ts";
import { can, ROLE_LABEL } from "@/lib/auth/permissions.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { createRun } from "@/lib/workflow/actions.ts";
import { WorkspaceSwitcher } from "./workspace-switcher.tsx";
import { signOut } from "@/app/sign-in/actions.ts";
import { Badge } from "@/components/ui/primitives.tsx";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { Menu } from "@/components/ui/menu.tsx";
import { menuItemClass } from "@/components/ui/menu-item.ts";
import { NavLinks, type NavEntry, type NavItem } from "./nav-links.tsx";
import { fundingBadge } from "./funding-badge.ts";
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
    // Archived agents take no new run (0063), so the launcher does not offer them.
    db.from("agents").select("id, name, config").eq("workspace_id", workspace.id).is("archived_at", null).order("created_at"),
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

  // Billing is Settings → Billing: not a primary place, but one click away in the account menu
  // for whoever can change the plan (owner and admin), and the status badge links to it.
  const mayBill = can(role, "billing.manage");
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
        { href: "/settings", label: "Settings", also: ["/billing"] },
      ]
    : [
        { href: "/dashboard", label: "Overview" },
        ...(mode === "enterprise" ? [{ href: "/workspaces", label: "Workspaces" }] : []),
        work,
        { href: "/reports", label: "Reports" },
        library,
        ...(mode === "enterprise" && can(role, "audit.view") ? [{ href: "/settings/audit", label: "Audit" }] : []),
        { href: "/settings", label: "Settings", also: ["/billing"] },
      ];
  // Staff places (src/lib/auth/staff-list.ts): the inbound queue and launch readiness. Kept out of
  // `nav` so they can leave the bar where it is full: agency and enterprise mode fill it at 1024
  // (Readiness pushed it 77 px past the edge in enterprise mode), so there they sit in the bar
  // from xl and in the menu below it. The compact personal bar has room from lg.
  const staff: NavItem[] = isStaff(user.email) ? [{ href: "/inbox", label: "Inbox" }, { href: "/readiness", label: "Readiness" }] : [];
  const compactNav = mode === "personal" && !multi;
  const funding = entitlement.fundingLine;
  const badge = fundingBadge(entitlement);
  // The complete sentence behind the short badge: what funds runs, and why runs are refused.
  const fundingFull = entitlement.canRun ? funding : `${funding}. ${entitlement.blockedReason ?? "Runs cannot start."}`;
  // A run blocked on payment is the one thing in this bar a person must act on.
  const upgrade = mayBill && needsBillingAction(entitlement.blocker) ? remedyFor(entitlement.blocker) : null;

  return (
    <header className="print-hide sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[80rem] items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-1.5 rounded-control text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink">
          <LogoMark className="size-8" />
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
          {staff.length > 0 && (
            <span className={compactNav ? "contents" : "hidden xl:contents"}><NavLinks items={staff} variant="bar" /></span>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className={mode === "enterprise" ? "hidden xl:inline" : "hidden lg:inline"}>
            {/* What is really stored, not an invented environment label: a report has
                to say who funded the grading, so the bar says it too — in a few words,
                with the whole sentence as its accessible name. */}
            {mayBill
              ? <Link href={BILLING_PATH} title={fundingFull} className="rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ink" aria-label={`${badge.text}: ${fundingFull.replace(/\.$/, "")}. Open billing`}><Badge tone={badge.tone} className="whitespace-nowrap">{badge.text}</Badge></Link>
              : <span title={fundingFull}><Badge tone={badge.tone} className="whitespace-nowrap">{badge.text}<span className="sr-only">. {fundingFull}</span></Badge></span>}
          </span>
          {upgrade && (
            // Wrapped: the button's own inline-flex would override `hidden`. Below sm it is in the
            // menu; in enterprise mode also from lg to xl, where its eight places fill the bar.
            <span className={mode === "enterprise" ? "hidden sm:inline-flex lg:hidden xl:inline-flex" : "hidden sm:inline-flex"}>
              <ButtonLink href={upgrade.href} size="sm" className="whitespace-nowrap">{upgrade.label}</ButtonLink>
            </span>
          )}
          {role !== "owner" && <span className="hidden xl:inline"><Badge tone="neutral">{ROLE_LABEL[role]}</Badge></span>}

          {can(role, "run.start") && (
            <RunLauncher
              agents={agents}
              suites={suites}
              action={createRun}
              blocked={entitlement.canRun ? null : {
                reason: entitlement.blockedReason ?? "Runs cannot start in this workspace right now.",
                // A member who cannot change the plan is told who can, not sent to a page that refuses them.
                remedy: needsBillingAction(entitlement.blocker) && !mayBill ? null : remedyFor(entitlement.blocker),
                stillTry: entitlement.blocker === "concurrency",
              }}
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
              <p className={`mt-1.5 text-xs text-ink-soft ${mode === "enterprise" ? "xl:hidden" : "lg:hidden"}`}>{fundingFull}</p>
              {upgrade && (
                <Link href={upgrade.href} className={`mt-1 inline-block text-xs font-medium text-ink underline underline-offset-2 ${mode === "enterprise" ? "sm:hidden lg:inline-block xl:hidden" : "sm:hidden"}`}>
                  {upgrade.label}
                </Link>
              )}
            </div>

            <div className="py-1 lg:hidden">
              <NavLinks items={nav} variant="stack" />
            </div>
            {staff.length > 0 && (
              <div className={`py-1 ${compactNav ? "lg:hidden" : "xl:hidden"}`}>
                <NavLinks items={[{ label: "Staff", items: staff }]} variant="stack" />
              </div>
            )}

            <div className="border-t border-line py-1 lg:border-t-0">
              {can(role, "agent.write") && <Link href="/agents/new" className={menuItemClass}>Connect an agent</Link>}
              {/* Settings is in the nav itself (above, stacked, below lg), and so is Audit in
                  enterprise mode: listed twice on a phone before (UI audit, 2026-10-08). */}
              {(mode !== "personal" || multi) && <Link href="/settings/members" className={menuItemClass}>Members</Link>}
              {mayBill && <Link href={BILLING_PATH} className={menuItemClass}>Billing</Link>}
              {can(role, "audit.view") && mode === "agency" && <Link href="/settings/audit" className={menuItemClass}>Audit log</Link>}
              <Link href="/settings/profile" className={menuItemClass}>Your profile</Link>
              <Link href="/guide" className={menuItemClass}>Step-by-step guide</Link>
              <Link href="/docs" className={menuItemClass}>Documentation</Link>
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
