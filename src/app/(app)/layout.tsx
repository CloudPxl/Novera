import type { ReactNode } from "react";
import { TopBar } from "@/components/shell/top-bar.tsx";

/**
 * The operator shell.
 *
 * Only the signed-in surfaces sit inside it. The landing page, the docs, the
 * support form and — most importantly — the public report stay outside: a client
 * opening a report link is not an operator, and must not be shown a workspace
 * switcher, a run button or anyone's email address.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-ground">
      {/*
        The first stop for a keyboard user, on every operator page.

        The top bar holds eight or nine focusable things — nav, the agent list, import,
        the run launcher, the account menu — and every one of them had to be tabbed
        through to reach the page itself. Once per page is an annoyance; on the run
        matrix, where the work is, it is the difference between the keyboard being
        usable and not.

        Visible only when focused, which is the point: it costs a sighted mouse user
        nothing and is the first thing a keyboard user finds.
      */}
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-ink px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-3"
      >
        Skip to the page
      </a>
      <TopBar />
      <div id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-6">
        {children}
      </div>
    </div>
  );
}
