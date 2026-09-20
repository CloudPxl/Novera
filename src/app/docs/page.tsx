import type { Metadata } from "next";
import Link from "next/link";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card } from "@/components/ui/primitives.tsx";

export const metadata: Metadata = { title: "Documentation · Novera" };
export const dynamic = "force-dynamic";

export default async function DocsIndex() {
  const db = await sessionClient();
  const { data: pages } = await db
    .from("doc_pages").select("slug, title, body").eq("published", true).order("slug");

  return (
    <main className="mx-auto w-full max-w-3xl bg-white px-6 py-10 text-slate-900 sm:px-8">
      <Link href="/" className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← Novera
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        These pages are also the only material our support replies are allowed to draw on. If
        something here is wrong or missing, a support answer about it will say so rather than
        improvise.
      </p>

      <ul className="mt-8 space-y-2">
        {(pages ?? []).map((page, i) => (
          <Reveal key={page.slug as string} delay={Math.min(i, 8) * 40}>
            <li>
              <Link href={`/docs/${page.slug}`} className="block">
                <Card interactive className="p-4">
                  <p className="font-medium">{page.title as string}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600">
                    {(page.body as string).split("\n\n")[0]}
                  </p>
                </Card>
              </Link>
            </li>
          </Reveal>
        ))}
      </ul>

      <p className="mt-10 text-sm text-slate-600">
        Still stuck?{" "}
        <Link href="/support" className="font-medium underline underline-offset-2">
          Ask us
        </Link>
        .
      </p>
    </main>
  );
}
