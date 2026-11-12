import Link from "next/link";
import { Badge } from "@/components/ui/primitives.tsx";
import { ExplainTrigger } from "@/components/ui/explain-trigger.tsx";
import { categoryMeta } from "@/lib/evidence/categories.ts";
import { LOCALE_NAMES, variantCounts } from "@/lib/suites/locales.ts";
import { sampleScenarios, suiteSpec } from "@/lib/suites/spec.ts";
import type { SuiteCase } from "@/lib/runner/types.ts";
import type { ChannelDelivery } from "@/lib/agents/types.ts";

/**
 * What a suite is, before it is run: counted from the suite row, never described from memory.
 * Investigate level — one line per suite, the specification behind a row that opens, and the
 * scenarios themselves one step further in, so the run launcher above stays a single decision.
 */
export interface SpecSuite {
  id: string;
  key: string;
  version: number;
  name: string;
  cases: SuiteCase[];
}

const SEVERITY_TONE: Record<string, "fail" | "error" | "neutral"> = { critical: "fail", high: "error" };

const deliveryWords = (how: ChannelDelivery, what: "metadata" | "earlier turns") =>
  how === "field" ? `sent in this agent's own field for ${what}`
    : how === "message" ? "sent inside the message, which the report states"
      : "not sent to this agent: its request has no field for them and the delivery option is off";

export function SuiteSpecCards({ suites, delivery, open, hasReadBack }: {
  suites: SpecSuite[];
  /** How this agent receives metadata and earlier turns; null for an agent that is not an HTTP endpoint. */
  delivery: { context: ChannelDelivery; conversation: ChannelDelivery } | null;
  /** The suite shown open: the one the launcher selects. */
  open?: string;
  /** Whether this agent has a read-only endpoint configured; without one, a scenario that needs it can fail and never pass. */
  hasReadBack?: boolean;
}) {
  if (suites.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="What each suite tests">
      {suites.map((suite) => {
        const spec = suiteSpec(suite.cases);
        const variants = variantCounts(suite.cases);
        const languages = ["English", ...(Object.keys(variants) as Array<keyof typeof variants>).filter((l) => variants[l] > 0).map((l) => `${LOCALE_NAMES[l]} (${variants[l]} of ${spec.scenarios})`)];
        return (
          <li key={suite.id}>
            <details open={suite.id === open} className="group rounded-panel border border-line bg-surface">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-panel px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="font-medium text-ink">{suite.name} v{suite.version}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    {spec.scenarios} scenarios · {spec.bySeverity.map((s) => `${s.count} ${s.severity}`).join(" · ")} · about {spec.estimatedMinutes} min on Novera&apos;s keys
                  </span>
                </span>
                <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
              </summary>
              <div className="space-y-4 border-t border-line px-4 py-4 text-sm">
                <div>
                  <p className="type-pill text-ink-faint">What it exercises</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {spec.byCategory.map((c) => (
                      <li key={c.category}><Badge tone="neutral">{categoryMeta(c.category).label} · {c.count}</Badge></li>
                    ))}
                  </ul>
                </div>
                {spec.references.length > 0 && (
                  <div>
                    <p className="type-pill text-ink-faint">Evidence is filed under</p>
                    <p className="mt-1 text-ink-soft">
                      {spec.references.slice(0, 8).map((r) => `${r.ref} (${r.count})`).join(" · ")}
                      {spec.references.length > 8 ? ` · and ${spec.references.length - 8} more` : ""}.{" "}
                      These organise the evidence for a reader with those duties; they are not a finding that any duty is met.
                    </p>
                  </div>
                )}
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
                  <dt className="text-ink-faint">How verdicts are reached</dt>
                  <dd className="text-ink-soft">
                    {spec.withRules} scenario{spec.withRules === 1 ? " has" : "s have"} rules that can fail it without a model; every scenario the rules do not fail is read by two AI graders from different companies.
                    <ExplainTrigger id="consensus_tiebreaker" />
                    {spec.withEffect > 0 && <> {spec.withEffect} expect an action and need evidence beyond the reply.<ExplainTrigger id="action_not_verified" /></>}
                    {spec.needsReadBack.length > 0 && hasReadBack === false && (
                      <span className="mt-1 block font-medium text-warning-text">
                        {spec.needsReadBack.join(", ")} can pass only when Novera can read the result in your system, and this agent has no read-only endpoint.
                        Until one is set under Verifying what the agent does, {spec.needsReadBack.length === 1 ? "it" : "each"} can fail but not pass, and the grade is shown over the other scenarios.
                      </span>
                    )}
                  </dd>
                  <dt className="text-ink-faint">Time</dt>
                  <dd className="text-ink-soft">About {spec.estimatedMinutes} minutes on Novera&apos;s keys, estimated from a measured run; an agent that answers slowly takes longer. A run can be left: it continues and seals its report by itself.</dd>
                  <dt className="text-ink-faint">Languages</dt>
                  <dd className="text-ink-soft">{languages.join(" · ")}</dd>
                  {spec.withMetadata.length > 0 && delivery && (
                    <>
                      <dt className="text-ink-faint">Metadata scenarios</dt>
                      <dd className="text-ink-soft">
                        {spec.withMetadata.join(", ")} carry a retrieved document or a tool&apos;s result: {deliveryWords(delivery.context, "metadata")}.
                        {delivery.context === "message" && <ExplainTrigger id="in_message_delivery" />}
                      </dd>
                    </>
                  )}
                  {spec.conversations.length > 0 && delivery && (
                    <>
                      <dt className="text-ink-faint">Conversations</dt>
                      <dd className="text-ink-soft">
                        {spec.conversations.join(", ")} {spec.conversations.length === 1 ? "has" : "have"} earlier turns: {deliveryWords(delivery.conversation, "earlier turns")}.
                        {delivery.conversation === "message" && <ExplainTrigger id="in_message_delivery" />}
                      </dd>
                    </>
                  )}
                  {spec.testTargetOnly > 0 && (
                    <>
                      <dt className="text-ink-faint">Test targets only</dt>
                      <dd className="text-ink-soft">{spec.testTargetOnly} scenario{spec.testTargetOnly === 1 ? "" : "s"} would change something for real, so {spec.testTargetOnly === 1 ? "it is" : "they are"} not sent to an agent that serves real customers.</dd>
                    </>
                  )}
                </dl>
                <details className="group/inner rounded-control border border-line">
                  <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                    Read {Math.min(4, suite.cases.length)} of its scenarios
                  </summary>
                  <ul className="divide-y divide-line border-t border-line">
                    {sampleScenarios(suite.cases).map((c) => (
                      <li key={c.id} className="space-y-1.5 px-3 py-3">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="tnum font-medium text-ink">{c.id}</span>
                          <Badge tone={SEVERITY_TONE[c.severity] ?? "neutral"}>{c.severity}</Badge>
                          <span className="text-xs text-ink-faint">{categoryMeta(c.category).label}</span>
                        </p>
                        <p className="text-ink [overflow-wrap:anywhere]"><span className="text-ink-faint">Customer: </span>{c.input.length > 320 ? `${c.input.slice(0, 320)}…` : c.input}</p>
                        <p className="text-ink-soft"><span className="text-ink-faint">Expected: </span>{c.expected_behavior}</p>
                        <ul className="list-disc pl-5 text-xs text-ink-soft">
                          {c.assertions.map((a) => <li key={a}>{a}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </details>
                <p className="text-xs text-ink-faint">
                  Every scenario, its tier and what changed between versions:{" "}
                  <Link href="/scenarios?tab=catalog" className="font-medium text-ink underline underline-offset-2">open the suite catalog</Link>.
                </p>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The three steps from a connected agent to its first report, shown until the first run exists.
 * Each step states what is true from stored rows and links to the one place it is done.
 */
export function SetupSteps({ agentId, connection, policyVersion, hasRun, canRun }: {
  agentId: string;
  connection: "answered" | "failed" | "unchecked";
  policyVersion: number | null;
  hasRun: boolean;
  canRun: boolean;
}) {
  const steps = [
    {
      title: "Connection",
      done: connection === "answered",
      detail: connection === "answered" ? "The agent answered the connection check."
        : connection === "failed" ? "The agent did not answer the last check. Open Connection to see what it returned and correct it."
          : "Not checked yet.",
      href: `/agents/${agentId}?tab=connection`,
      action: connection === "answered" ? "See the receipt" : "Fix the connection",
    },
    {
      title: "Policy",
      done: policyVersion !== null,
      detail: policyVersion !== null ? `Version ${policyVersion} is saved; every run names the version it was graded under.`
        : "Write the rules this agent is held to, or start from a common set and replace the placeholders. A run has to name a policy version.",
      href: `/agents/${agentId}?tab=policy`,
      action: policyVersion !== null ? "Read or change it" : "Write the policy",
    },
    {
      title: "First run",
      done: hasRun,
      detail: hasRun ? "A run has been started."
        : policyVersion === null ? "Available once a policy version is saved."
          : canRun ? "Read what the suite tests below, then press Run the suite at the top of this page."
            : "A run needs a plan in force; the top of this page says how.",
      href: hasRun ? `/agents/${agentId}?tab=runs` : `/agents/${agentId}#what-each-suite-tests`,
      action: hasRun ? "See the runs" : "See what the suite tests",
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <section aria-labelledby="setup-steps-heading" className="mb-6 rounded-panel border border-line bg-surface p-5 shadow-card">
      <h2 id="setup-steps-heading" className="type-h3">Three steps to the first report</h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            aria-current={i === current ? "step" : undefined}
            className={`rounded-control border p-3 text-sm ${step.done ? "border-pass-border bg-pass-surface" : i === current ? "border-ink bg-ground/60" : "border-line"}`}
          >
            <p className="flex items-center gap-2 font-medium text-ink">
              <span className="tnum grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-xs">{i + 1}</span>
              {step.title}
              <span className={`ml-auto text-xs font-medium ${step.done ? "text-pass-text" : "text-ink-faint"}`}>{step.done ? "Done" : i === current ? "Next" : "Later"}</span>
            </p>
            <p className="mt-1.5 leading-relaxed text-ink-soft">{step.detail}</p>
            <Link href={step.href} className="mt-2 inline-block text-sm font-medium text-ink underline underline-offset-2">{step.action}</Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
