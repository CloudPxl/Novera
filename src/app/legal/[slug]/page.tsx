import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_DOCUMENTS, legalDocument } from "../../../../data/legal/index.ts";
import { sourceById } from "../../../../data/legal/sources.ts";
import { parseLegalBody } from "@/lib/legal/document.ts";
import { Contents, DraftBanner, LegalBody, SourcesConsulted } from "../legal-body.tsx";

// Every page under the nonce CSP in src/proxy.ts is rendered per request.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/legal/[slug]">): Promise<Metadata> {
  const doc = legalDocument((await params).slug);
  return { title: doc ? `${doc.title} (draft) · Novera` : "Novera" };
}

export default async function LegalPage({ params }: PageProps<"/legal/[slug]">) {
  const doc = legalDocument((await params).slug);
  if (!doc) notFound();

  const blocks = parseLegalBody(doc.body);
  const related = LEGAL_DOCUMENTS.filter((d) => d.slug !== doc.slug);

  return (
    <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-4 py-10 text-ink sm:px-8">
      <Link href="/legal" className="text-sm text-ink-faint underline-offset-2 hover:text-ink hover:underline">← Legal documents</Link>
      <h1 className="mt-4 type-h1">{doc.title}</h1>
      <div className="mt-4">
        <DraftBanner lastReviewed={doc.lastReviewed} version={doc.version} />
      </div>
      <Contents blocks={blocks} />
      <LegalBody blocks={blocks} />
      <SourcesConsulted sources={doc.sources.map(sourceById)} />
      <nav aria-label="Other legal documents" className="mt-12 border-t border-line pt-6">
        <p className="text-sm font-semibold">Other legal documents</p>
        <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
          {related.map((d) => (
            <li key={d.slug}>
              <Link href={`/legal/${d.slug}`} className="text-ink-soft underline underline-offset-2 hover:text-ink">{d.title}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
