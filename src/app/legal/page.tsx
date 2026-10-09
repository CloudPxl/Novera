import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_DOCUMENTS } from "../../../data/legal/index.ts";
import { DraftBanner } from "./legal-body.tsx";

export const metadata: Metadata = { title: "Legal · Novera" };
// Every page under the nonce CSP in src/proxy.ts is rendered per request.
export const dynamic = "force-dynamic";

const latest = LEGAL_DOCUMENTS.map((d) => d.lastReviewed).sort().at(-1) ?? "";

export default function LegalIndex() {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-4 py-10 text-ink sm:px-8">
      <p className="type-eyebrow text-ink-faint">Legal</p>
      <h1 className="mt-1.5 type-h1">Legal documents</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        The terms and notices that will govern Novera. Each is a draft written from what the product does today, for review by
        counsel. None is in force yet.
      </p>
      <div className="mt-6">
        <DraftBanner lastReviewed={latest} />
      </div>
      <ul className="mt-8 divide-y divide-line overflow-hidden rounded-shell border border-line">
        {LEGAL_DOCUMENTS.map((doc) => (
          <li key={doc.slug}>
            <Link href={`/legal/${doc.slug}`} className="block px-5 py-4 transition-colors hover:bg-ground">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{doc.title}</span>
                <span className="text-xs font-medium text-warning-text">Draft · {doc.version}</span>
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-ink-soft">{doc.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
