import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const db = await sessionClient();
  const { data } = await db.from("doc_pages").select("title").eq("slug", slug).eq("published", true).maybeSingle();
  return { title: data ? `${data.title} · Novera` : "Novera" };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await sessionClient();
  const { data: page } = await db
    .from("doc_pages").select("title, body, updated_at").eq("slug", slug).eq("published", true).maybeSingle();

  if (!page) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl bg-white px-6 py-10 text-slate-900 sm:px-8">
      <Link href="/docs" className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← Documentation
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{page.title as string}</h1>
      <p className="mt-1 font-mono text-xs text-slate-400">{slug}</p>

      <div className="mt-6 space-y-4">
        {(page.body as string).split(/\n\n+/).map((paragraph, i) => (
          <p key={i} className="text-[15px] leading-relaxed text-slate-700">
            {paragraph}
          </p>
        ))}
      </div>

      <p className="mt-10 border-t border-slate-200 pt-4 text-sm text-slate-600">
        Something missing?{" "}
        <Link href="/support" className="font-medium underline underline-offset-2">
          Ask us
        </Link>
        .
      </p>
    </main>
  );
}
