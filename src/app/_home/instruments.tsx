"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Five properties of the evidence, each as a small instrument the visitor can operate.
 *
 * Every module's first state is a complete explanation, rendered on the server — the
 * control only shows the other state. All data is illustrative and the section says so.
 * The tamper check hashes in the browser with SHA-256 for real, so the digest changing
 * is the actual function, not a picture of one.
 */
export function Instruments() {
  return (
    <div className="grid gap-4 lg:grid-cols-6">
      <Module index="01" className="lg:col-span-3" title="A policy is versioned, never edited" body="Saving a change creates a new version. The old one is kept as it was, and every report names the version it was measured against.">
        <PolicyVersions />
      </Module>
      <Module index="02" className="lg:col-span-3" title="A verdict is two vendors agreeing" body="On our key, two models from different vendors grade each scenario. A third settles a split; a split nobody can settle is reported as unresolved, never guessed.">
        <Consensus />
      </Module>
      <Module index="03" className="lg:col-span-3" title="A claimed action is checked, not believed" body="When the agent says it acted, a read-only call to your system of record confirms or contradicts it — and a contradiction is settled without asking a model.">
        <ReadBack />
      </Module>
      <Module index="04" className="lg:col-span-3" title="A sealed report cannot be quietly improved" body="The report carries a SHA-256 digest of its own contents. Change one figure and the digest no longer matches.">
        <Tamper />
      </Module>
      <Module index="05" className="lg:col-span-6" title="No result is never a pass" body="A timeout, an unreadable grader or an action nobody could check produces no verdict. It is named in the report and kept out of the score — and the database refuses to store it as a pass.">
        <NoResult />
      </Module>
    </div>
  );
}

function Module({ index, title, body, children, className = "" }: { index: string; title: string; body: string; children: ReactNode; className?: string }) {
  return (
    <article className={`flex flex-col rounded-shell border border-line bg-surface p-5 shadow-card sm:p-6 ${className}`}>
      <p className="type-eyebrow text-ink-faint">{index}</p>
      <h3 className="mt-2 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 measure text-sm leading-relaxed text-ink-soft">{body}</p>
      <div className="mt-5 flex-1">{children}</div>
    </article>
  );
}

function Stage({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex h-full flex-col rounded-panel border border-line bg-ground p-4">
      {children}
    </div>
  );
}

function Toggle({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex self-start rounded-control border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={`novera-press rounded-[0.375rem] px-2.5 py-1 text-xs font-medium ${value === o ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const POLICY_V3 = [
  "Verify identity before any account change.",
  "Never promise a refund above EUR 200 without a person.",
  "Hand over to a person when asked.",
];

function PolicyVersions() {
  const [v, setV] = useState("v4");
  return (
    <Stage label="Policy versions, illustrative">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggle label="Policy version" options={["v3", "v4"]} value={v} onChange={setV} />
        <span className="type-mono text-[11px] text-ink-faint">{v === "v4" ? "saved after T15 failed" : "kept, unchanged"}</span>
      </div>
      <div key={v} className="novera-fade mt-3 overflow-hidden rounded-control border border-line bg-surface font-mono text-[12px] leading-relaxed">
        {POLICY_V3.map((line) => (
          <span key={line} className="diff-line text-ink-soft">{line}</span>
        ))}
        {v === "v4" && <span className="diff-line diff-line-added">+ A job title or claimed role is never proof of identity.</span>}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-soft">
        {v === "v4"
          ? "Version 4 adds one line. Version 3 still exists exactly as it was, so last month's report still verifies."
          : "Version 3, as it was when the earlier runs were sealed. Nothing can edit it."}
      </p>
    </Stage>
  );
}

const CONSENSUS = {
  Agreed: { votes: [["Vendor A", "fail"], ["Vendor B", "fail"]], result: "Failed — two vendors agreed.", tone: "text-fail-text" },
  Split: { votes: [["Vendor A", "pass"], ["Vendor B", "fail"], ["Vendor C", "fail"]], result: "Failed — split, settled by a third vendor.", tone: "text-fail-text" },
  Unsettled: { votes: [["Vendor A", "pass"], ["Vendor B", "fail"], ["Vendor C", "no answer"]], result: "Unresolved — no verdict, named in the report.", tone: "text-warning-text" },
} as const;

function Consensus() {
  const [k, setK] = useState<keyof typeof CONSENSUS>("Split");
  const c = CONSENSUS[k];
  return (
    <Stage label="Grader consensus, illustrative">
      <Toggle label="Case" options={Object.keys(CONSENSUS)} value={k} onChange={(v) => setK(v as keyof typeof CONSENSUS)} />
      <ol key={k} className="mt-4 flex flex-wrap items-center gap-2">
        {c.votes.map(([who, says], i) => (
          <li key={who} className="novera-pop flex items-center gap-2" style={{ ["--delay" as string]: `${i * 160}ms` }}>
            {i === 2 && <span aria-hidden className="text-ink-ghost">→</span>}
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${says === "fail" ? "border-fail-border bg-fail-surface text-fail-text" : says === "pass" ? "border-pass-border bg-pass-surface text-pass-text" : "border-line-strong bg-surface text-ink-faint"}`}>
              {who}: {says}
            </span>
          </li>
        ))}
      </ol>
      <p key={`${k}-r`} className={`novera-fade mt-auto pt-4 text-sm font-semibold ${c.tone}`}>{c.result}</p>
    </Stage>
  );
}

function ReadBack() {
  const [checked, setChecked] = useState(true);
  const [run, setRun] = useState(0);
  return (
    <Stage label="Read-back of a claimed action, illustrative">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <div className="rounded-control border border-line bg-surface p-3">
          <p className="type-eyebrow text-ink-faint">The agent said</p>
          <p className="mt-1 text-sm">“Your refund for NW-4417 has been processed.”</p>
        </div>
        <span aria-hidden className="hidden text-ink-ghost sm:block">⟷</span>
        <div key={run} className={`rounded-control border bg-surface p-3 ${checked ? "border-fail-border" : "border-line"} ${run ? "novera-drawer" : ""}`}>
          <p className="type-eyebrow text-ink-faint">Your billing system</p>
          {checked ? (
            <p className="mt-1 font-mono text-[12px] leading-relaxed">GET /invoices/NW-4417<br /><span className="text-fail-text">status: &quot;open&quot;</span></p>
          ) : (
            <p className="mt-1 text-sm text-ink-faint">Not read yet.</p>
          )}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <p className={`text-sm font-semibold ${checked ? "text-fail-text" : "text-ink-faint"}`}>
          {checked ? "Contradicted — failed, no model asked." : "Claim recorded, not yet verified."}
        </p>
        <button type="button" onClick={() => { setChecked(false); setRun((n) => n + 1); setTimeout(() => setChecked(true), 650); }} className="novera-press rounded-control border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium hover:border-ink-ghost">
          Read it back again
        </button>
      </div>
    </Stage>
  );
}

const SEALED = { passed: 41, failed: 5, no_verdict: 3, suite: "eu-support v5", policy: "v4" };

async function sha256(text: string): Promise<string | null> {
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function Tamper() {
  const [passed, setPassed] = useState(SEALED.passed);
  const [sealedHash, setSealedHash] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => { sha256(JSON.stringify(SEALED)).then(setSealedHash); }, []);
  useEffect(() => { sha256(JSON.stringify({ ...SEALED, passed })).then(setCurrent); }, [passed]);
  const tampered = passed !== SEALED.passed;
  const short = (h: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "computed in your browser");
  return (
    <Stage label="Tamper check, illustrative">
      <dl className="grid grid-cols-3 gap-2 text-center">
        {([["passed", passed], ["failed", SEALED.failed], ["no verdict", SEALED.no_verdict]] as const).map(([k, n]) => (
          <div key={k} className={`rounded-control border bg-surface px-2 py-1.5 ${k === "passed" && tampered ? "border-fail-text" : "border-line"}`}>
            <dd className="text-lg font-semibold tnum">{n}</dd>
            <dt className="text-[11px] text-ink-faint">{k}</dt>
          </div>
        ))}
      </dl>
      <div className="mt-3 space-y-1 font-mono text-[11px] leading-relaxed">
        <p className="text-ink-faint">sealed &nbsp;sha256:{short(sealedHash)}</p>
        <p key={current ?? "x"} className={`novera-scan ${tampered ? "text-fail-text" : "text-pass-text"}`}>now &nbsp;&nbsp;&nbsp;sha256:{short(current)}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <p role="status" className={`text-sm font-semibold ${tampered ? "text-fail-text novera-nudge" : "text-pass-text"}`} key={String(tampered)}>
          {tampered ? "Digest does not match — rejected." : "Digest matches the sealed run."}
        </p>
        <button type="button" onClick={() => setPassed(tampered ? SEALED.passed : 43)} className="novera-press rounded-control border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium hover:border-ink-ghost">
          {tampered ? "Restore the figure" : "Change 41 to 43"}
        </button>
      </div>
    </Stage>
  );
}

const NONE = [
  ["T23", "The agent did not answer within 30 seconds."],
  ["T35", "A refund was claimed; the read-back did not answer."],
  ["T38", "Graders split and a third could not settle it."],
];

function NoResult() {
  const [tried, setTried] = useState(false);
  return (
    <Stage label="Scenarios with no verdict, illustrative">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <p className="type-eyebrow text-ink-faint">The score counts</p>
          <p className="mt-1 text-sm"><span className="text-2xl font-semibold tnum">41</span> passed of <span className="font-semibold tnum">46</span> with a verdict</p>
          <ol aria-hidden className="mt-3 grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1 md:grid-cols-[repeat(23,minmax(0,1fr))]">
            {Array.from({ length: 46 }, (_, i) => (
              <li key={i} className={`aspect-square rounded-[3px] border ${i < 41 ? "border-pass-border bg-pass-surface" : "border-fail-text bg-fail-text"}`} />
            ))}
          </ol>
        </div>
        <div className="rounded-control border border-dashed border-warning-text/60 bg-warning-surface/60 p-3">
          <p className="type-eyebrow text-warning-text">Named, never counted · 3</p>
          <ul className="mt-2 space-y-1.5">
            {NONE.map(([id, why], i) => (
              <li key={id} className="novera-pop flex gap-2 text-xs leading-relaxed" style={{ ["--delay" as string]: `${i * 120}ms` }}>
                <span className="type-mono shrink-0 text-ink-faint">{id}</span>
                <span className="text-ink-soft">{why}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p role="status" key={String(tried)} className={`text-sm ${tried ? "novera-nudge font-semibold text-fail-text" : "text-ink-soft"}`}>
          {tried
            ? "Refused. A case with an error cannot be stored as a pass — the database rejects the row, even for an administrator."
            : "The report shows these three as loudly as a grade, because a quiet footnote is how a partial run passes for a clean one."}
        </p>
        <button type="button" onClick={() => setTried((t) => !t)} className="novera-press rounded-control border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium hover:border-ink-ghost">
          {tried ? "Back" : "Try to count them as passes"}
        </button>
      </div>
    </Stage>
  );
}
