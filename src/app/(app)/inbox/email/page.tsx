import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff.ts";
import { mailDiagnostics } from "@/lib/mail/diagnostics.ts";
import { LIFECYCLE_EVENTS, TEMPLATE_IDS, TEMPLATE_VERSION } from "@/lib/mail/templates.ts";
import { Badge, Card } from "@/components/ui/primitives.tsx";

export const metadata: Metadata = { title: "Email setup · Novera", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Row({ label, value, tone }: { label: string; value: string; tone: "pass" | "fail" | "neutral" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd><Badge tone={tone}>{value}</Badge></dd>
    </div>
  );
}

/**
 * Whether this server can send email, for staff. Read from the environment only: no secret is
 * shown, no network call is made, and nothing on this page sends (src/lib/mail/diagnostics.ts).
 */
export default async function EmailSetupPage() {
  await requireStaff();
  const d = mailDiagnostics();

  return (
    <main className="w-full max-w-3xl py-8 text-ink">
      <Link href="/inbox" className="text-sm text-ink-faint underline-offset-2 hover:underline">← Inbox</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Email setup</h1>
      <p className="mt-1 text-sm text-ink-soft">
        What this server ({d.environment}) can tell about sending email. No key is shown, and nothing here sends.
        Delivery is proven only by a message arriving: follow <span className="type-mono">docs/setup/email-checklist.md</span>.
      </p>

      <section aria-labelledby="config-heading" className="mt-8">
        <h2 id="config-heading" className="text-lg font-semibold tracking-tight">This server</h2>
        <Card className="mt-3 px-5 py-2">
          <dl className="divide-y divide-line">
            <Row label="RESEND_API_KEY" value={!d.resendKey.present ? "missing" : d.resendKey.shape === "re_" ? "present, re_ shape" : "present, unexpected shape"} tone={d.resendKey.shape === "re_" ? "pass" : "fail"} />
            <Row label="RESEND_FROM_EMAIL" value={!d.from.present ? "missing" : d.from.domain ? `at ${d.from.domain}` : "not an address"} tone={d.from.matchesExpected ? "pass" : "fail"} />
            <Row label="NEXT_PUBLIC_APP_URL" value={d.appUrl.origin ?? (d.appUrl.present ? "not a URL" : "missing")} tone={d.appUrl.origin ? "neutral" : "fail"} />
            <Row label="Canonical host" value={d.canonicalHost} tone="neutral" />
            <Row label="App URL is the canonical host" value={d.appUrlIsCanonical === null ? "no app URL" : d.appUrlIsCanonical ? "yes" : "no"} tone={d.appUrlIsCanonical ? "pass" : "neutral"} />
            <Row label="Staff addresses configured" value={String(d.staffConfigured)} tone="neutral" />
            <Row label="Lifecycle emails (NOVERA_LIFECYCLE_EMAILS)" value={d.lifecycleEmails ? "on (nothing calls a sender yet)" : "off"} tone="neutral" />
          </dl>
        </Card>
        {d.problems.length > 0 ? (
          <div role="alert" className="mt-3 rounded-lg border border-fail-border bg-fail-surface p-4 text-sm leading-relaxed text-fail-text">
            <p className="font-medium">To fix, in order:</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">{d.problems.map((p) => <li key={p}>{p}</li>)}</ol>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">Nothing this server can check is wrong. That is not proof of delivery.</p>
        )}
        <h3 className="mt-6 text-sm font-semibold">Not readable from here</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">{d.unreadable.map((u) => <li key={u}>{u}</li>)}</ul>
      </section>

      <section aria-labelledby="templates-heading" className="mt-10">
        <h2 id="templates-heading" className="text-lg font-semibold tracking-tight">Templates</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Rendered with sample data. Lifecycle templates have no sender: they wait on your approval after SMTP is verified.
        </p>
        <Card className="mt-3 p-0">
          <ul className="divide-y divide-line">
            {TEMPLATE_IDS.map((id) => {
              const event = Object.entries(LIFECYCLE_EVENTS).find(([, e]) => e.template === id);
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <Link href={`/inbox/email/preview?template=${encodeURIComponent(id)}`} className="font-medium underline underline-offset-2">{id}</Link>
                  <span className="flex items-center gap-2 text-xs text-ink-faint">
                    v{TEMPLATE_VERSION[id]}
                    {id.startsWith("auth.") && <Badge tone="neutral">paste into Supabase</Badge>}
                    {event && <Badge tone="neutral">{event[1].basis === "consent" ? "needs opt-in" : "service, opt-out"} · not sent</Badge>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </section>
    </main>
  );
}
