import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { ExplainTrigger } from "@/components/ui/explain-trigger.tsx";
import { JsonLd } from "@/components/seo/json-ld.tsx";
import { REPORT_NOTICE_SHORT, REPORT_NOTICE_TITLE } from "@/lib/legal/notices.ts";
import {
  normaliseDigest,
  receiptJsonLd,
  type ReceiptDetails,
  type SealReceipt,
} from "@/lib/report/public-verify.ts";
import { lookupSeal } from "../lookup.ts";
import { DigestForm } from "../digest-form.tsx";
import { CHIP, ReceiptDetailsList } from "../receipt-details.tsx";
import { ExplainProvider } from "@/components/ui/explain-context.tsx";
import { CLIENT_EXPLAINS, explainEntries } from "@/lib/explainability/entries.ts";
import { hasSessionCookie } from "../session-cookie.ts";

export const metadata: Metadata = {
  title: "Seal receipt",
  description: "Whether Novera sealed a report with this SHA-256 digest.",
  // One customer's receipt is never indexed or listed, and its links are not followed.
  robots: { index: false, follow: false },
};

// Per request: the CSP nonce comes from the request (src/proxy.ts), and so does the answer.
export const dynamic = "force-dynamic";

export default async function SealReceiptPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const digest = normaliseDigest(hash);
  // One address per digest: an uppercase or padded paste lands on the lowercase form.
  if (digest && digest !== hash) redirect(`/verify/${digest}`);

  const result = digest ? await lookupSeal(digest) : null;

  return (
    <>
      <SiteHeader signedIn={await hasSessionCookie()} />
      {digest && <JsonLd data={receiptJsonLd(digest)} />}
      <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-4 py-10 text-ink sm:px-8">
        <p className="type-eyebrow text-ink-faint">
          <Link href="/verify" className="rounded-control hover:text-ink">Seal check</Link>
        </p>
        <Outcome digest={digest} result={result} />

        <p className="mt-10 border-t border-line pt-5 text-sm leading-relaxed text-ink-soft">
          <strong className="font-semibold text-ink">{REPORT_NOTICE_TITLE}:</strong>{" "}
          {REPORT_NOTICE_SHORT.slice(REPORT_NOTICE_SHORT.indexOf(": ") + 2)}
        </p>
      </main>
    </>
  );
}

function Outcome({ digest, result }: { digest: string | null; result: SealReceipt | "unavailable" | null }) {
  if (!digest || result === null) return <Malformed />;
  if (result === "unavailable") return <Unavailable digest={digest} />;
  switch (result.state) {
    case "unknown": return <Unknown digest={digest} />;
    case "withdrawn": return <Withdrawn digest={digest} at={result.withdrawnAt} />;
    case "mismatch": return <Mismatch digest={digest} sealedAt={result.sealedAt} />;
    case "verified": return <Verified digest={digest} details={result.details} />;
  }
}

function Heading({ title, chip, tone, withdrawn = false }: { title: string; chip: string; tone: keyof typeof CHIP; withdrawn?: boolean }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <span className={`inline-flex w-fit items-center rounded-control border px-2.5 py-1 text-sm font-semibold ${CHIP[tone]}`}>{chip}</span>
      {withdrawn && <ExplainTrigger id="withdrawn_report" />}
    </div>
  );
}

function Digest({ value }: { value: string }) {
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline">
        <p className="text-sm font-medium text-ink-faint">SHA-256</p>
        <ExplainTrigger id="sha256_seal" />
      </div>
      <p className="mt-1 font-mono text-sm break-all text-ink">{value}</p>
    </div>
  );
}

function Again() {
  return (
    <section aria-labelledby="again-heading" className="mt-10 rounded-control border border-line bg-ground/60 p-5">
      <h2 id="again-heading" className="text-lg font-semibold">Check another digest</h2>
      <div className="mt-3">
        <DigestForm />
      </div>
    </section>
  );
}

function Malformed() {
  return (
    <>
      <Heading title="That isn't a SHA-256 digest" chip="Not checked" tone="neutral" />
      <p className="mt-4 measure text-base leading-relaxed text-ink-soft">
        A Novera seal is 64 characters, each a digit or a letter from a to f. Copy it from the
        report, beside its seal, and paste it whole.
      </p>
      <Again />
    </>
  );
}

function Unavailable({ digest }: { digest: string }) {
  return (
    <>
      <Heading title="The check could not be completed" chip="Not checked" tone="neutral" />
      <Digest value={digest} />
      <p className="mt-4 measure text-base leading-relaxed text-ink-soft">
        Novera&apos;s records could not be read just now, so nothing is concluded about this digest.
        Try again in a minute.
      </p>
      <p className="mt-6 text-sm">
        <Link href={`/verify/${digest}`} className="font-medium underline underline-offset-2">Check again</Link>
      </p>
    </>
  );
}

function Unknown({ digest }: { digest: string }) {
  return (
    <>
      <Heading title="Unverified digest" chip="No match" tone="warning" />
      <Digest value={digest} />
      <p className="mt-4 measure text-base leading-relaxed text-ink">
        Unverified digest: no report sealed by Novera has this SHA-256.
      </p>
      <p className="mt-3 measure text-sm leading-relaxed text-ink-soft">
        Novera seals a report at the end of a run, when every scenario in the suite has a recorded
        result, and stores it with the digest printed on it. A digest that matches no stored report
        was mistyped, or does not come from a Novera report. A report deleted with its
        workspace is no longer stored either.
      </p>
      <p className="mt-6 text-sm">
        <Link href="/verify" className="font-medium underline underline-offset-2">Check another digest</Link>
      </p>
    </>
  );
}

function Withdrawn({ digest, at }: { digest: string; at: string | null }) {
  return (
    <>
      <Heading title="Withdrawn report" chip="Withdrawn" tone="neutral" withdrawn />
      <Digest value={digest} />
      <p className="mt-4 measure text-base leading-relaxed text-ink">
        {at ? `This report was withdrawn on ${at}.` : "This report was withdrawn."}
      </p>
      <p className="mt-3 measure text-sm leading-relaxed text-ink-soft">
        A withdrawn report stays withdrawn. Nothing more about it is shown here.
      </p>
    </>
  );
}

function Mismatch({ digest, sealedAt }: { digest: string; sealedAt: string | null }) {
  return (
    <>
      <Heading title="Does not match" chip="Does not match" tone="fail" />
      <Digest value={digest} />
      <p className="mt-4 measure text-base leading-relaxed text-ink">
        A report was stored under this digest{sealedAt ? <> on {sealedAt}</> : null}, but its
        content no longer hashes to it. Its details are not shown, because they are not what was sealed.
      </p>
    </>
  );
}

function Verified({ digest, details }: { digest: string; details: ReceiptDetails }) {
  return (
    <>
      <Heading title="Sealed by Novera" chip="Verified" tone="pass" />
      <Digest value={digest} />
      <p className="mt-4 measure text-base leading-relaxed text-ink">
        Verified: the stored report still hashes to this digest.
      </p>
      <p className="mt-2 measure text-sm leading-relaxed text-ink-soft">
        This confirms what Novera stores. To confirm the copy you were sent is the same document,
        check its JSON export on the <Link href="/verify" className="underline underline-offset-2">seal check page</Link>,
        in your browser or with one command.
      </p>
      {details.testData && (
        <div className="mt-4 flex flex-wrap items-center">
          <p className="inline-flex items-center rounded-control border-2 border-dashed border-warning-text bg-warning-surface px-3 py-1 text-sm font-bold uppercase tracking-wide text-warning-text">
            Test data · Novera&apos;s scripted fixture, not a real agent
          </p>
          <ExplainTrigger id="test_data" />
        </div>
      )}

      <ExplainProvider entries={explainEntries(CLIENT_EXPLAINS.receiptDetails)}>
        <ReceiptDetailsList details={details} />
      </ExplainProvider>
    </>
  );
}
