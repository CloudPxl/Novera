import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { pageMetadata } from "@/lib/seo/site.ts";
import { hasSessionCookie } from "@/app/verify/session-cookie.ts";
import { BOT_TOKEN, NAV_TIMEOUT_MS, PACING_MS, REPLY_TIMEOUT_MS, USER_AGENT } from "@/lib/insight/protocol.ts";
import { INSIGHT_SUITE } from "@/lib/insight/suite.ts";

export const metadata: Metadata = pageMetadata({
  title: "NoveraInsightBot",
  description: "What Novera's browser worker is, what it does on a public chat widget, the limits it keeps, and how to keep it off a site.",
  path: "/bot",
});

export const dynamic = "force-dynamic";

/**
 * The page the worker's User-Agent names. Every number on it is read from the worker's own
 * constants (src/lib/insight/protocol.ts) and suite, so the page cannot drift from what it does.
 */
export default async function BotPage() {
  const prompts = INSIGHT_SUITE.cases.length;
  return (
    <>
      <SiteHeader signedIn={await hasSessionCookie()} />
      <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-4 py-10 text-ink sm:px-8">
        <p className="type-eyebrow text-ink-faint">Crawler information</p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">{BOT_TOKEN}</h1>
        <p className="mt-4 measure text-base leading-relaxed text-ink-soft">
          {BOT_TOKEN} is Novera&rsquo;s browser worker. It opens a public chat widget that a company offers to anyone,
          types a short, fixed set of questions into it, and records what the widget displayed, so that Novera can describe how
          the assistant behaves. It identifies itself on every request as:
        </p>
        <p className="mt-3 overflow-x-auto rounded-control border border-line bg-ground/60 px-3 py-2 font-mono text-sm [overflow-wrap:anywhere]">{USER_AGENT}</p>

        <section aria-labelledby="limits-heading" className="mt-8">
          <h2 id="limits-heading" className="text-lg font-semibold">What it does, and the limits it keeps</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>It reads the site&rsquo;s robots.txt first, and does not open a page that robots.txt closes to it or to every crawler.</li>
            <li>It sends at most {prompts} questions to a site in one scan, one at a time, at least {PACING_MS / 1000} seconds apart, and the same site at most once a day.</li>
            <li>Each question starts a fresh browser session. It never runs two sessions on a site at once, and it never sends a question twice.</li>
            <li>The questions are ordinary customer questions: what the assistant is for, whether it is a person or a bot, what it will not disclose. None asks it to take an action, and none contains an exploit.</li>
            <li>It stops at once, before typing anything, if the page shows a bot challenge, if the widget asks for a login or a password, or if it shows a payment field. It never attempts a challenge.</li>
            <li>It does not create accounts, sign in, buy, book, cancel, request refunds, or fill in any form other than the chat box. On a cookie banner it presses the plain acceptance button once.</li>
            <li>It does not follow the page to another site. It waits at most {NAV_TIMEOUT_MS / 1000} seconds for a page and {REPLY_TIMEOUT_MS / 1000} seconds for a reply.</li>
            <li>What it captures is redacted for e-mail addresses, phone numbers and similar data before it is stored, and it is not published.</li>
          </ul>
        </section>

        <section aria-labelledby="optout-heading" className="mt-8">
          <h2 id="optout-heading" className="text-lg font-semibold">Keeping it off a site</h2>
          <p className="mt-2 measure text-sm leading-relaxed text-ink-soft">Add this to the site&rsquo;s robots.txt:</p>
          <pre className="mt-2 overflow-x-auto rounded-control border border-line bg-ground/60 px-3 py-2 font-mono text-sm">{`User-agent: ${BOT_TOKEN}\nDisallow: /`}</pre>
          <p className="mt-3 measure text-sm leading-relaxed text-ink-soft">
            It is read before every scan. To ask Novera not to contact or test a company at all, write through the{" "}
            <Link href="/support" className="font-medium underline underline-offset-2">support page</Link>; the company is then marked
            &ldquo;do not contact&rdquo;, and that mark is never withdrawn.
          </p>
        </section>
      </main>
    </>
  );
}
