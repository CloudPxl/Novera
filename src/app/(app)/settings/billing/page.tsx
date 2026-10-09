import type { Metadata } from "next";
import { requireContext, assertMembership } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { Card, Badge, type BadgeTone } from "@/components/ui/primitives.tsx";
import { formatWhen } from "@/lib/format/when.ts";
import { loadBillingView } from "@/lib/billing/load.ts";
import { PLAN_CATALOG, isPlanKey } from "@/lib/billing/plans.ts";
import type { EntitlementSource, Standing } from "@/lib/billing/entitlement.ts";
import { SettingsNav } from "../nav.tsx";
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

/**
 * What this workspace may do and what pays for it — every number computed on the server from
 * stored rows (src/lib/billing/load.ts). Prices are never shown: none is approved. When billing
 * is not configured the page says so and offers nothing to press.
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

  return (
    <main className="w-full pb-10 text-ink">
      <SettingsNav current="billing" role={ctx.role} mode={ctx.accountMode} members={members ?? 1} workspace={ctx.workspace.name}>
        <div className="space-y-8">
          {!view.config.active && (
            <p role="status" className="rounded-control border border-line bg-sunken px-4 py-3 text-sm text-ink-soft">
              {view.config.reason ?? "Billing is not active yet."} Nothing is charged, and nothing on this page changes what you can do.
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

          <section aria-labelledby="entitlement-heading">
            <h2 id="entitlement-heading" className="text-lg font-semibold tracking-tight">What this workspace may do</h2>
            <Card className="mt-3 divide-y divide-line p-0">
              <dl className="grid gap-4 p-5 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-ink-faint">Allowed by</dt>
                  <dd className="mt-1 text-sm font-medium">{SOURCE_LABEL[e.source]}{e.planKey ? ` · ${planName(e.planKey)}` : ""}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">Runs</dt>
                  <dd className="tnum mt-1 text-sm font-medium">
                    {e.runsAllowed === null ? `${e.runsUsed} started · no limit` : `${e.runsUsed} of ${e.runsAllowed} used`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">{e.source === "subscription" ? "Allowance renews" : e.source === "manual_grant" ? "Grant ends" : "Window"}</dt>
                  <dd className="mt-1 text-sm font-medium">{when(e.windowEndsAt) ?? (e.source === "trial" ? "Across your workspaces" : "—")}</dd>
                </div>
              </dl>
              <div className="p-5 text-sm">
                {e.canRun
                  ? <p className="text-ink-soft">New runs can start.</p>
                  : <p role="status" className="text-fail-text">{e.blockedReason}</p>}
                {e.trial && (
                  <p className="mt-2 text-xs text-ink-faint">
                    The trial covers {e.trial.limit} runs per account, across every workspace you own, graded on Novera&apos;s keys.
                  </p>
                )}
                <p className="mt-2 text-xs text-ink-faint">
                  Billing does not yet decide whether a run can start; the run launcher still applies the trial and model-key rules.
                  Every run, case and report stays readable and exportable whatever happens to a subscription.
                </p>
              </div>
            </Card>
          </section>

          <section aria-labelledby="subscription-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="subscription-heading" className="text-lg font-semibold tracking-tight">Subscription</h2>
              {sub && <Badge tone={STANDING[sub.standing].tone}>{STANDING[sub.standing].label}</Badge>}
            </div>
            <Card className="mt-3 p-5 text-sm">
              {sub ? (
                <>
                  <p className="font-medium">{planName(sub.planKey) ?? "Unrecognised plan"}</p>
                  <p className="mt-1 text-ink-soft">{sub.sentence}</p>
                  <ul className="mt-3 space-y-1 text-xs text-ink-faint">
                    {sub.periodEnd && <li>Current period ends {when(sub.periodEnd)}</li>}
                    {sub.endsAt && <li>Access under this plan ends {when(sub.endsAt)}</li>}
                    {sub.graceEndsAt && <li>Grace period ends {when(sub.graceEndsAt)}</li>}
                  </ul>
                </>
              ) : (
                <p className="text-ink-soft">This workspace has no subscription.</p>
              )}

              {manage ? (
                <div className="mt-4 flex flex-wrap items-start gap-3">
                  <PortalButton disabled={!view.config.active || !view.hasCustomer} />
                  {view.config.active && sub && ["active", "trialing", "cancelling", "grace"].includes(sub.standing) && (
                    <CancellationButton cancelling={sub.standing === "cancelling"} />
                  )}
                </div>
              ) : (
                <p className="mt-4 rounded-control bg-sunken px-3 py-2 text-xs text-ink-soft">The owner and admins manage billing.</p>
              )}
            </Card>
          </section>

          {manage && view.config.active && view.config.mode === "test" && (!sub || ["ended", "none"].includes(sub.standing)) && view.sellablePlans.length > 0 && (
            <section aria-labelledby="plans-heading">
              <h2 id="plans-heading" className="text-lg font-semibold tracking-tight">Sandbox plans</h2>
              <p className="mt-1 text-xs text-ink-faint">Placeholders for testing the flow. Names, allowances and prices are not decided and are not shown.</p>
              <Card className="mt-3 divide-y divide-line p-0">
                {view.sellablePlans.filter(isPlanKey).map((key) => (
                  <div key={key} className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
                    <span>{PLAN_CATALOG[key].name} · {PLAN_CATALOG[key].runsPerPeriod} runs per period</span>
                    <CheckoutButton plan={key} label="Test checkout" />
                  </div>
                ))}
              </Card>
            </section>
          )}

          <p className="text-xs leading-relaxed text-ink-faint">
            Receipts and invoices come from Stripe, by email and in the billing portal. Novera sends no billing email.
          </p>
        </div>
      </SettingsNav>
    </main>
  );
}
