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
      <TopBar />
      <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-6">{children}</div>
    </div>
  );
}
