"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode, type RefObject } from "react";
import { contentHashWeb } from "@/lib/report/canonical.ts";
import {
  fileVerdict,
  ledgerPath,
  MAX_REPORT_FILE_BYTES,
  readLedgerAnswer,
  readReportFile,
  type FileProblem,
  type FileVerdict,
  type LedgerAnswer,
} from "@/lib/report/file-check.ts";
import { REPORT_NOTICE_SHORT, REPORT_NOTICE_TITLE } from "@/lib/legal/notices.ts";
import { ExplainTrigger } from "@/components/ui/explain-trigger.tsx";
import { CHIP, ReceiptDetailsList } from "./receipt-details.tsx";

/**
 * "Check a downloaded report": the reader's own copy, hashed in their browser.
 *
 * The file is read with `File.text()` and never leaves the page. What goes over the network is
 * a GET to `/api/verify/<digest>` carrying the digest the browser computed, and — only when the
 * export states a different one — a second GET for that stated digest. No body, no cookies.
 *
 * The drop zone is an enhancement over a real file input, which is labelled, reachable from the
 * keyboard and disabled until the page's script is running (without it, nothing would happen;
 * the page offers the command instead).
 */

type Done = {
  kind: "done";
  name: string;
  shape: "export" | "payload";
  computed: string;
  claimed: string | null;
  claimedUnreadable: boolean;
  ledger: LedgerAnswer;
  claimedLedger: LedgerAnswer | null;
  verdict: FileVerdict;
};

type State =
  | { kind: "idle" }
  | { kind: "checking"; name: string }
  | { kind: "problem"; name: string; problem: FileProblem | "no_crypto" }
  | { kind: "no_content"; name: string }
  | Done;

const MB = MAX_REPORT_FILE_BYTES / (1024 * 1024);

const PROBLEMS: Record<FileProblem | "no_crypto", string> = {
  too_large: `This file is larger than ${MB} MB, so it was not read. A Novera report's JSON export is far smaller: check that you chose the right file.`,
  empty: "This file is empty.",
  not_json: "This file is not valid JSON. Choose the report's JSON export (Download → JSON on the report), not its Markdown, CSV or JUnit file.",
  no_crypto: "This browser cannot compute SHA-256 on this page: Web Crypto needs a secure (https) connection. Use the command below instead.",
};

const subscribe = () => () => {};

async function askLedger(digest: string): Promise<LedgerAnswer> {
  try {
    const response = await fetch(ledgerPath(digest), {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200 && response.status !== 503) return { state: "unavailable", digest };
    return readLedgerAnswer(digest, await response.json());
  } catch {
    return { state: "unavailable", digest };
  }
}

export function FileCheck() {
  // False on the server and in the first client render, so the input is disabled until a
  // change would actually be handled.
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const attempt = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.kind !== "idle" && state.kind !== "checking") heading.current?.focus();
  }, [state]);

  async function check(file: File) {
    const mine = ++attempt.current;
    const settle = (next: State) => {
      if (attempt.current === mine) setState(next);
    };
    const name = file.name || "the file";
    setState({ kind: "checking", name });

    if (file.size > MAX_REPORT_FILE_BYTES) return settle({ kind: "problem", name, problem: "too_large" });
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return settle({ kind: "problem", name, problem: "no_crypto" });

    let text: string;
    try {
      text = await file.text();
    } catch {
      return settle({ kind: "problem", name, problem: "not_json" });
    }
    const read = readReportFile(text, file.size);
    if (!read.ok) return settle({ kind: "problem", name, problem: read.problem });
    if (read.shape === "none") return settle({ kind: "no_content", name });

    const computed = await contentHashWeb(read.payload, subtle);
    const claimed = read.claimed;
    const ledger = await askLedger(computed);
    // The stated digest is asked about only when it differs and the computed one is unknown:
    // that is the one case where it changes the verdict.
    const claimedLedger = claimed && claimed !== computed && ledger.state === "unknown" ? await askLedger(claimed) : null;
    settle({
      kind: "done",
      name,
      shape: read.shape,
      computed,
      claimed,
      claimedUnreadable: read.claimedUnreadable,
      ledger,
      claimedLedger,
      verdict: fileVerdict({ computed, claimed, ledger, claimedLedger }),
    });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && ready) void check(file);
  }

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={`rounded-control border-2 border-dashed p-5 transition-colors ${dragging ? "border-ink bg-sunken" : "border-line-strong bg-surface"}`}
      >
        <label htmlFor="report-file" className="block text-sm font-medium text-ink">
          Report JSON export
        </label>
        <p id="report-file-hint" className="mt-0.5 text-sm text-ink-soft">
          Drop the file here, or choose it. The JSON export (Download → JSON on the report) or a
          bare report payload, up to {MB} MB.
        </p>
        <input
          id="report-file"
          type="file"
          accept=".json,application/json"
          disabled={!ready}
          aria-describedby="report-file-hint report-file-privacy"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void check(file);
          }}
          className="mt-3 block w-full max-w-full text-sm text-ink-soft file:mr-3 file:cursor-pointer file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-ground disabled:cursor-not-allowed disabled:file:cursor-not-allowed"
        />
        <noscript>
          <p className="mt-3 text-sm text-ink">
            Checking a file here needs JavaScript. Without it, use the command under
            &ldquo;Checking the copy you hold&rdquo; below: it makes the same computation.
          </p>
        </noscript>
      </div>
      <p id="report-file-privacy" className="mt-3 text-sm leading-relaxed text-ink-soft">
        The file never leaves your browser; only its SHA-256 is sent to look it up, and the digest
        the file states, if that is a different one.
      </p>

      <p role="status" className="sr-only">
        {state.kind === "checking" ? `Checking ${state.name}…` : ""}
      </p>
      {state.kind === "checking" && (
        <p aria-hidden="true" className="mt-5 text-sm text-ink-soft">Checking {state.name}…</p>
      )}
      {state.kind === "problem" && (
        <Result heading={heading} title="This file could not be checked" chip="Not checked" tone="neutral" name={state.name}>
          <p className="mt-3 measure text-sm leading-relaxed text-ink">{PROBLEMS[state.problem]}</p>
        </Result>
      )}
      {state.kind === "no_content" && (
        <Result heading={heading} title="Not a sealed Novera report" chip="No match" tone="warning" name={state.name}>
          <p className="mt-3 measure text-sm leading-relaxed text-ink">
            This JSON holds no report content: it is not an object, or its <code className="font-mono">payload</code> is
            not one. Nothing was looked up.
          </p>
        </Result>
      )}
      {state.kind === "done" && <Outcome state={state} heading={heading} />}
    </div>
  );
}

function Result({
  heading,
  title,
  chip,
  tone,
  name,
  children,
}: {
  heading: RefObject<HTMLHeadingElement | null>;
  title: string;
  chip: string;
  tone: keyof typeof CHIP;
  name: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="file-result-heading" className="mt-6 border-t border-line pt-5">
      <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">Checked: {name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="file-result-heading" ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight focus:outline-none focus-visible:outline-none">
          {title}
        </h3>
        <span className={`inline-flex w-fit items-center rounded-control border px-2.5 py-1 text-sm font-semibold ${CHIP[tone]}`}>{chip}</span>
      </div>
      {children}
      <p className="mt-6 border-t border-line pt-4 text-sm leading-relaxed text-ink-soft">
        <strong className="font-semibold text-ink">{REPORT_NOTICE_TITLE}:</strong>{" "}
        {REPORT_NOTICE_SHORT.slice(REPORT_NOTICE_SHORT.indexOf(": ") + 2)}
      </p>
    </section>
  );
}

const VERDICTS: Record<FileVerdict, { title: string; chip: string; tone: keyof typeof CHIP }> = {
  matches: { title: "Matches a sealed Novera report", chip: "Verified", tone: "pass" },
  changed: { title: "This file was changed after sealing", chip: "Changed", tone: "fail" },
  withdrawn: { title: "Withdrawn", chip: "Withdrawn", tone: "neutral" },
  stored_mismatch: { title: "Novera's stored copy no longer matches", chip: "Does not match", tone: "fail" },
  not_sealed: { title: "Not a sealed Novera report", chip: "No match", tone: "warning" },
  unavailable: { title: "The check could not be completed", chip: "Not checked", tone: "neutral" },
};

function ledgerLine(answer: LedgerAnswer): string {
  switch (answer.state) {
    case "verified": return "Sealed, and the stored report still hashes to it";
    case "withdrawn": return answer.withdrawnAt ? `Withdrawn on ${answer.withdrawnAt}` : "Withdrawn";
    case "mismatch": return "Stored, but the stored report no longer hashes to it";
    case "unknown": return "No report sealed by Novera has this digest";
    case "unavailable": return "Could not be read just now";
  }
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-control border border-line bg-surface p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1.5 text-sm text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Hex({ value }: { value: string }) {
  return <span className="block font-mono text-xs leading-relaxed break-all">{value}</span>;
}

function Outcome({ state, heading }: { state: Done; heading: RefObject<HTMLHeadingElement | null> }) {
  const { verdict, computed, claimed, ledger, claimedLedger } = state;
  const { title, chip, tone } = VERDICTS[verdict];
  const statedDiffers = claimed !== null && claimed !== computed;

  return (
    <Result heading={heading} title={title} chip={chip} tone={tone} name={state.name}>
      <p className="mt-3 measure text-sm leading-relaxed text-ink">
        <Sentence state={state} />
      </p>

      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <Cell label="Computed in your browser">
          <Hex value={computed} />
        </Cell>
        <Cell label="Stated in the file">
          {claimed !== null ? (
            <>
              <Hex value={claimed} />
              <span className="mt-1.5 block text-ink-soft">
                {statedDiffers ? "Differs from the computed digest" : "Same as the computed digest"}
                {claimedLedger ? `. In the ledger: ${ledgerLine(claimedLedger).toLowerCase()}.` : null}
              </span>
            </>
          ) : state.claimedUnreadable ? (
            <span className="text-ink-soft">The file&apos;s content_hash is not a SHA-256 digest.</span>
          ) : state.shape === "payload" ? (
            <span className="text-ink-soft">None: the file has no export header, so it states no digest.</span>
          ) : (
            <span className="text-ink-soft">None stated.</span>
          )}
        </Cell>
        <Cell label="Novera's ledger">
          <Hex value={computed} />
          <span className="mt-1.5 block text-ink-soft">{ledgerLine(ledger)}.</span>
        </Cell>
      </dl>

      {verdict === "matches" && ledger.state === "verified" && (
        <>
          {statedDiffers && (
            <p className="mt-4 measure text-sm leading-relaxed text-ink">
              The file&apos;s <code className="font-mono">content_hash</code> field states a different digest. That
              field sits outside the seal; the report content itself is what Novera sealed.
            </p>
          )}
          {ledger.details.testData && (
            <div className="mt-4 flex flex-wrap items-center">
              <p className="inline-flex items-center rounded-control border-2 border-dashed border-warning-text bg-warning-surface px-3 py-1 text-sm font-bold uppercase tracking-wide text-warning-text">
                Test data · Novera&apos;s scripted fixture, not a real agent
              </p>
              <ExplainTrigger id="test_data" />
            </div>
          )}
          <ReceiptDetailsList details={ledger.details} />
        </>
      )}

      <p className="mt-5 text-sm">
        <Link href={`/verify/${computed}`} className="font-medium underline underline-offset-2">
          Open the receipt for the computed digest
        </Link>
      </p>
    </Result>
  );
}

function Sentence({ state }: { state: Done }) {
  const { verdict, claimed, ledger } = state;
  switch (verdict) {
    case "matches":
      return <>The report content in this file hashes to a digest Novera sealed, and the report Novera stores still hashes to it: this is the sealed document.</>;
    case "changed":
      return (
        <>
          The file states it was sealed with a digest Novera holds a report under, but its content
          hashes to a different one. The report content was edited after sealing; do not rely on
          the figures in this copy.
        </>
      );
    case "withdrawn":
      return (
        <>
          This file&apos;s content hashes to a report Novera sealed
          {ledger.state === "withdrawn" && ledger.withdrawnAt ? <> and withdrew on {ledger.withdrawnAt}</> : <> and has since withdrawn</>}.
          A withdrawn report stays withdrawn. Nothing more about it is shown here.
        </>
      );
    case "stored_mismatch":
      return <>A report was stored under the digest this file hashes to, but the stored content no longer hashes to it, so Novera cannot confirm it. Its details are not shown.</>;
    case "not_sealed":
      return (
        <>
          No report sealed by Novera has the digest this file hashes to
          {claimed !== null && claimed !== state.computed ? ", nor the digest the file states" : ""}. The file
          does not come from a Novera report, or the report was deleted with its workspace.
        </>
      );
    case "unavailable":
      return <>Novera&apos;s records could not be read just now, so nothing is concluded about this file. Try again in a minute.</>;
  }
}
