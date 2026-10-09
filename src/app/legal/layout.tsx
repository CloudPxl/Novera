import type { Metadata } from "next";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { currentUser } from "@/lib/auth/session.ts";

/**
 * Every legal page is a draft for counsel, so none may be indexed: a search result
 * would present an unreviewed text as Novera's terms. Remove `robots` only when a
 * document has been signed off, and per page rather than here.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function LegalLayout({ children }: LayoutProps<"/legal">) {
  const signedIn = Boolean(await currentUser());
  return (
    <>
      <SiteHeader signedIn={signedIn} />
      {children}
    </>
  );
}
