import { Help } from "@/components/ui/help.tsx";
import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { suggestedModelsFor } from "@/lib/router/routes.ts";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/providers/anthropic.ts";
import { INDEPENDENCE_LABEL } from "@/lib/judge/independence.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge } from "@/components/ui/primitives.tsx";
import { JudgeKeyForm, RemoveKeyButton, type ProviderChoice } from "./client.tsx";

export const metadata: Metadata = { title: "Settings · Novera" };
export const dynamic = "force-dynamic";

/**
 * The providers a workspace key may belong to, each with the models we ourselves call
 * on it. The suggestions are read from the live route table rather than written down
 * again here: a second copy of a list of model ids is a route table nothing measures,
 * and this page held one until it started telling customers their working key was
 * broken because a suggested model id had been retired.
 */
const PROVIDERS: ProviderChoice[] = [
  { id: "groq", label: "Groq", suggested: suggestedModelsFor("groq") },
  { id: "google", label: "Google AI Studio", suggested: suggestedModelsFor("google") },
  { id: "openrouter", label: "OpenRouter", suggested: suggestedModelsFor("openrouter") },
  { id: "anthropic", label: "Anthropic", suggested: [DEFAULT_ANTHROPIC_MODEL] },
];

export default async function SettingsPage() {
  const { user, workspace } = await requireWorkspace();
  const admin = await assertMembership(user.id, workspace.id);
  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });

  const models = entitlement.judgeModels;
  const corroboration = models.length > 1 ? "single-vendor" : "single-model";
  const storedOn = entitlement.keyStoredAt
    ? new Date(entitlement.keyStoredAt).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  const trialLeft = TRIAL_RUN_LIMIT - entitlement.runsUsed;

  return (
    <main className="w-full max-w-3xl py-8 text-ink">
      <Link href="/dashboard" className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-slate-600">{workspace.name}</p>

      <Reveal className="mt-8">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Grading<Help label="Grading">Which AI models grade your runs. The trial uses ours for three runs; after that, connect your own model key. It is encrypted, used only to grade your runs, and never shown again.</Help></h2>
            <Badge tone={entitlement.ownKey ? (entitlement.canRun ? "pass" : "fail") : "neutral"}>
              {entitlement.ownKey ? `your ${entitlement.provider} key` : "trial allowance"}
            </Badge>
          </div>

          {/* A key that cannot be routed is worse than none: the workspace is unmetered,
              so nothing stops a run starting, and every case in it would error. Said
              here, before the run, in the place where it can be fixed. */}
          {entitlement.ownKey && !entitlement.canRun && entitlement.blockedReason && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-900"
            >
              {entitlement.blockedReason}
            </p>
          )}

          <Card className="mt-3 p-5">
            {entitlement.ownKey ? (
              <>
                <p className="text-sm leading-relaxed text-slate-700">
                  Runs in this workspace are graded on your own {entitlement.provider} key. There is
                  no cap on how many you run, and every report says the grading was funded by your
                  key rather than by our trial allowance.
                </p>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Grading with</dt>
                    <dd className="mt-1 font-mono text-xs leading-relaxed text-ink">
                      {models.length ? models.join(", ") : "nothing — no model recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Each verdict is</dt>
                    {/* A corroboration label over a key that cannot grade would describe
                        verdicts that can never be produced. */}
                    <dd className="mt-1 text-xs leading-relaxed text-ink">
                      {models.length ? INDEPENDENCE_LABEL[corroboration] : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Connected</dt>
                    <dd className="mt-1 text-xs leading-relaxed text-ink">{storedOn ?? "—"}</dd>
                  </div>
                </dl>

                <p className="mt-4 text-sm leading-relaxed text-slate-600">
                  We never fall back to our own key when yours fails. If your provider rate-limits a
                  run, those scenarios are reported as having produced no result — which is the
                  truth — rather than quietly graded on someone else&apos;s credit.
                </p>

                {models.length === 1 && (
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">
                    One model means one opinion, so every verdict is reported as not corroborated.
                    Adding a second {entitlement.provider} model below makes each verdict a finding
                    of two — still within one vendor, which the report says plainly.
                  </p>
                )}

                <p className="mt-4 text-xs text-slate-500">
                  {entitlement.runsUsed} run{entitlement.runsUsed === 1 ? "" : "s"} so far.
                </p>

                <details className="mt-4 border-t border-slate-200 pt-4">
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    Replace this key
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    Rotating is one step, not two: the new key is proved before it is stored, the
                    old one is deleted only once that has happened, and a key that fails its test
                    changes nothing.
                  </p>
                  <JudgeKeyForm providers={PROVIDERS} replacing />
                </details>

                <div className="mt-4 border-t border-slate-200 pt-4">
                  <RemoveKeyButton
                    consequence={
                      trialLeft > 0
                        ? `Runs would go back to the trial allowance, which has ${trialLeft} of ${TRIAL_RUN_LIMIT} left.`
                        : `This workspace has run ${entitlement.runsUsed} suites and the trial covers ${TRIAL_RUN_LIMIT}, so no further run could start until a key is connected.`
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-slate-700">
                  You have used <strong>{entitlement.runsUsed}</strong> of {TRIAL_RUN_LIMIT} trial
                  runs. The trial is graded on our free-tier key, by two models from different
                  vendors.
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
                <JudgeKeyForm providers={PROVIDERS} />
              </>
            )}
          </Card>

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            The key is encrypted before it is stored, with the ciphertext bound to this workspace,
            and is only ever decrypted on the server. It is never sent to the browser, never written
            to a log, and never appears in a report. The model names are not secret and are shown
            above; the key itself is never displayed again, not even in part.
          </p>
        </section>
      </Reveal>
    </main>
  );
}
