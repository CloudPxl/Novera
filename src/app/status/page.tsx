import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { currentUser } from "@/lib/auth/session.ts";
import { currentStatus, overall, type ComponentState } from "@/lib/status/status.ts";

export const metadata: Metadata = {
  title: "Status · Novera",
  description: "The state of Novera's components, as last set by the operator.",
};
// Per request, like every page: the CSP nonce comes from the request (src/proxy.ts).
export const dynamic = "force-dynamic";

const LABEL: Record<ComponentState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  maintenance: "Maintenance",
  unknown: "Not set",
};

// Unknown is neutral, not green: a state nobody set is not good news.
const CHIP: Record<ComponentState, string> = {
  operational: "border-pass-border bg-pass-surface text-pass-text",
  degraded: "border-warning-border bg-warning-surface text-warning-text",
  maintenance: "border-info-border bg-info-surface text-info-text",
  unknown: "border-dashed border-neutral-border bg-neutral-surface text-neutral-text",
};

function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * The public status page. Every state on it was set by a person (data/status.json or
 * NOVERA_STATUS_JSON) and the page says so first: it is not monitoring, it measures nothing,
 * and it makes no uptime or availability promise.
 */
export default async function StatusPage() {
  const signedIn = Boolean(await currentUser());
  const page = currentStatus();
  const summary = overall(page);

  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-4 py-10 text-ink sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight">Status</h1>

        <p className="mt-4 rounded-control border border-line bg-sunken px-4 py-3 text-sm leading-relaxed text-ink-soft">
          <strong className="font-semibold text-ink">Set by hand, not measured.</strong>{" "}
          Each state below is updated manually by the person operating Novera. This page is not
          automated monitoring, it can lag behind what is happening, and it is not a promise of
          uptime or availability.
        </p>

        <p className="mt-8 text-lg font-medium">{summary.sentence}</p>
        <p className="mt-1 text-sm text-ink-faint">
          {page.updatedAt ? <>Last updated <time dateTime={page.updatedAt}>{formatUtc(page.updatedAt)}</time>.</> : "No update time recorded."}
        </p>

        {page.notice && (
          <p className="mt-5 rounded-control border border-info-border bg-info-surface px-4 py-3 text-sm leading-relaxed text-info-text">{page.notice}</p>
        )}
        {page.problem && (
          <p className="mt-5 rounded-control border border-warning-border bg-warning-surface px-4 py-3 text-sm leading-relaxed text-warning-text">
            The status could not be read, so every component is shown as not set.
          </p>
        )}

        <ul className="mt-8 divide-y divide-line border-y border-line">
          {page.components.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <h2 className="font-semibold">{c.name}</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{c.description}</p>
                {c.note && <p className="mt-2 text-sm leading-relaxed text-ink">{c.note}</p>}
              </div>
              <span className={`inline-flex w-fit shrink-0 items-center rounded-control border px-2.5 py-1 text-sm font-semibold ${CHIP[c.state]}`}>
                {LABEL[c.state]}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-sm leading-relaxed text-ink-faint">
          A run that could not finish is never sealed as a report, whatever this page says. Something
          not listed here? <Link href="/support" className="underline underline-offset-2 hover:text-ink">Contact support</Link>.
        </p>
      </main>
    </>
  );
}
