import Link from "next/link";
import { GUIDE_STEPS, type GuideTarget } from "@/lib/guide/content.ts";

/**
 * The full step-by-step instructions, on the page people land on after signing in.
 *
 * Open until the workspace has done all four setup steps, then one click away — the
 * instructions stay available rather than vanishing the moment someone is "done". Each
 * step links to the exact place in *this* workspace where it happens.
 */
export function GuidePanel({
  open,
  firstAgentId,
  latestRunId,
}: {
  open: boolean;
  firstAgentId?: string;
  latestRunId?: string;
}) {
  const hrefFor = (target: GuideTarget): { href: string; label: string } => {
    if (target === "connect") return { href: "/agents/new", label: "Connect an agent" };
    if (target === "agent") {
      return firstAgentId
        ? { href: `/agents/${firstAgentId}`, label: "Open your agent" }
        : { href: "/agents/new", label: "Connect an agent first" };
    }
    if (latestRunId) return { href: `/runs/${latestRunId}`, label: "Open your latest run" };
    return firstAgentId
      ? { href: `/agents/${firstAgentId}`, label: "Run the suite first" }
      : { href: "/agents/new", label: "Connect an agent first" };
  };

  return (
    <details open={open} className="group mt-8 rounded-xl border border-line bg-surface shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span>
          <h2 className="type-h2">How to use Novera, step by step</h2>
          <span className="mt-0.5 block text-sm text-ink-soft">
            Seven steps from a connected agent to a report you can hand to a client.
          </span>
        </span>
        <span aria-hidden="true" className="text-xl leading-none text-ink-soft transition-transform duration-150 group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ol className="space-y-5 border-t border-line px-5 py-5">
        {GUIDE_STEPS.map((step, i) => {
          const go = hrefFor(step.target);
          return (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-on-ink"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{step.body}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-ink-faint">Where: {step.where}</span>
                  <Link href={go.href} className="font-medium text-ink underline underline-offset-2">
                    {go.label} →
                  </Link>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-line px-5 py-3 text-sm text-ink-soft">
        Unsure what a word means? The <Link href="/guide" className="font-medium text-ink underline underline-offset-2">full guide</Link> has a
        glossary, and every heading in the app has a <span className="font-semibold">?</span> beside it.
      </p>
    </details>
  );
}
