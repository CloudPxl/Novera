import type { Metadata } from "next";
import { requireContext, assertMembership } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { Card, Badge, type BadgeTone } from "@/components/ui/primitives.tsx";
import { formatWhen } from "@/lib/format/when.ts";
import { loadBillingView } from "@/lib/billing/load.ts";
import { PLAN_CATALOG, PLAN_KEYS, formatPlanPrice, isPlanKey, type Plan } from "@/lib/billing/plans.ts";
import { planAction, type PlanAction } from "@/lib/billing/plan-action.ts";
import type { BillingEntitlement, EntitlementSource, Standing } from "@/lib/billing/entitlement.ts";
import { SettingsNav } from "../nav.tsx";
import Link from "next/link";
import { BILLING_PATH, remedyFor } from "@/lib/billing/remedy.ts";
import { FAIR_USE_RUNS, FAIR_USE_WINDOW_DAYS, MAX_RUNS_IN_FLIGHT } from "@/lib/billing/limits.ts";
import { CancellationButton, CheckoutButton, PortalButton } from "./forms.tsx";

export const metadata: Metadata = { title: "Billing · Settings · Novera" };
export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<EntitlementSource, string> = {
  manual_grant: "A grant from Novera",
  subscription: "Subscription",
  byok: "Your own model key",
  trial: "Trial",
  none: "Nothing in force",
};

const STANDING: Record<Standing, { label: string; tone: BadgeTone }> = {
  none: { label: "none", tone: "neutral" },
  active: { label: "active", tone: "pass" },
  trialing: { label: "trial period", tone: "pass" },
  cancelling: { label: "cancels at period end", tone: "medium" },
  grace: { label: "payment failed — grace period", tone: "medium" },
  restricted: { label: "restricted", tone: "fail" },
  incomplete: { label: "payment not completed", tone: "neutral" },
  ended: { label: "ended", tone: "neutral" },
  paused: { label: "paused", tone: "neutral" },
  unrecognised: { label: "not recognised", tone: "error" },
};

/** The current allowance in words, from the computed entitlement only. */
function runsLine(e: BillingEntitlement): string {
  if (e.source === "trial" && e.trial) return `${Math.min(e.trial.used, e.trial.limit)} of ${e.trial.limit} trial runs used`;
  if (e.runsAllowed === null) {
    const started = e.source === "subscription" ? `${e.runsUsed} this period` : `${e.runsUsed} started`;
    return `${started} · unlimited on your own key`;
  }
  return e.runsOn === "novera" ? `${e.runsUsed} of ${e.runsAllowed} on Novera's keys` : `${e.runsUsed} of ${e.runsAllowed} runs`;
}

function tierName(e: BillingEntitlement): string {
  if ((e.source === "subscription" || e.source === "manual_grant") && e.planKey) return PLAN_CATALOG[e.planKey].name;
  return SOURCE_LABEL[e.source];
}

function Included({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-2 text-sm text-ink-soft">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-ink-faint" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ActionArea({ plan, action }: { plan: Plan; action: PlanAction }) {
  switch (action.kind) {
    case "checkout":
      return <CheckoutButton plan={plan.key} label={action.label} block />;
    case "portal":
      return <PortalButton label={action.label} disabled={action.disabled} block />;
    case "unavailable":
      return (
        <div>
          <button type="button" disabled className="inline-flex h-8 w-full cursor-not-allowed items-center justify-center rounded-control border border-line bg-sunken px-3 text-sm font-medium text-ink-faint">
            {action.label}
          </button>
          <p className="mt-2 text-xs text-ink-faint">{action.reason}</p>
        </div>
      );
    case "members":
      return <p className="rounded-control bg-sunken px-3 py-2 text-xs text-ink-soft">{action.reason}</p>;
  }
}

/**
 * The workspace's tier, its allowance and the plans on offer — every number computed on the
 * server from stored rows (src/lib/billing/load.ts), every price the approved catalog's
 * (src/lib/billing/plans.ts), which checkout holds Stripe's price to. Without billing configured
 * the plans still show, and their buttons say why they cannot be pressed.
 *
 * The return from Stripe (`?checkout=returned`, `?portal=returned`) only chooses a sentence; it
 * changes nothing. Only Stripe's signed webhook does.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const admin = await assertMembership(ctx.user.id, ctx.workspace.id);
  const [view, { count: members }, params] = await Promise.all([
    loadBillingView(admin, ctx.workspace.id),
    admin.from("workspace_members").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id),
    searchParams,
  ]);
  const manage = can(ctx.role, "billing.manage");
  const e = view.entitlement;
  const sub = e.subscription;
  const when = (iso: string | null) => (iso ? formatWhen(iso, ctx.profile, { date: true }) : null);
  const returned = params.checkout === "returned" ? "checkout" : params.checkout === "cancelled" ? "cancelled" : params.portal === "returned" ? "portal" : null;
  const planName = (key: string | null) => (key && isPlanKey(key) ? PLAN_CATALOG[key].name : null);
  const currentPlan = sub && !["ended", "none"].includes(sub.standing) ? sub.planKey : null;
  const remedy = remedyFor(e.blocker);

  return (
    <main className="w-full pb-10 text-ink">
      <SettingsNav current="billing" role={ctx.role} mode={ctx.accountMode} members={members ?? 1} workspace={ctx.workspace.name}>
        <div className="space-y-8">
          {!view.config.active && (
            <p role="status" className="rounded-control border border-line bg-sunken px-4 py-3 text-sm text-ink-soft">
              {view.config.reason ?? "Billing is not active yet."} Nothing can be bought or charged yet. After the trial, runs need a plan;
              until billing opens, <Link href="/support" className="font-medium text-ink underline underline-offset-2">contact support</Link> for a pilot grant.
            </p>
          )}
          {view.config.active && view.config.mode === "test" && (
            <p role="status" className="rounded-control border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-text">
              Stripe sandbox. Checkout uses test cards only; no real payment is taken.
            </p>
          )}
          {returned === "checkout" && (
            <p role="status" className="rounded-control border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
              You are back from Stripe. A plan starts here only when Stripe confirms the payment, usually within a minute; reload to check.
            </p>
          )}
          {returned === "cancelled" && (
            <p role="status" className="rounded-control border border-line bg-surface px-4 py-3 text-sm text-ink-soft">Checkout was left without paying. Nothing changed.</p>
          )}
          {returned === "portal" && (
            <p role="status" className="rounded-control border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
              You are back from the billing portal. Any change you made appears here once Stripe confirms it.
            </p>
          )}

          <section aria-labelledby="tier-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="tier-heading" className="text-lg font-semibold tracking-tight">This workspace</h2>
              {sub && <Badge tone={STANDING[sub.standing].tone}>{STANDING[sub.standing].label}</Badge>}
            </div>
            <Card className="mt-3 divide-y divide-line p-0">
              <dl className="grid gap-4 p-5 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-ink-faint">Current tier</dt>
                  <dd className="mt-1 text-sm font-medium">{tierName(e)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">Runs</dt>
                  <dd className="tnum mt-1 text-sm font-medium">{runsLine(e)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">{e.source === "subscription" ? "Allowance renews" : e.source === "manual_grant" ? "Grant ends" : "Window"}</dt>
                  <dd className="mt-1 text-sm font-medium">{when(e.windowEndsAt) ?? (e.source === "trial" ? "Across your workspaces" : "—")}</dd>
                </div>
              </dl>
              <div className="p-5 text-sm">
                {e.canRun
                  ? <p className="text-ink-soft">New runs can start.</p>
                  : <p role="status" className="text-fail-text">
                      {e.blockedReason}
                      {/* On this page the plans below are the remedy for a billing block; any other is resolved elsewhere. */}
                      {remedy && remedy.href !== BILLING_PATH && <> <Link href={remedy.href} className="font-medium text-ink underline underline-offset-2">{remedy.label}</Link></>}
                    </p>}
                {sub && (
                  <div className="mt-3">
                    <p className="font-medium">{planName(sub.planKey) ?? "Unrecognised plan"}</p>
                    <p className="mt-1 text-ink-soft">{sub.sentence}</p>
                    <ul className="mt-2 space-y-1 text-xs text-ink-faint">
                      {sub.periodEnd && <li>Current period ends {when(sub.periodEnd)}</li>}
                      {sub.endsAt && <li>Access under this plan ends {when(sub.endsAt)}</li>}
                      {sub.graceEndsAt && <li>Grace period ends {when(sub.graceEndsAt)}</li>}
                    </ul>
                  </div>
                )}
                {manage && view.config.active && (view.hasCustomer || sub) && (
                  <div className="mt-4 flex flex-wrap items-start gap-3">
                    <PortalButton disabled={!view.hasCustomer} />
                    {sub && ["active", "trialing", "cancelling", "grace"].includes(sub.standing) && (
                      <CancellationButton cancelling={sub.standing === "cancelling"} />
                    )}
                  </div>
                )}
                <p className="mt-4 text-xs leading-relaxed text-ink-faint">
                  After the trial, a plan or a grant decides whether a run can start, own model key or not. Fair use on every plan: at most{" "}
                  {MAX_RUNS_IN_FLIGHT} runs in progress at once and {FAIR_USE_RUNS.toLocaleString("en-GB")} runs in {FAIR_USE_WINDOW_DAYS} days
                  <span className="tnum"> (now: {view.usage.inFlight} in progress, {view.usage.inWindow} in the last {FAIR_USE_WINDOW_DAYS} days)</span>.
                  Every run, case and report stays readable and exportable whatever happens to a subscription.
                </p>
              </div>
            </Card>
          </section>

          <section aria-labelledby="plans-heading">
            <h2 id="plans-heading" className="text-lg font-semibold tracking-tight">Plans</h2>
            <p className="mt-1 text-sm text-ink-soft">Billed monthly in euros through Stripe. Cancel at any time; a plan runs to the end of the paid month.</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Card className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">Trial</h3>
                  {e.source === "trial" && <Badge tone="neutral">Current</Badge>}
                </div>
                <p className="mt-3"><span className="tnum text-3xl font-semibold tracking-tight">Free</span></p>
                <p className="mt-2 text-sm text-ink-soft">To see a first sealed report before choosing anything.</p>
                <Included items={[
                  "3 runs per account owner, across every workspace they own",
                  "Graded on Novera's keys, or on your own model key once connected",
                  "Every feature, and every report kept",
                  "Recurring testing after the trial needs a plan",
                ]} />
                <div className="mt-auto pt-5">
                  <p className="tnum rounded-control bg-sunken px-3 py-2 text-xs text-ink-soft">{Math.min(view.trial.used, view.trial.limit)} of {view.trial.limit} trial runs used</p>
                </div>
              </Card>

              {PLAN_KEYS.map((key) => {
                const plan = PLAN_CATALOG[key];
                const action = planAction({
                  plan: key, manage, config: view.config, sellable: view.sellablePlans.includes(key),
                  hasCustomer: view.hasCustomer, subscription: sub,
                });
                const current = currentPlan === key;
                return (
                  <Card key={key} className={`flex flex-col p-5 ${current ? "ring-2 ring-ink" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold">{plan.name}</h3>
                      {current && <Badge tone="pass">Current plan</Badge>}
                    </div>
                    <p className="mt-3">
                      <span className="tnum text-3xl font-semibold tracking-tight">{formatPlanPrice(plan)}</span>
                      <span className="text-sm text-ink-faint"> / month</span>
                    </p>
                    <p className="mt-2 text-sm text-ink-soft">{plan.audience}</p>
                    <Included items={[
                      "Unlimited runs graded on your own model key",
                      plan.managedRunsPerPeriod > 0
                        ? `${plan.managedRunsPerPeriod} runs a month graded on Novera's keys, with multi-model consensus`
                        : "No runs on Novera's keys: grading uses your key",
                      "API, MCP, schedules, webhooks and exports",
                      `Fair use: up to ${MAX_RUNS_IN_FLIGHT} runs at once and ${FAIR_USE_RUNS.toLocaleString("en-GB")} runs in ${FAIR_USE_WINDOW_DAYS} days`,
                    ]} />
                    <div className="mt-auto pt-5"><ActionArea plan={plan} action={action} /></div>
                  </Card>
                );
              })}
            </div>
          </section>

          <p className="text-xs leading-relaxed text-ink-faint">
            How VAT applies is confirmed before billing opens. Receipts and invoices come from Stripe, by email and in the billing portal; Novera sends no billing email.
          </p>
        </div>
      </SettingsNav>
    </main>
  );
}
