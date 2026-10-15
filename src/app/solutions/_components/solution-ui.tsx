import { LogoMark } from "@/components/ui/logo.tsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { JsonLd } from "@/components/seo/json-ld.tsx";
import { breadcrumbLd } from "@/lib/seo/json-ld.ts";
import { REPORT_NOTICE_SHORT, REPORT_NOTICE_TITLE } from "@/lib/legal/notices.ts";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { SOLUTIONS, SOLUTIONS_INDEX, type SolutionSlug } from "./content.ts";

/**
 * The parts every solution page is built from, in the home page's voice (docs/DESIGN.md):
 * a 1440 frame with text held to a reading measure, numbered section heads, paper bands for
 * alternate sections, ink actions and no accent on a button.
 *
 * Nothing here animates. These pages are read, not toured, and every block is in its finished
 * state as the server sent it — with or without JavaScript.
 */

/** The report's one-line notice without its title, which the block shows as its label. */
const NOTICE_BODY = REPORT_NOTICE_SHORT.replace(/^Testing evidence, not certification: (\w)/, (_, first: string) => first.toUpperCase());

export const SIGNUP_HREF = "/sign-in?mode=signup";
export const SIGNUP_LABEL = "Start with three free runs";

interface Action { href: string; label: string }

/** Header, `<main id="main">` (the skip link's target), cross-links and footer. */
export function SolutionFrame({ signedIn, current, children }: { signedIn: boolean; current?: SolutionSlug; children: ReactNode }) {
  const page = SOLUTIONS.find((s) => s.slug === current);
  const crumbs = [{ name: "Novera", path: "/" }, { name: "Solutions", path: SOLUTIONS_INDEX.path }];
  if (page) crumbs.push({ name: page.name, path: page.path });
  return (
    <div className="bg-surface text-ink">
      <JsonLd data={breadcrumbLd(crumbs)} />
      <SiteHeader signedIn={signedIn} />
      <main id="main">
        {children}
        {current && <OtherSolutions current={current} />}
      </main>
      <SolutionsFooter />
    </div>
  );
}

/**
 * The first screen: where this page sits, one H1, a lead, one primary action and a quiet
 * secondary one, and up to four facts the product produces today.
 */
export function Hero({
  eyebrow, title, lead, signedIn, primary, secondary, facts, crumb,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  signedIn: boolean;
  primary: Action;
  secondary: Action;
  facts: Array<[string, string]>;
  crumb?: string;
}) {
  const action = signedIn ? { href: "/dashboard", label: "Open your dashboard" } : primary;
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div aria-hidden className="bg-blueprint pointer-events-none absolute inset-0" />
      <div className="wrap-wide relative py-14 sm:py-20 lg:py-24">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 type-eyebrow text-ink-faint">
            <li><Link href="/" className="rounded-control underline-offset-2 hover:text-ink hover:underline">Novera</Link></li>
            <li aria-hidden>/</li>
            <li>
              {crumb ? (
                <Link href={SOLUTIONS_INDEX.path} className="rounded-control underline-offset-2 hover:text-ink hover:underline">Solutions</Link>
              ) : (
                <span aria-current="page">Solutions</span>
              )}
            </li>
            {crumb && (
              <>
                <li aria-hidden>/</li>
                <li><span aria-current="page">{crumb}</span></li>
              </>
            )}
          </ol>
        </nav>
        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:items-end lg:gap-16">
          <div>
            <p className="type-eyebrow text-ink-faint">{eyebrow}</p>
            <h1 className="mt-5 max-w-4xl type-display">{title}</h1>
            <p className="mt-6 measure type-lede text-ink-soft">{lead}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href={action.href} className="px-5 py-3 text-[15px]">{action.label}</ButtonLink>
              <ButtonLink href={secondary.href} variant="secondary" className="px-5 py-3 text-[15px]">{secondary.label}</ButtonLink>
            </div>
            {!signedIn && <p className="mt-4 text-sm text-ink-faint">No card. About ten minutes to a first report.</p>}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-6 lg:grid-cols-1 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-sm font-semibold text-ink tnum">{k}</dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-ink-faint">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** A numbered section with its heading and lede beside it on wide screens, as on the home page. */
export function Section({
  index, id, title, lede, paper = false, children,
}: { index: string; id: string; title: string; lede: ReactNode; paper?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`border-b border-line ${paper ? "bg-paper" : ""}`}>
      <div className="wrap-wide py-16 sm:py-20">
        <div className="grid gap-x-12 gap-y-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <div>
            <div className="flex items-center gap-3">
              <span className="type-eyebrow text-ink-faint">{index}</span>
              <span aria-hidden className="h-px w-10 bg-line-strong" />
            </div>
            <h2 id={id} className="mt-4 max-w-3xl type-section">{title}</h2>
          </div>
          <p className="measure type-lede text-ink-soft lg:pb-1.5">{lede}</p>
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

export interface CardItem { title: string; body: ReactNode; tag?: string; note?: string }

/** Micro-cards: a title, one or two sentences, and an optional mono tag (a reference, a count). */
export function Cards({ items, columns = 2 }: { items: CardItem[]; columns?: 2 | 3 | 4 }) {
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4" }[columns];
  return (
    <ul className={`grid gap-4 ${grid}`}>
      {items.map((c) => (
        <li key={c.title} className="flex flex-col rounded-panel border border-line bg-surface p-5 shadow-card">
          {c.tag && <p className="type-eyebrow text-ink-faint">{c.tag}</p>}
          <h3 className={`${c.tag ? "mt-3" : ""} text-base font-semibold`}>{c.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{c.body}</p>
          {c.note && <p className="mt-auto pt-4 font-mono text-xs text-ink-faint tnum">{c.note}</p>}
        </li>
      ))}
    </ul>
  );
}

/** A short list: a bold lead-in and its sentence, one per line. */
export function Points({ items, columns = 1 }: { items: Array<[string, ReactNode]>; columns?: 1 | 2 }) {
  return (
    <ul className={`grid gap-x-10 gap-y-4 text-sm leading-relaxed ${columns === 2 ? "md:grid-cols-2" : "max-w-3xl"}`}>
      {items.map(([t, b]) => (
        <li key={t} className="flex gap-3">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
          <p><span className="font-semibold text-ink">{t}</span> <span className="text-ink-soft">{b}</span></p>
        </li>
      ))}
    </ul>
  );
}

/** Numbered stages in order, joined by a rule on wide screens. */
export function Stages({ items }: { items: Array<{ name: string; body: ReactNode; outcome: string }> }) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {items.map((s, i) => (
        <li key={s.name} className="flex flex-col rounded-panel border border-line bg-surface p-5 shadow-card">
          <span className="grid size-[2.125rem] place-items-center rounded-full border border-line-strong font-mono text-xs font-semibold text-ink">
            {String(i + 1).padStart(2, "0")}
          </span>
          <h3 className="mt-4 text-base font-semibold">{s.name}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{s.body}</p>
          <p className="mt-auto border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">{s.outcome}</p>
        </li>
      ))}
    </ol>
  );
}

/** The five exit codes a sealed report carries, as the home page draws them. */
export function ExitCodes() {
  return (
    <div className="overflow-hidden rounded-shell border border-ink/90 bg-ink text-on-ink">
      <p className="border-b border-white/10 px-4 py-2.5 font-mono text-[11px] text-white/70">Exit codes, read from the counts sealed in the report</p>
      <dl className="grid grid-cols-5 text-center font-mono text-[11px]">
        {[["0", "pass"], ["1", "fail"], ["2", "incomplete"], ["3", "config"], ["4", "infra"]].map(([c, m]) => (
          <div key={c} className="border-r border-white/10 px-1 py-3 last:border-r-0">
            <dt className="text-sm font-semibold text-white">{c}</dt>
            <dd className="text-white/70">{m}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * "What Novera is not": the standing notice every report carries (src/lib/legal/notices.ts),
 * word for word, with the page's own limits beside it.
 */
export function NotCertification({ items }: { items: Array<[string, string]> }) {
  return (
    <section aria-labelledby="not-heading" className="border-b border-line">
      <div className="wrap-wide grid gap-8 py-16 sm:py-20 md:grid-cols-3 md:gap-10">
        <div>
          <h2 id="not-heading" className="type-section text-[1.75rem]">What Novera is not</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">A document that overstates itself is worth less — especially to the person you hand it to.</p>
        </div>
        <div className="md:col-span-2">
          <div className="rounded-panel border border-line-strong bg-paper p-5">
            <p className="type-eyebrow text-ink-faint">{REPORT_NOTICE_TITLE}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink">{NOTICE_BODY}</p>
          </div>
          <ul className="mt-6 grid gap-3 text-sm leading-relaxed text-ink-soft sm:grid-cols-2 sm:gap-x-10">
            {items.map(([t, b]) => (
              <li key={t} className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
                <p><span className="font-semibold text-ink">{t}</span> {b}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-ink-faint">
            Every report carries the same notice and its own scope and limitations.{" "}
            <Link href="/docs/limitations" className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">Read the limits in full.</Link>
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * A callout placed near the top of a page that maps evidence to legal references: the report's
 * notice title as its label, then what the mapping is and is not. Drawn as loudly as the content
 * it qualifies — not a footnote.
 */
export function MappingNotice({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="mapping-notice-heading" className="border-b border-line bg-paper">
      <div className="wrap-wide py-8">
        <div className="rounded-panel border border-line-strong bg-surface p-5 sm:p-6">
          <p id="mapping-notice-heading" className="type-eyebrow text-ink-faint">{REPORT_NOTICE_TITLE}</p>
          <div className="mt-2 max-w-4xl space-y-2 text-sm leading-relaxed text-ink">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** The closing call to action, on the blueprint ground like the home page's. */
export function ClosingCta({ signedIn, title, lede, secondary }: { signedIn: boolean; title: string; lede: ReactNode; secondary: Action }) {
  return (
    <section aria-labelledby="cta-heading" className="relative overflow-hidden border-b border-line">
      <div aria-hidden className="bg-blueprint pointer-events-none absolute inset-0" />
      <div className="wrap relative py-20 text-center sm:py-24">
        <h2 id="cta-heading" className="type-section">{title}</h2>
        <p className="mx-auto mt-5 measure type-lede text-ink-soft">{lede}</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href={signedIn ? "/dashboard" : SIGNUP_HREF} className="px-6 py-3 text-[15px]">
            {signedIn ? "Open your dashboard" : SIGNUP_LABEL}
          </ButtonLink>
          <ButtonLink href={secondary.href} variant="secondary" className="px-6 py-3 text-[15px]">{secondary.label}</ButtonLink>
        </div>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink-faint">
          <li>No card</li>
          <li>Email, Google or GitHub</li>
          <li>Database in Frankfurt (EU)</li>
        </ul>
      </div>
    </section>
  );
}

/** The other solution pages, so a reader who came in on one finds the rest. */
function OtherSolutions({ current }: { current: SolutionSlug }) {
  return (
    <nav aria-labelledby="more-heading" className="bg-paper">
      <div className="wrap-wide py-14">
        <h2 id="more-heading" className="type-eyebrow text-ink-faint">Also on Novera</h2>
        <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SOLUTIONS.filter((s) => s.slug !== current).map((s) => (
            <li key={s.slug}>
              <Link href={s.path} className="novera-lift group flex h-full flex-col rounded-panel border border-line bg-surface p-5 shadow-card transition-[transform,box-shadow,border-color] duration-150">
                <span className="text-base font-semibold group-hover:underline group-hover:underline-offset-2">{s.name}</span>
                <span className="mt-1.5 text-sm leading-relaxed text-ink-soft">{s.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** The home page's footer, with the solution pages added as their own column. */
function SolutionsFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="wrap-wide grid gap-8 py-12 text-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        <div>
          <p className="flex items-center gap-1 font-semibold"><LogoMark className="size-7" />Novera</p>
          <p className="mt-3 max-w-xs leading-relaxed text-ink-faint">Evidence that an AI support agent behaves as its written policy requires. Database in Frankfurt (EU).</p>
        </div>
        <FooterCol title="Solutions" links={[["All solutions", SOLUTIONS_INDEX.path], ...SOLUTIONS.map((s): [string, string] => [s.name, s.path])]} />
        <FooterCol title="Product" links={[["How it works", "/#how-it-works"], ["Step-by-step guide", "/guide"], ["Sign in", "/sign-in"]]} />
        <FooterCol title="Documentation" links={[["All documentation", "/docs"], ["Data and privacy", "/docs/data-and-privacy"], ["Limitations", "/docs/limitations"], ["CLI and CI", "/docs/cli-and-ci"]]} />
        <FooterCol title="People" links={[["Support", "/support"], ["Talk to us first", "/apply"]]} />
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <nav aria-label={title}>
      <p className="type-eyebrow text-ink-faint">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={href}><Link href={href} className="text-ink-soft underline-offset-2 hover:text-ink hover:underline">{label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
