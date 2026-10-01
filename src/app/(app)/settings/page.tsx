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
import { CreateApiKey, RevokeApiKey } from "./api-keys.tsx";
import { CreateWebhook, WebhookActions } from "./webhooks.tsx";
import { RetentionForm } from "./retention.tsx";
import { DEFAULT_RETENTION_DAYS } from "@/lib/privacy/retention.ts";

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
  const [{ data: retention }, { data: membership }] = await Promise.all([
    admin.from("workspaces").select("raw_evidence_days").eq("id", workspace.id).maybeSingle(),
    admin.from("workspace_members").select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle(),
  ]);
  const [{ data: apiKeys }, { data: endpoints }, { data: deliveries }, { data: rawReads }] = await Promise.all([
    admin.from("api_keys")
      .select("id, name, prefix, scopes, created_at, revoked_at")
      .eq("workspace_id", workspace.id).order("created_at", { ascending: false }),
    admin.from("webhook_endpoints")
      .select("id, url, events, secret_prefix, created_at, revoked_at")
      .eq("workspace_id", workspace.id).order("created_at", { ascending: false }),
    admin.from("webhook_deliveries")
      .select("id, endpoint_id, event, status, attempts, last_status, last_error, created_at")
      .eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(20),
    // Every time a key asked for the agent's replies themselves (0050).
    admin.from("raw_evidence_reads")
      .select("id, run_id, api_key_id, via, read_at")
      .eq("workspace_id", workspace.id).order("read_at", { ascending: false }).limit(10),
  ]);
  const keyName = new Map((apiKeys ?? []).map((k) => [k.id as string, k.name as string]));

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
      <Link href="/dashboard" className="text-sm text-ink-faint underline-offset-2 hover:underline">
        ← Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-ink-soft">{workspace.name}</p>

      <Reveal className="mt-8">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center"><h2 className="text-lg font-semibold tracking-tight">Grading</h2><Help label="Grading">Which AI models grade your runs. The trial uses ours for three runs; after that, connect your own model key. It is encrypted, used only to grade your runs, and never shown again.</Help></div>
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
              className="mt-3 rounded-lg border border-fail-border bg-fail-surface p-4 text-sm leading-relaxed text-fail-text"
            >
              {entitlement.blockedReason}
            </p>
          )}

          <Card className="mt-3 p-5">
            {entitlement.ownKey ? (
              <>
                <p className="text-sm leading-relaxed text-ink-soft">
                  Runs in this workspace are graded on your own {entitlement.provider} key. There is
                  no cap on how many you run, and every report says the grading was funded by your
                  key rather than by our trial allowance.
                </p>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-faint">Grading with</dt>
                    <dd className="mt-1 font-mono text-xs leading-relaxed text-ink">
                      {/* One per line, never split: "openai/gpt-" and "oss-120b" on two lines
                          read as two models. */}
                      {models.length
                        ? models.map((m) => <span key={m} className="block whitespace-nowrap">{m}</span>)
                        : "nothing — no model recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-faint">Each verdict is</dt>
                    {/* A corroboration label over a key that cannot grade would describe
                        verdicts that can never be produced. */}
                    <dd className="mt-1 text-xs leading-relaxed text-ink">
                      {models.length ? INDEPENDENCE_LABEL[corroboration] : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-faint">Connected</dt>
                    <dd className="mt-1 text-xs leading-relaxed text-ink">{storedOn ?? "—"}</dd>
                  </div>
                </dl>

                <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                  We never fall back to our own key when yours fails. If your provider rate-limits a
                  run, those scenarios are reported as having produced no result — which is the
                  truth — rather than quietly graded on someone else&apos;s credit.
                </p>

                {models.length === 1 && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                    One model means one opinion, so every verdict is reported as not corroborated.
                    Adding a second {entitlement.provider} model below makes each verdict a finding
                    of two — still within one vendor, which the report says plainly.
                  </p>
                )}

                <p className="mt-4 text-xs text-ink-faint">
                  {entitlement.runsUsed} run{entitlement.runsUsed === 1 ? "" : "s"} so far.
                </p>

                <details className="mt-4 border-t border-line pt-4">
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    Replace this key
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                    Rotating is one step, not two: the new key is proved before it is stored, the
                    old one is deleted only once that has happened, and a key that fails its test
                    changes nothing.
                  </p>
                  <JudgeKeyForm providers={PROVIDERS} replacing />
                </details>

                <div className="mt-4 border-t border-line pt-4">
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
                <p className="text-sm leading-relaxed text-ink-soft">
                  You have used <strong>{entitlement.runsUsed}</strong> of {TRIAL_RUN_LIMIT} trial
                  runs. The trial is graded on our free-tier key, by two models from different
                  vendors.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                  Connect your own model key to lift the cap. There is nothing to pay us — the
                  grading simply runs on your key from then on, on your provider&apos;s free or paid
                  tier, and stays inside your own account.
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-sunken">
                  <div
                    className="novera-bar h-full rounded-full bg-ink"
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

          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            The key is encrypted before it is stored, with the ciphertext bound to this workspace,
            and is only ever decrypted on the server. It is never sent to the browser, never written
            to a log, and never appears in a report. The model names are not secret and are shown
            above; the key itself is never displayed again, not even in part.
          </p>
        </section>
      </Reveal>

      <Reveal className="mt-10">
        <section>
          <div className="flex items-center">
            <h2 className="text-lg font-semibold tracking-tight">API keys</h2>
            <Help label="API keys">
              A key lets a script, a CI pipeline or an AI assistant read this workspace&apos;s runs and
              reports without signing in. A key can also start runs only if you tick that when creating
              it. No key can change a policy, approve anything, or publish or revoke a report. Create one
              per place you use it, so you can revoke it on its own.
            </Help>
          </div>
          <Card className="mt-3 p-5">
            {(apiKeys ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">No keys yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {(apiKeys ?? []).map((k) => (
                  <li key={k.id as string} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-ink">{k.name as string}</span>{" "}
                      <span className="type-mono text-ink-faint">{k.prefix as string}…</span>
                      <span className="block text-xs text-ink-faint">
                        {(k.scopes as string[]).join(", ")} · created {(k.created_at as string).slice(0, 10)}
                        {k.revoked_at ? ` · revoked ${(k.revoked_at as string).slice(0, 10)}` : ""}
                      </span>
                    </div>
                    {k.revoked_at ? (
                      <Badge tone="neutral">revoked</Badge>
                    ) : (
                      <RevokeApiKey keyId={k.id as string} name={k.name as string} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <CreateApiKey />
          </Card>
          <h3 className="mt-6 text-sm font-semibold">Replies read through a key</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            Your agent&apos;s replies reach a key only when it asks for them. Every time one did, it is listed
            here — the ten most recent.
          </p>
          {(rawReads ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">No key has read your agent&apos;s replies.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {(rawReads ?? []).map((r) => (
                <li key={r.id as string} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{keyName.get(r.api_key_id as string) ?? "A key"}</span>{" "}
                    read the replies of{" "}
                    <Link href={`/runs/${r.run_id as string}`} className="underline underline-offset-2 hover:text-ink">
                      run {(r.run_id as string).slice(0, 8)}
                    </Link>{" "}
                    <span className="text-ink-faint">through {r.via === "mcp" ? "MCP" : "the API"}</span>
                  </span>
                  <time dateTime={r.read_at as string} className="type-mono text-xs text-ink-faint">
                    {(r.read_at as string).slice(0, 16).replace("T", " ")} UTC
                  </time>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            A key is shown once. Novera keeps only a keyed fingerprint of it, so a copy of our database
            cannot be used to call the API, and a lost key cannot be recovered — revoke it and create
            another. Each key may make 120 requests a minute.{" "}
            <Link href="/docs/api" className="underline underline-offset-2 hover:text-ink">How to use the API</Link>
          </p>
        </section>
      </Reveal>

      <Reveal className="mt-10">
        <section>
          <div className="flex items-center">
            <h2 className="text-lg font-semibold tracking-tight">Webhooks</h2>
            <Help label="Webhooks">
              Novera tells another system when a run finishes, is stopped, or a schedule pauses — your CI,
              a chat channel, a ticket queue — so nobody has to keep checking. Each delivery is signed, and
              carries counts, the outcome and links, never your agent&apos;s replies or your policy.
            </Help>
          </div>
          <Card className="mt-3 p-5">
            {(endpoints ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">No endpoints yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {(endpoints ?? []).map((e) => {
                  const recent = (deliveries ?? []).filter((d) => d.endpoint_id === e.id).slice(0, 3);
                  return (
                    <li key={e.id as string} className="py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="break-all font-medium text-ink">{e.url as string}</span>
                          <span className="block text-xs text-ink-faint">
                            {(e.events as string[]).join(", ")} · secret {e.secret_prefix as string}… · added {(e.created_at as string).slice(0, 10)}
                            {e.revoked_at ? ` · revoked ${(e.revoked_at as string).slice(0, 10)}` : ""}
                          </span>
                        </div>
                        {e.revoked_at ? <Badge tone="neutral">revoked</Badge> : <WebhookActions endpointId={e.id as string} url={e.url as string} />}
                      </div>
                      {recent.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
                          {recent.map((d) => (
                            <li key={d.id as string}>
                              {(d.created_at as string).slice(0, 16).replace("T", " ")} UTC · {d.event as string} ·{" "}
                              {d.status === "delivered"
                                ? `delivered (${d.last_status})`
                                : d.status === "failed"
                                  ? `gave up after ${d.attempts} attempts: ${d.last_error ?? ""}`
                                  : `waiting to retry after ${d.attempts} attempt(s)${d.last_error ? `: ${d.last_error}` : ""}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <CreateWebhook />
          </Card>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Every delivery carries a <span className="type-mono">Novera-Signature</span> header: an HMAC of the
            timestamp and body under the endpoint&apos;s secret. A failed delivery is retried for about nine
            hours, then given up and shown here.{" "}
            <Link href="/docs/api" className="underline underline-offset-2 hover:text-ink">How to check a signature</Link>
          </p>
        </section>
      </Reveal>

      <Reveal className="mt-10">
        <section>
          <div className="flex items-center">
            <h2 className="text-lg font-semibold tracking-tight">Evidence retention</h2>
            <Help label="Evidence retention">
              How long Novera keeps what your agent actually said in each run: its replies, whole
              conversations and tool activity. That text is where personal data ends up if your agent
              leaks it. After the period it is removed; the verdict, the reasons, a fingerprint of the
              reply and every report are kept until you erase the workspace.
            </Help>
          </div>
          <Card className="mt-3 p-5">
            <RetentionForm
              current={(retention?.raw_evidence_days as number | undefined) ?? DEFAULT_RETENTION_DAYS}
              isOwner={membership?.role === "owner"}
            />
          </Card>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Removed replies cannot be diagnosed; retest the scenario for a fresh one. Sealed reports never
            contained replies, so none changes.{" "}
            <Link href="/docs/data-and-privacy" className="underline underline-offset-2 hover:text-ink">Data and privacy</Link>
          </p>
        </section>
      </Reveal>
    </main>
  );
}
