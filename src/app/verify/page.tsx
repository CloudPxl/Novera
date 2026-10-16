import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { ExplainTrigger } from "@/components/ui/explain-trigger.tsx";
import { pageMetadata } from "@/lib/seo/site.ts";
import { verifyFromFile } from "@/lib/report/seal.ts";
import { REPORT_NOTICE_SHORT } from "@/lib/legal/notices.ts";
import { normaliseDigest } from "@/lib/report/public-verify.ts";
import { DigestForm } from "./digest-form.tsx";
import { FileCheck } from "./file-check.tsx";
import { ExplainProvider } from "@/components/ui/explain-context.tsx";
import { CLIENT_EXPLAINS, explainEntries } from "@/lib/explainability/entries.ts";
import { hasSessionCookie } from "./session-cookie.ts";

export const metadata: Metadata = pageMetadata({
  title: "Verify a report seal",
  description:
    "Check whether Novera sealed a report with a given SHA-256 digest, and whether the stored report still hashes to it. No sign-in, and nothing from the report itself is shown.",
  path: "/verify",
});

// Per request, like every page: the CSP nonce comes from the request (src/proxy.ts).
export const dynamic = "force-dynamic";

/**
 * The public landing for seal checks. The form submits here with GET so it works with no
 * JavaScript; a submitted value is redirected to `/verify/<hash>`, which says whether it is a
 * digest at all. The value is never printed on this page.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).hash;
  const submitted = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (submitted) {
    const digest = normaliseDigest(submitted);
    // A malformed value still goes to the receipt page, which says calmly that it is not a
    // digest. Capped, so the address stays short.
    redirect(`/verify/${encodeURIComponent(digest ?? submitted.slice(0, 128))}`);
  }

  return (
    <>
      <SiteHeader signedIn={await hasSessionCookie()} />
      <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-4 py-10 text-ink sm:px-8">
        <p className="type-eyebrow text-ink-faint">Seal check</p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Verify a report seal</h1>
        <p className="mt-4 measure text-base leading-relaxed text-ink-soft">
          Every Novera report is sealed with a SHA-256 digest computed over its content, written
          with object keys sorted, no whitespace and array order kept. Any edit to a figure,
          finding or date in the document changes the digest.
        </p>

        <section aria-labelledby="check-heading" className="mt-8 rounded-control border border-line bg-ground/60 p-5">
          <div className="flex flex-wrap items-baseline">
            <h2 id="check-heading" className="text-lg font-semibold">Check a digest</h2>
            <ExplainTrigger id="sha256_seal" />
          </div>
          <div className="mt-3">
            <DigestForm />
          </div>
        </section>

        <section aria-labelledby="file-heading" className="mt-6 rounded-control border border-line bg-ground/60 p-5">
          <h2 id="file-heading" className="text-lg font-semibold">Check a downloaded report</h2>
          <p className="mt-1 measure text-sm leading-relaxed text-ink-soft">
            A digest says what Novera sealed. This says whether the file in your hands is that
            document: your browser hashes the report content exactly as the seal was computed, then
            compares it with the digest the file states and with Novera&apos;s ledger.
          </p>
          <div className="mt-4">
            <ExplainProvider entries={explainEntries([...CLIENT_EXPLAINS.fileCheck, ...CLIENT_EXPLAINS.receiptDetails])}>
              <FileCheck />
            </ExplainProvider>
          </div>
        </section>

        <section aria-labelledby="what-heading" className="mt-10">
          <h2 id="what-heading" className="text-lg font-semibold">What the check tells you</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>
              Whether Novera sealed a report with this digest, and whether the report it stores still
              hashes to it.
            </li>
            <li>
              When it was sealed, the suite and run date, who funded the grading, and the counts and
              grade exactly as the report states them; or, if the report was withdrawn, only that and when.
            </li>
            <li>
              Nothing else. The client, the agent, the findings and the evidence stay with whoever
              holds the report&apos;s link.
            </li>
          </ul>
        </section>

        <section aria-labelledby="copy-heading" className="mt-10">
          <h2 id="copy-heading" className="text-lg font-semibold">Checking the copy you hold</h2>
          <p className="mt-3 measure text-sm leading-relaxed text-ink-soft">
            A digest match says Novera sealed a report with that digest. To show that the document in
            your hands is that report, check its JSON export above, or hash it yourself: with Node
            installed, this prints the digest, which should equal the one on the report. The seal
            covers the export&apos;s <code className="font-mono">payload</code> only; its link, stated
            digest and notice sit outside it.
          </p>
          {/* Focusable: a region that scrolls sideways must be reachable from the keyboard. */}
          <pre tabIndex={0} aria-label="Command that prints the digest of report.json" className="mt-3 overflow-x-auto rounded-control border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-ink">
            <code>{verifyFromFile("report.json")}</code>
          </pre>
          <p className="mt-3 text-sm">
            <Link href="/docs/evidence-integrity" className="font-medium underline underline-offset-2">
              Why the report can be trusted
            </Link>
          </p>
        </section>

        <p className="mt-10 border-t border-line pt-5 text-sm leading-relaxed text-ink-soft">{REPORT_NOTICE_SHORT}</p>
      </main>
    </>
  );
}
