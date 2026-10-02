import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { Assistant } from "@/components/shell/assistant.tsx";
import { TopBar } from "@/components/shell/top-bar.tsx";
import { requireContext, INVITE_COOKIE } from "@/lib/auth/session.ts";

/**
 * The operator shell.
 *
 * Only the signed-in surfaces sit inside it. The landing page, the docs, the support form, an
 * invitation link and — most importantly — the public report stay outside: a client opening a
 * report link is not an operator, and must not be shown a workspace switcher, a run button or
 * anyone's email address.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  // An invitation opened before signing in, offered back here (src/lib/workflow/identity.ts).
  const pendingInvite = (await cookies()).get(INVITE_COOKIE)?.value;

  return (
    <div
      data-motion={ctx.profile.reduced_motion === "reduce" ? "reduce" : undefined}
      className="flex min-h-full flex-1 flex-col bg-ground text-ink"
    >
      {/*
        The first stop for a keyboard user, on every operator page.

        The top bar holds eight or nine focusable things — nav, the agent list, import,
        the run launcher, the account menu — and every one of them had to be tabbed
        through to reach the page itself. Visible only when focused.
      */}
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-ink px-4 py-2 text-sm font-medium text-on-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-3"
      >
        Skip to the page
      </a>
      <TopBar />
      {pendingInvite && (
        <div role="status" className="border-b border-info-border bg-info-surface">
          <p className="mx-auto w-full max-w-[80rem] px-4 py-2.5 text-sm text-info-text sm:px-6">
            You have an invitation to a workspace waiting.{" "}
            <Link href={`/invite/${encodeURIComponent(pendingInvite)}`} className="font-medium underline underline-offset-2">Open it</Link>
          </p>
        </div>
      )}
      <div id="main" className="mx-auto w-full max-w-[80rem] flex-1 px-4 pb-20 sm:px-6">
        {children}
      </div>
      <Assistant />
    </div>
  );
}
