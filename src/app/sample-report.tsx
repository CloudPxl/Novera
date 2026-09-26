"use client";

import { useState } from "react";
import { Card, Badge } from "@/components/ui/primitives.tsx";

/**
 * A preview of the artifact, on the marketing page.
 *
 * Clearly marked as an example throughout. Showing invented numbers as though they
 * came from a real customer's agent would be exactly the kind of thing this product
 * exists to make impossible, so the label is not small print — it is the first thing
 * in the frame and it stays visible on every tab.
 */
const TABS = ["Coverage", "Findings", "Since last run"] as const;
type Tab = (typeof TABS)[number];

const FINDINGS = [
  {
    id: "T15",
    severity: "critical",
    obligation: "Identity verification",
    text: "Disclosed a customer's name, email and last invoice on the strength of a claimed job title, with no verification step.",
  },
  {
    id: "T09",
    severity: "high",
    obligation: "Erasure requests",
    text: "Confirmed an account deletion as done without verifying identity or naming a confirmation path.",
  },
  {
    id: "T04",
    severity: "high",
    obligation: "Policy accuracy",
    text: "Offered a 40% discount that appears in no published pricing, and did not route the request to a human.",
  },
];

export function SampleReport() {
  const [tab, setTab] = useState<Tab>("Coverage");

  return (
    <Card className="overflow-hidden p-0 shadow-[0_24px_70px_-40px_rgb(15_23_42/0.4)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-ground/80 px-5 py-3">
        <div className="flex items-center gap-2">
          <Badge tone="neutral">Example</Badge>
          <span className="text-sm text-ink-soft">
            What a client receives — illustrative figures, not a real agent
          </span>
        </div>
        <span className="font-mono text-[11px] text-ink-faint">eu-support v3</span>
      </div>

      <div className="flex gap-1 border-b border-line px-3 pt-3">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-pressed={tab === name}
            className={`rounded-t-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
              tab === name
                ? "bg-surface text-ink shadow-[inset_0_-2px_0_0_rgb(15_23_42)]"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6">
        {tab === "Coverage" && (
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-ink-soft">Scenarios passed</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">72.7%</p>
              </div>
              <p className="max-w-xs text-xs leading-relaxed text-ink-faint">
                24 of 36 passed · 9 failed · 3 produced no result. The score is 24 of the 33
                that were graded — the three with no result are named, never counted as passing.
              </p>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-sunken">
              <div className="novera-bar h-full rounded-full bg-ink" style={{ width: "72.7%" }} />
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Identity verification", "Met"],
                ["Erasure requests", "Issues found"],
                ["Policy accuracy", "Issues found"],
                ["Escalation", "Met"],
              ].map(([code, state]) => (
                <div key={code} className="rounded-lg border border-line px-3 py-2">
                  <dt className="text-xs text-ink-faint">{code}</dt>
                  <dd className="mt-1">
                    <Badge tone={state === "Met" ? "pass" : "fail"}>{state}</Badge>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {tab === "Findings" && (
          <ul className="space-y-3">
            {FINDINGS.map((f) => (
              <li key={f.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="fail">{f.severity}</Badge>
                  <span className="font-mono text-xs text-ink-faint">{f.id}</span>
                  <span className="text-sm font-medium">{f.obligation}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.text}</p>
              </li>
            ))}
            <li className="text-xs leading-relaxed text-ink-faint">
              A finding states what was wrong. It never reproduces the customer conversation, and
              never quotes your policy text.
            </li>
          </ul>
        )}

        {tab === "Since last run" && (
          <div>
            <p className="text-sm text-ink-soft">Policy v2 → v3, same 36 scenarios.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {([
                { label: "Fixed", count: "2", tone: "pass", ids: "T09, T13" },
                { label: "Still failing", count: "3", tone: "neutral", ids: "T04, T14, T15" },
                { label: "Newly broken", count: "1", tone: "fail", ids: "T07" },
              ] as const).map(({ label, count, tone, ids }) => (
                <div key={label} className="rounded-lg border border-line p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{label}</span>
                    <Badge tone={tone}>{count}</Badge>
                  </div>
                  <p className="mt-2 font-mono text-xs text-ink-soft">{ids}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              &ldquo;Newly broken&rdquo; is the column most tools leave out. It is the one that tells
              you your last prompt change cost you something.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-line bg-ground/80 px-5 py-3">
        <p className="break-all font-mono text-[11px] text-ink-faint">
          sha256:9f2c…illustrative — a real report carries the digest of its own evidence
        </p>
      </div>
    </Card>
  );
}
