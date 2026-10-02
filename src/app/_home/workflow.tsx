"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSystemMotion } from "@/components/ui/motion.ts";

/**
 * The four steps, each with the screen it lands on.
 *
 * The step text is always on the page — all four, in an ordered list — so nothing is
 * hidden behind a selection and nothing waits for an animation. Choosing a step only
 * changes the picture beside it. The run in step 3 counts up once when chosen; without
 * motion it is simply finished.
 */
const STEPS = [
  { title: "Connect the agent", body: "Point Novera at an HTTP endpoint you operate and confirm you are authorised to test it. One harmless request goes first, and its reply is saved as a receipt.", time: "2 minutes" },
  { title: "Write the policy", body: "The rules the agent should keep, in plain sentences. Saving creates a version that is never edited, so a report always names what it was measured against.", time: "5 minutes" },
  { title: "Run the suite", body: "Every scenario goes to your agent and comes back with a verdict, its evidence and who decided it — or with the reason there is none.", time: "about a minute" },
  { title: "Prepare and share the report", body: "Novera says whether the report is ready to send, and what stands in the way if not. Then one private link — expiring and revocable — or an export.", time: "when it is ready" },
];

export function Workflow() {
  const [step, setStep] = useState(0);
  const motion = useSystemMotion();

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <ol className="relative space-y-2">
        <span aria-hidden className="absolute bottom-6 left-[1.0625rem] top-6 w-px bg-line" />
        {STEPS.map((s, i) => {
          const active = i === step;
          return (
            <li key={s.title} className="relative">
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-pressed={active}
                className={`novera-press group flex w-full gap-4 rounded-panel border p-3 text-left ${active ? "border-line-strong bg-surface shadow-card" : "border-transparent hover:bg-surface/70"}`}
              >
                <span className={`relative z-10 grid size-[2.125rem] shrink-0 place-items-center rounded-full text-sm font-semibold tnum transition-colors duration-200 ${active ? "bg-ink text-on-ink" : i < step ? "bg-pass-surface text-pass-text ring-1 ring-pass-border" : "bg-surface text-ink-soft ring-1 ring-line-strong"}`}>
                  {i < step ? "✓" : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-base font-semibold">{s.title}</span>
                    <span className="type-mono text-[11px] text-ink-faint">{s.time}</span>
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-soft">{s.body}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="overflow-hidden rounded-shell border border-line-strong bg-surface shadow-[0_30px_70px_-45px_rgb(28_25_23/0.45)]">
          <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-2.5">
            <p className="type-eyebrow text-ink-faint">Step {step + 1} of 4 · {STEPS[step].title}</p>
            <span className="rounded-full border border-warning-text/40 bg-warning-surface px-2 py-0.5 text-[11px] font-medium text-warning-text">Illustrative</span>
          </div>
          <div key={step} className={`min-h-[19rem] p-5 sm:p-6 ${motion ? "novera-drawer" : ""}`}>
            {step === 0 && <ConnectScreen />}
            {step === 1 && <PolicyScreen />}
            {step === 2 && <RunScreen motion={motion} />}
            {step === 3 && <ReportScreen />}
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
            <button type="button" disabled={step === 0} onClick={() => setStep((s) => s - 1)} className="novera-press rounded-control px-2.5 py-1 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink disabled:opacity-40">← Back</button>
            <div aria-hidden className="flex gap-1.5">
              {STEPS.map((s, i) => <span key={s.title} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-ink" : "w-1.5 bg-line-strong"}`} />)}
            </div>
            <button type="button" disabled={step === 3} onClick={() => setStep((s) => s + 1)} className="novera-press rounded-control px-2.5 py-1 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink disabled:opacity-40">Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const Label = ({ children }: { children: ReactNode }) => <p className="text-xs font-medium text-ink">{children}</p>;
const FakeInput = ({ children, mono = false }: { children: ReactNode; mono?: boolean }) => (
  <div className={`mt-1 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm ${mono ? "font-mono text-[13px]" : ""}`}>{children}</div>
);

function ConnectScreen() {
  return (
    <div className="space-y-4">
      <div><Label>Endpoint</Label><FakeInput mono>https://support.example.com/chat</FakeInput></div>
      <div className="flex items-start gap-2 text-sm">
        <span aria-hidden className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] bg-ink text-[10px] text-on-ink">✓</span>
        <span className="text-ink-soft">I own this agent or am authorised to test it. <span className="text-ink-faint">Stored with every run.</span></span>
      </div>
      <div className="rounded-panel border border-pass-border bg-pass-surface p-3">
        <p className="text-sm font-semibold text-pass-text">Connection check answered · 200 in 420 ms</p>
        <p className="mt-1 font-mono text-[12px] text-ink-soft">reply: &quot;Hi! How can I help with your order today?&quot;</p>
        <p className="mt-1 text-xs text-ink-faint">Saved as a receipt, so you can see what Novera is talking to before a full run.</p>
      </div>
    </div>
  );
}

function PolicyScreen() {
  return (
    <div className="space-y-4">
      <div>
        <Label>Policy</Label>
        <div className="mt-1 space-y-1 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink-soft">
          <p>Verify identity before any account change.</p>
          <p>Never promise a refund above EUR 200 without a person.</p>
          <p>Hand over to a person when asked.</p>
          <p className="text-ink-faint">Never quote prices that are not on the pricing page.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-on-ink">Saved as version 1</span>
        <span className="text-xs text-ink-faint">Editing later creates version 2; version 1 stays as it is.</span>
      </div>
    </div>
  );
}

function RunScreen({ motion }: { motion: boolean }) {
  const [done, setDone] = useState(motion ? 0 : 49);
  useEffect(() => {
    if (!motion) return;
    let n = 0;
    const t = setInterval(() => { n = Math.min(49, n + 3); setDone(n); if (n >= 49) clearInterval(t); }, 70);
    return () => clearInterval(t);
  }, [motion]);
  // The tallies follow the cells so the picture never shows a count ahead of its rows.
  const tally = (ids: number[]) => ids.filter((i) => i < done).length;
  const fails = [3, 6, 13, 14, 21], nones = [22, 34, 37];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label>eu-support v5 against support.example.com</Label>
        <span className="type-mono text-xs text-ink-faint tnum">{done} of 49</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full bg-trace transition-[width] duration-100" style={{ width: `${(done / 49) * 100}%` }} />
      </div>
      <ol aria-hidden className="mt-4 grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1">
        {Array.from({ length: 49 }, (_, i) => (
          <li key={i} className={`aspect-square rounded-[3px] border transition-colors duration-150 ${i >= done ? "border-line bg-surface" : fails.includes(i) ? "border-fail-text bg-fail-text" : nones.includes(i) ? "border-dashed border-warning-text bg-warning-surface" : "border-pass-border bg-pass-surface"}`} />
        ))}
      </ol>
      <p className="mt-4 text-sm text-ink-soft tnum">
        {done < 49 ? "Running — counts appear when the run completes." : (
          <><span className="font-semibold text-pass-text">{49 - tally(fails) - tally(nones)} passed</span> · <span className="font-semibold text-fail-text">{tally(fails)} failed</span> · <span className="font-semibold text-warning-text">{tally(nones)} no verdict</span></>
        )}
      </p>
    </div>
  );
}

function ReportScreen() {
  const checks: Array<[string, "ok" | "gap"]> = [
    ["Sealed, and the digest verifies", "ok"],
    ["Every scenario ran", "ok"],
    ["Three scenarios have no verdict", "gap"],
    ["No reviewer finding left undisclosed", "ok"],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Before you send it</Label>
        <span className="rounded-full border border-warning-border bg-warning-surface px-2.5 py-0.5 text-xs font-semibold text-warning-text">Grade withheld: fix the evidence first</span>
      </div>
      <ul className="space-y-1.5">
        {checks.map(([text, r]) => (
          <li key={text} className="flex items-center gap-2 text-sm">
            <span aria-hidden className={`grid size-4 place-items-center rounded-full text-[10px] ${r === "ok" ? "bg-pass-surface text-pass-text" : "bg-warning-surface text-warning-text"}`}>{r === "ok" ? "✓" : "!"}</span>
            <span className={r === "ok" ? "text-ink-soft" : "font-medium text-ink"}>{text}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-ink-faint">Retest T23, T35 and T38 once their cause is fixed; readiness is computed from the sealed document, never switched on by hand.</p>
      <div className="flex flex-wrap gap-1.5">
        {["Private link", "PDF", "Markdown", "CSV", "JSON", "JUnit"].map((f) => (
          <span key={f} className="rounded-control border border-line px-2 py-1 text-xs text-ink-soft">{f}</span>
        ))}
      </div>
    </div>
  );
}
