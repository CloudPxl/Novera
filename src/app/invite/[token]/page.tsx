import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { currentUser } from "@/lib/auth/session.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { ROLE_DESCRIPTION, ROLE_LABEL, isRole } from "@/lib/auth/permissions.ts";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { AcceptInvitationForm, HoldInvitationForm } from "./forms.tsx";

/** Read outside render: whether an invitation has not yet expired. */
function stillOpen(expiresAt: string): boolean {
  return Date.parse(expiresAt) > Date.now();
}

export const metadata: Metadata = { title: "Invitation · Novera", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * An invitation link. The token is the secret: whoever holds it learns the workspace's name and
 * the role offered, nothing more, and only the account with the invited address can accept it
 * (checked in the database, 0054). Outside the operator shell, so opening it never creates a
 * workspace for someone who has not decided anything yet.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: inv } = await serviceClient().from("workspace_invitations")
    .select("email, role, expires_at, accepted_at, revoked_at, workspaces(name)").eq("token_hash", hash).maybeSingle();
  const user = await currentUser();
  const state = !inv ? "invalid" : inv.revoked_at ? "revoked" : inv.accepted_at ? "used" : !stillOpen(inv.expires_at as string) ? "expired" : "open";
  const ws = (inv?.workspaces as unknown as { name: string } | null)?.name ?? "a workspace";
  const role = isRole(inv?.role) ? inv.role : null;

  return (
    <>
      <SiteHeader signedIn={Boolean(user)} />
      <main id="main" className="mx-auto w-full max-w-xl px-6 py-14 text-ink">
        <p className="type-eyebrow text-ink-faint">Invitation</p>
        {state === "open" && role ? (
          <>
            <h1 className="mt-2 type-h1">Join {ws} on Novera</h1>
            <p className="mt-3 type-body text-ink-soft">
              You are invited as <span className="font-medium text-ink">{ROLE_LABEL[role].toLowerCase()}</span>. {ROLE_DESCRIPTION[role]}
            </p>
            <p className="mt-2 text-sm text-ink-faint">For {inv!.email as string} · expires {(inv!.expires_at as string).slice(0, 10)}</p>
            <div className="mt-8">
              {user ? (
                (user.email ?? "").toLowerCase() === inv!.email ? (
                  <AcceptInvitationForm token={token} />
                ) : (
                  <p role="alert" className="rounded-panel border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-text">
                    You are signed in as {user.email}. This invitation is for {inv!.email as string} — sign out and sign in with that address to accept it.
                  </p>
                )
              ) : (
                <HoldInvitationForm token={token} />
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-2 type-h1">
              {state === "expired" ? "This invitation has expired" : state === "revoked" ? "This invitation was revoked" : state === "used" ? "This invitation was already used" : "This invitation link is not valid"}
            </h1>
            <p className="mt-3 type-body text-ink-soft">Ask whoever invited you for a new one. Invitations work once, for one address, for seven days.</p>
            <div className="mt-6"><ButtonLink href={user ? "/dashboard" : "/"} variant="secondary">{user ? "Open your dashboard" : "Go to the home page"}</ButtonLink></div>
          </>
        )}
      </main>
    </>
  );
}
