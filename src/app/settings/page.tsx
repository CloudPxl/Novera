import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge } from "@/components/ui/primitives.tsx";
import { JudgeKeyForm, RemoveKeyButton } from "./client.tsx";

export const metadata: Metadata = { title: "Settings · Novera" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, workspace } = await requireWorkspace();
  const admin = await assertMembership(user.id, workspace.id);
  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });

  return (
    <main className="mx-auto w-full max-w-3xl bg-white px-6 py-10 text-slate-900 sm:px-8">
      <Link href="/dashboard" className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-slate-600">{workspace.name}</p>

      <Reveal className="mt-8">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Grading</h2>
            <Badge tone={entitlement.ownKey ? "pass" : "neutral"}>
              {entitlement.ownKey ? `your ${entitlement.provider} key` : "trial allowance"}
            </Badge>
          </div>

          <Card className="mt-3 p-5">
            {entitlement.ownKey ? (
              <>
                <p className="text-sm leading-relaxed text-slate-700">
                  Runs in this workspace are graded on your own {entitlement.provider} key. There is
                  no cap on how many you run, and every report says the grading was funded by your
                  key rather than by our trial allowance.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  We never fall back to our own key when yours fails. If your provider rate-limits a
                  run, those scenarios are reported as having produced no result — which is the
                  truth — rather than quietly graded on someone else&apos;s credit.
                </p>
                <p className="mt-4 text-xs text-slate-500">
                  {entitlement.runsUsed} run{entitlement.runsUsed === 1 ? "" : "s"} so far.
                </p>
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <RemoveKeyButton />
                </div>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-slate-700">
                  You have used <strong>{entitlement.runsUsed}</strong> of {TRIAL_RUN_LIMIT} trial
                  runs. The trial is graded on our free-tier key.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  Connect your own model key to lift the cap. There is nothing to pay us — the
                  grading simply runs on your key from then on, on your provider&apos;s free or paid
                  tier, and stays inside your own account.
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="novera-bar h-full rounded-full bg-slate-900"
                    style={{ width: `${Math.min(100, (entitlement.runsUsed / TRIAL_RUN_LIMIT) * 100)}%` }}
                    role="progressbar"
                    aria-valuenow={entitlement.runsUsed}
                    aria-valuemin={0}
                    aria-valuemax={TRIAL_RUN_LIMIT}
                    aria-label="Trial runs used"
                  />
                </div>
                <JudgeKeyForm />
              </>
            )}
          </Card>

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            The key is encrypted before it is stored, with the ciphertext bound to this workspace,
            and is only ever decrypted on the server. It is never sent to the browser, never written
            to a log, and never appears in a report.
          </p>
        </section>
      </Reveal>
    </main>
  );
}
