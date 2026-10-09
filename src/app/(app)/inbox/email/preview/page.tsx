import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff.ts";
import { requireUser } from "@/lib/auth/session.ts";
import { isTemplateId, PREVIEWS, TEMPLATE_IDS } from "@/lib/mail/templates.ts";
import { Card } from "@/components/ui/primitives.tsx";

export const metadata: Metadata = { title: "Email preview · Novera", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One template with fake sample data. This page imports no sender, so it cannot send; it only
 * renders. In production only staff may open it; in local development any signed-in person.
 * The HTML part is shown in a sandboxed frame with scripts off, and as source.
 */
export default async function EmailPreviewPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  if (process.env.NODE_ENV === "production") await requireStaff();
  else await requireUser();
  const { template } = await searchParams;
  const id = isTemplateId(template) ? template : TEMPLATE_IDS[0];
  const email = PREVIEWS[id]();

  return (
    <main className="w-full max-w-4xl py-8 text-ink">
      <Link href="/inbox/email" className="text-sm text-ink-faint underline-offset-2 hover:underline">← Email setup</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Preview: {id}</h1>
      <p className="mt-1 text-sm text-ink-soft">Sample data only. Nothing on this page sends.</p>

      <nav aria-label="Templates" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {TEMPLATE_IDS.map((t) => (
          <Link key={t} href={`/inbox/email/preview?template=${encodeURIComponent(t)}`} aria-current={t === id ? "page" : undefined}
            className={t === id ? "font-semibold text-ink" : "text-ink-soft underline underline-offset-2 hover:text-ink"}>{t}</Link>
        ))}
      </nav>

      <Card className="mt-6 p-5">
        <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-ink-faint">Subject</dt><dd className="break-words font-medium">{email.subject}</dd>
          <dt className="text-ink-faint">Version</dt><dd>v{email.version}</dd>
        </dl>
      </Card>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">HTML</h2>
      <iframe title={`HTML part of ${id}`} sandbox="" srcDoc={email.html} className="mt-3 h-[560px] w-full rounded-lg border border-line bg-surface" />
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-ink-soft hover:text-ink">HTML source</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sunken p-3 text-xs">{email.html}</pre>
      </details>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">Plain text</h2>
      {email.text ? (
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-4 text-sm">{email.text}</pre>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">Supabase sends the HTML part only; it has no plain-text field for this template.</p>
      )}
    </main>
  );
}
