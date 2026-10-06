import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { Card } from "@/components/ui/primitives.tsx";
import { enabledProviders } from "@/lib/auth/providers.ts";
import { OAUTH_PROVIDERS, PROVIDER_LABEL } from "@/lib/auth/redirects.ts";
import { AUDIT_LABEL, type AuditAction } from "@/lib/audit/record.ts";
import { SettingsNav } from "../nav.tsx";
import { LinkProviderForm, PasswordForm, SignOutEverywhereForm, UnlinkProviderForm } from "./forms.tsx";

export const metadata: Metadata = { title: "Sign-in and security · Novera" };
export const dynamic = "force-dynamic";

/** Codes this page owns; anything else in `?problem=` is ignored, never printed. */
const PROBLEMS: Record<string, string> = {
  identity_taken: "That account is already connected to a different Novera sign-in, so it was not linked here. Nothing changed.",
  link_failed: "Connecting that account did not complete, and nothing changed. Try again.",
};

const PERSONAL_ACTIONS: AuditAction[] = ["identity.linked", "identity.unlinked", "account.password_set", "account.password_changed", "account.signed_out_everywhere"];

/**
 * How this person signs in — never which workspace they are in. One account keeps one user
 * id whatever methods it has, so connecting GitHub to an email account changes nothing about
 * its workspaces, reports or keys.
 */
export default async function AccountSecurityPage({ searchParams }: { searchParams: Promise<{ problem?: string; linked?: string; unlinked?: string }> }) {
  const ctx = await requireContext();
  const query = await searchParams;
  const supabase = await sessionClient();
  const [{ data: ids }, providers, { data: events }, { count: members }] = await Promise.all([
    supabase.auth.getUserIdentities(),
    enabledProviders(),
    serviceClient().from("audit_events").select("action, detail, created_at")
      .eq("actor_id", ctx.user.id).is("workspace_id", null).in("action", PERSONAL_ACTIONS)
      .order("created_at", { ascending: false }).limit(8),
    serviceClient().from("workspace_members").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id),
  ]);
  const identities = ids?.identities ?? [];
  const passwordExists = identities.some((i) => i.provider === "email") || ctx.user.app_metadata?.novera_password === true;
  const linkable = OAUTH_PROVIDERS.filter((p) => providers.includes(p) && !identities.some((i) => i.provider === p));
  const problem = query.problem && Object.hasOwn(PROBLEMS, query.problem) ? PROBLEMS[query.problem] : null;
  const linked = OAUTH_PROVIDERS.find((p) => p === query.linked);
  const unlinked = OAUTH_PROVIDERS.find((p) => p === query.unlinked);
  const ways = identities.filter((i) => i.provider !== "email").length + (passwordExists ? 1 : 0);

  return (
    <main className="w-full pb-10 text-ink">
      <SettingsNav current="account" role={ctx.role} mode={ctx.accountMode} members={members ?? 1} workspace={ctx.workspace.name}>
        {problem && <p role="alert" className="mt-2 rounded-control border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">{problem}</p>}
        {unlinked && <p role="status" className="mt-2 rounded-control border border-pass-border bg-pass-surface px-3 py-2 text-sm text-pass-text">{PROVIDER_LABEL[unlinked]} is no longer connected. You can connect it again at any time.</p>}
        {linked && <p role="status" className="mt-2 rounded-control border border-pass-border bg-pass-surface px-3 py-2 text-sm text-pass-text">{PROVIDER_LABEL[linked]} is connected. You can now sign in with it too.</p>}

        <section aria-labelledby="ways-heading" className="mt-8">
          <h2 id="ways-heading" className="type-h2">Ways to sign in</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Primary email: <span className="font-medium text-ink">{ctx.user.email ?? "none"}</span>. Every method below opens this same
            account — the same workspaces, reports and keys. Nothing is merged, and a provider&rsquo;s access token is never stored or shown.
          </p>
          <Card className="mt-3 p-5">
            <ul className="divide-y divide-line">
              <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Password</p>
                  <p className="text-xs text-ink-faint">{passwordExists ? `Sign in with ${ctx.user.email} and your password.` : "Not set — you sign in with a connected account."}</p>
                </div>
              </li>
              {identities.filter((i) => i.provider !== "email").map((i) => {
                const label = PROVIDER_LABEL[i.provider as keyof typeof PROVIDER_LABEL] ?? i.provider;
                const address = typeof i.identity_data?.email === "string" ? i.identity_data.email : null;
                return (
                  <li key={i.identity_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-ink-faint">
                        {address ? `${address} · ` : ""}connected {(i.created_at ?? "").slice(0, 10)}
                        {i.last_sign_in_at ? ` · last used ${i.last_sign_in_at.slice(0, 10)}` : ""}
                      </p>
                    </div>
                    <UnlinkProviderForm identityId={i.identity_id} label={label} disabledReason={ways < 2 ? "Your only way to sign in. Add a password or connect another account first." : undefined} />
                  </li>
                );
              })}
            </ul>
            {linkable.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-4">
                {linkable.map((p) => <LinkProviderForm key={p} provider={p} />)}
              </div>
            )}
            {providers.length === 0 && (
              <p className="mt-4 border-t border-line pt-4 text-xs text-ink-faint">Google and GitHub sign-in are not switched on for this service yet.</p>
            )}
          </Card>
        </section>

        <section aria-labelledby="password-heading" className="mt-10">
          <h2 id="password-heading" className="type-h2">{passwordExists ? "Change your password" : "Add a password"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            {passwordExists
              ? "Asks for the current one first. Forgotten it? Sign out and use “Forgotten your password?” on the sign-in page."
              : "A second way in, so losing access to a connected account does not lock you out of your evidence."}
          </p>
          <Card className="mt-3 p-5"><PasswordForm existing={passwordExists} /></Card>
        </section>

        <section aria-labelledby="activity-heading" className="mt-10">
          <h2 id="activity-heading" className="type-h2">Recent changes</h2>
          <Card className="mt-3 p-5">
            {(events ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">No changes to how you sign in yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {(events ?? []).map((e, n) => {
                  const provider = (e.detail as { provider?: string } | null)?.provider;
                  return (
                    <li key={n} className="text-ink-soft">
                      <span className="tabular-nums text-ink-faint">{(e.created_at as string).slice(0, 16).replace("T", " ")} UTC</span> — You {AUDIT_LABEL[e.action as AuditAction] ?? e.action}
                      {provider ? ` (${PROVIDER_LABEL[provider as keyof typeof PROVIDER_LABEL] ?? provider})` : ""}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>

        <section aria-labelledby="danger-heading" className="mt-10">
          <h2 id="danger-heading" className="type-h2">Sessions</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">Lost a device, or signed in somewhere you should not have? This ends every session at once; API keys are not affected.</p>
          <Card className="mt-3 border-fail-border p-5"><SignOutEverywhereForm /></Card>
        </section>
      </SettingsNav>
    </main>
  );
}
