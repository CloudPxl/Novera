import Link from "next/link";
import { Panel } from "@/components/ui/page.tsx";
import type { RailStep } from "./next-action.ts";
import { fixtureServed } from "@/lib/agents/sample.ts";
import { SampleAgentButton } from "../agents/sample-agent.tsx";

/**
 * The first-run rail: an ordered list, the current step marked for assistive technology as
 * well as visually. A step that is pending or not this person's to take is text, not a link.
 */
export function OnboardingRail({ steps }: { steps: RailStep[] }) {
  // With no agent yet, a secondary way in: Novera's own fixture, labelled test data wherever it
  // appears. Offered only to someone who may connect an agent (the step links), and only where
  // this deployment serves the fixture.
  const offerSample = fixtureServed();
  return (
    <Panel className="mt-2">
      <ol aria-label="Getting started" className={`grid divide-y divide-line md:divide-x md:divide-y-0 ${steps.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        {steps.map((s, i) => (
          <li key={s.key} aria-current={s.state === "current" ? "step" : undefined} className={`px-5 py-4 ${s.state === "current" ? "bg-ground" : ""}`}>
            <p className="flex items-center gap-2 text-xs font-medium text-ink-faint">
              <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] ring-1 ring-inset ${s.state === "done" ? "bg-ink text-on-ink ring-ink" : s.state === "current" ? "ring-ink text-ink" : "ring-line-strong"}`}>
                {s.state === "done" ? "✓" : i + 1}
              </span>
              <span>{s.state === "done" ? "Done" : s.state === "current" ? "Next" : "Waiting"}<span className="sr-only"> — step {i + 1} of {steps.length}</span></span>
            </p>
            <p className={`mt-2 text-sm font-medium ${s.state === "pending" ? "text-ink-soft" : "text-ink"}`}>
              {s.href ? <Link href={s.href} className="underline underline-offset-2">{s.label} →</Link> : s.label}
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">{s.note}</p>
            {offerSample && s.key === "connect" && s.state === "current" && s.href && <SampleAgentButton className="mt-3" />}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
