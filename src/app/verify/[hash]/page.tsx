import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { JsonLd } from "@/components/seo/json-ld.tsx";
import { serviceClient } from "@/lib/supabase/service.ts";
import { REPORT_NOTICE_SHORT, REPORT_NOTICE_TITLE } from "@/lib/legal/notices.ts";
import {
  buildReceipt,
  normaliseDigest,
  receiptJsonLd,
  SEAL_COLUMNS,
  type ReceiptDetails,
  type SealReceipt,
  type SealRow,
} from "@/lib/report/public-verify.ts";
import { DigestForm } from "../digest-form.tsx";
import { hasSessionCookie } from "../session-cookie.ts";

export const metadata: Metadata = {
  title: "Seal receipt",
  description: "Whether Novera sealed a report with this SHA-256 digest.",
  // One customer's receipt is never indexed or listed, and its links are not followed.
  robots: { index: false, follow: false },
};

// Per request: the CSP nonce comes from the request (src/proxy.ts), and so does the answer.
export const dynamic = "force-dynamic";

/**
 * One database read, by digest, for the four columns the receipt needs. A failed read is
 * reported as a failed check, never as "no report has this digest": that would be a claim.
 */
async function lookup(digest: string): Promise<SealReceipt | "unavailable"> {
  try {
    const { data, error } = await serviceClient()
      .from("reports")
      .select(SEAL_COLUMNS)
      .eq("content_hash", digest)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) return "unavailable";
    return buildReceipt(digest, (data?.[0] as SealRow | undefined) ?? null);
  } catch {
    return "unavailable";
  }
}

export default async function SealReceiptPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const digest = normaliseDigest(hash);
  // One address per digest: an uppercase or padded paste lands on the lowercase form.
  if (digest && digest !== hash) redirect(`/verify/${digest}`);

  const result = digest ? await lookup(digest) : null;

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

const CHIP = {
  pass: "border-pass-border bg-pass-surface text-pass-text",
  fail: "border-fail-border bg-fail-surface text-fail-text",
  warning: "border-warning-border bg-warning-surface text-warning-text",
  neutral: "border-dashed border-neutral-border bg-neutral-surface text-neutral-text",
} as const;

function Heading({ title, chip, tone }: { title: string; chip: string; tone: keyof typeof CHIP }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <span className={`inline-flex w-fit items-center rounded-control border px-2.5 py-1 text-sm font-semibold ${CHIP[tone]}`}>{chip}</span>
    </div>
  );
}

function Digest({ value }: { value: string }) {
  return (
    <div className="mt-6">
      <p className="text-sm font-medium text-ink-faint">SHA-256</p>
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
      <Heading title="Withdrawn report" chip="Withdrawn" tone="neutral" />
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function stated(value: number | null): string {
  return value === null ? "not stated" : String(value);
}

function Verified({ digest, details }: { digest: string; details: ReceiptDetails }) {
  const { suite, counts, grade, chain } = details;
  return (
    <>
      <Heading title="Sealed by Novera" chip="Verified" tone="pass" />
      <Digest value={digest} />
      <p className="mt-4 measure text-base leading-relaxed text-ink">
        Verified: the stored report still hashes to this digest.
      </p>
      <p className="mt-2 measure text-sm leading-relaxed text-ink-soft">
        This confirms what Novera stores. To confirm the copy you were sent is the same document,
        hash its JSON export as described on the <Link href="/verify" className="underline underline-offset-2">seal check page</Link>.
      </p>
      {details.testData && (
        <p className="mt-4 inline-flex items-center rounded-control border-2 border-dashed border-warning-text bg-warning-surface px-3 py-1 text-sm font-bold uppercase tracking-wide text-warning-text">
          Test data · Novera&apos;s scripted fixture, not a real agent
        </p>
      )}

      <dl className="mt-6 divide-y divide-line border-y border-line">
        <Row label="Sealed at">{details.sealedAt ?? "Not recorded"}</Row>
        <Row label="Run date">{details.runDate ?? "Not stated in this report"}</Row>
        <Row label="Suite">
          {suite.builtIn
            ? <>{suite.name} <span className="font-mono text-ink-soft">({suite.key} v{suite.version})</span></>
            : suite.version !== null
              ? <>The workspace&apos;s own suite, version {suite.version}. Its name is not shown here.</>
              : "The workspace's own suite. Its name is not shown here."}
        </Row>
        <Row label="Grading funded by">{details.fundedBy ?? "Not stated in a form this page reads"}</Row>
        <Row label="Scenarios">
          {counts.planned === null ? "Not stated" : `${counts.planned} planned`}
          <span className="mt-1 block text-ink-soft">
            {stated(counts.passed)} passed · {stated(counts.failed)} failed · {stated(counts.noResult)} no result · {stated(counts.notRun)} not run
          </span>
        </Row>
        <Row label="Grade">
          {grade === null
            ? "Not recorded: this report's format predates grades."
            : grade.shownAs
              ? <>{grade.shownAs === "withheld" ? "Withheld" : "Incomplete"}{grade.threshold !== null ? <span className="text-ink-soft"> · pass mark {grade.threshold}%</span> : null}</>
              : <>{grade.band}{grade.score !== null ? ` · ${grade.score}%` : ""}{grade.threshold !== null ? <span className="text-ink-soft"> · pass mark {grade.threshold}%</span> : null}</>}
        </Row>
        <Row label="Previous report">
          {chain.kind === "previous"
            ? <Link href={`/verify/${chain.hash}`} className="font-mono underline underline-offset-2 break-all">{chain.hash}</Link>
            : chain.kind === "first"
              ? "None: this is the first report for its agent."
              : "Not recorded: this report's format predates the chain."}
        </Row>
        {details.reissueOf && (
          <Row label="Reissues">
            <Link href={`/verify/${details.reissueOf}`} className="font-mono underline underline-offset-2 break-all">{details.reissueOf}</Link>
          </Row>
        )}
        <Row label="Document format">{details.format === null ? "Not stated" : `Format ${details.format}`}</Row>
      </dl>
    </>
  );
}
