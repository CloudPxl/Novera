import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site.ts";
import Link from "next/link";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { currentUser } from "@/lib/auth/session.ts";
import { ExplainTrigger } from "@/components/ui/explain-trigger.tsx";
import { currentStatus, type ComponentState } from "@/lib/status/status.ts";
import { getHealth, OVERALL_SENTENCE, type HealthReport, type Level } from "@/lib/observability/health.ts";

export const metadata: Metadata = pageMetadata({
  title: "Status",
  description: "Whether Novera's web application, database, evaluation runner and grading are working, checked when the page is loaded.",
  path: "/status",
});
// Per request, like every page: the CSP nonce comes from the request (src/proxy.ts). The
// check itself is reused for 30 seconds per instance (src/lib/observability/health.ts).
export const dynamic = "force-dynamic";

const LEVEL_LABEL: Record<Level, string> = { ok: "Operational", degraded: "Degraded", down: "Down" };
const LEVEL_CHIP: Record<Level, string> = {
  ok: "border-pass-border bg-pass-surface text-pass-text",
  degraded: "border-warning-border bg-warning-surface text-warning-text",
  down: "border-fail-border bg-fail-surface text-fail-text",
};

const HAND_LABEL: Record<ComponentState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  maintenance: "Maintenance",
  unknown: "Not set",
};
// Unknown is neutral, not green: a state nobody set is not good news.
const HAND_CHIP: Record<ComponentState, string> = {
  operational: "border-pass-border bg-pass-surface text-pass-text",
  degraded: "border-warning-border bg-warning-surface text-warning-text",
  maintenance: "border-info-border bg-info-surface text-info-text",
  unknown: "border-dashed border-neutral-border bg-neutral-surface text-neutral-text",
};

function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

interface Row {
  id: string;
  name: string;
  description: string;
  level: Level;
  /** What the check found, in words. No counts of the platform's activity. */
  finding: string;
}

/** The measured components, from the report the health endpoint serves. */
function rowsOf(h: HealthReport): Row[] {
  const dbUp = h.checks.database.status === "ok";
  return [
    {
      id: "web",
      name: "Web application and public verification",
      description: "Pages, sign-in and the public seal check at /verify.",
      // This page rendering proves the web application is serving. The seal check reads one
      // report from the database, so it is only as available as the database is.
      level: dbUp ? "ok" : "degraded",
      finding: dbUp
        ? "This page was served, and the seal check can read a report."
        : "Pages are served, but the seal check cannot read a report while the database is unreachable.",
    },
    {
      id: "database",
      name: "Database and evidence storage",
      description: "Frankfurt, eu-central-1. Holds every run, report and the append-only evidence.",
      level: h.checks.database.status,
      finding: dbUp
        ? `Answered in ${h.checks.database.latency_ms} ms.`
        : "Did not answer within the deadline.",
    },
    {
      id: "runner",
      name: "Evaluation runner",
      description: "Starts and advances runs. A run that makes no progress for 15 minutes counts as stalled.",
      level: h.checks.runner.status,
      finding: h.checks.runner.status === "ok"
        ? "No run is waiting without progress."
        : h.checks.runner.status === "degraded"
          ? "A run has made no progress for over 15 minutes. A run that cannot finish is never sealed as a report."
          : "Cannot be checked while the database is unreachable.",
    },
    {
      id: "grading",
      name: "Multi-vendor grading",
      description: "Verdicts come from models of different vendors. This checks that two or more are configured, not that a provider is up right now.",
      level: h.checks.grading.status,
      finding: h.checks.grading.status === "ok"
        ? "Two or more grading vendors are configured."
        : "Fewer than two grading vendors are configured. Verdicts are labelled as corroborated within one vendor, or not corroborated.",
    },
  ];
}

/**
 * The public status page. The four components at the top are checked when the page loads, by the
 * same function that serves /api/health. Below them, the few things a person has to say by hand
 * (data/status.json) are kept apart and labelled as not measured. The page promises no uptime or
 * availability figure: it reports what the check found at the time shown.
 */
export default async function StatusPage() {
  const signedIn = Boolean(await currentUser());
  const health = await getHealth();
  const rows = rowsOf(health);
  const hand = currentStatus();
  const handRows = hand.components.filter((c) => c.id === "email" || c.id === "scheduled_jobs");

  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-4 py-10 text-ink sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight">Status</h1>

        <p role="status" className={`mt-6 inline-flex items-center rounded-control border px-3 py-1.5 text-lg font-semibold ${LEVEL_CHIP[health.status]}`}>
          {OVERALL_SENTENCE[health.status]}
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          Checked <time dateTime={health.checked_at}>{formatUtc(health.checked_at)}</time> when this page was loaded; a check is reused for up to 30 seconds.
          Not a promise of uptime or availability.
        </p>

        <ul aria-label="Components" className="mt-6 divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <h2 className="font-semibold">{r.name}</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{r.description}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink">{r.finding}</p>
              </div>
              <span className={`inline-flex w-fit shrink-0 items-center rounded-control border px-2.5 py-1 text-sm font-semibold ${LEVEL_CHIP[r.level]}`}>
                {LEVEL_LABEL[r.level]}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-x-1.5 text-sm leading-relaxed text-ink-soft">
          Your agent is not on this list. A result of &ldquo;agent unreachable&rdquo; is about your agent&apos;s endpoint, not about Novera.
          <ExplainTrigger id="status_scope" />
        </div>

        {hand.notice && (
          <p className="mt-6 rounded-control border border-info-border bg-info-surface px-4 py-3 text-sm leading-relaxed text-info-text">{hand.notice}</p>
        )}

        <h2 className="mt-10 text-lg font-semibold">Set by hand, not measured</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          {hand.problem
            ? "The hand-written status could not be read, so these are shown as not set."
            : <>Updated by the person operating Novera{hand.updatedAt ? <> on <time dateTime={hand.updatedAt}>{formatUtc(hand.updatedAt)}</time></> : null}. These can lag behind what is happening.</>}
        </p>
        <ul aria-label="Components set by hand" className="mt-3 divide-y divide-line border-y border-line">
          {handRows.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <h3 className="font-semibold">{c.name}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{c.description}</p>
                {c.note && <p className="mt-2 text-sm leading-relaxed text-ink">{c.note}</p>}
              </div>
              <span className={`inline-flex w-fit shrink-0 items-center rounded-control border px-2.5 py-1 text-sm font-semibold ${HAND_CHIP[c.state]}`}>
                {HAND_LABEL[c.state]}
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
