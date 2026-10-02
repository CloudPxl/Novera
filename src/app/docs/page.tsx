import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { currentUser } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card } from "@/components/ui/primitives.tsx";
import { parseDocBody, plainText } from "@/lib/docs/markdown.ts";

export const metadata: Metadata = { title: "Documentation · Novera" };
export const dynamic = "force-dynamic";

export default async function DocsIndex() {
  const signedIn = Boolean(await currentUser());
  const db = await sessionClient();
  const { data: pages } = await db
    .from("doc_pages").select("slug, title, body").eq("published", true).order("slug");

  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-6 py-10 text-ink sm:px-8">
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Documentation</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          These pages are also the only material our support replies are allowed to draw on. If
          something here is wrong or missing, a support answer about it will say so rather than
          improvise.
        </p>

        {/* Each <li> is a direct child of the <ul> and Reveal wraps its contents. The
            other way round put a <div> between them, which stops assistive technology
            reading this as a list at all. */}
        <ul className="mt-8 space-y-2">
          {(pages ?? []).map((page, i) => (
            <li key={page.slug as string}>
              <Reveal delay={Math.min(i, 8) * 40}>
                <Link href={`/docs/${page.slug}`} className="block">
                  <Card interactive className="p-4">
                    <p className="font-medium">{page.title as string}</p>
                    {/* The first paragraph, as text — a preview that starts "## What is
                        sent where" describes the syntax rather than the page. */}
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-soft">
                      {plainText(parseDocBody(page.body as string)[0])}
                    </p>
                  </Card>
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-sm text-ink-soft">
          Still stuck?{" "}
          <Link href="/support" className="font-medium underline underline-offset-2">
            Ask us
          </Link>
          .
        </p>
      </main>
    </>
  );
}
