import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link.tsx";

const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#evidence", label: "The report" },
  { href: "/#trust", label: "Data and limits" },
  { href: "/docs", label: "Documentation" },
];

/**
 * The public top bar. Sticky and lightly glassed — the one place content scrolls under
 * it (docs/DESIGN.md) — with the same mark as the operator shell, so the two read as one
 * product.
 *
 * The phone menu is a `<details>`: it opens and closes with no JavaScript, is announced
 * as a disclosure by every screen reader, and needs no focus-trap code that could break.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/85 backdrop-blur">
      <div className="wrap-wide flex h-16 items-center gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-control">
          <span aria-hidden className="grid size-8 place-items-center rounded-control bg-ink text-sm font-bold text-on-ink">N</span>
          <span className="text-[15px] font-semibold tracking-tight">Novera</span>
          <span className="sr-only">home</span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-line xl:block" />
        <p className="hidden type-eyebrow text-ink-faint xl:block">Evidence-first agent testing</p>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-control px-3 py-2 text-sm font-medium text-ink-soft transition-colors duration-150 hover:bg-sunken hover:text-ink">
              {l.label}
            </Link>
          ))}
          <span aria-hidden className="mx-2 h-5 w-px bg-line" />
          {signedIn ? (
            <ButtonLink href="/dashboard" size="sm">Open your dashboard</ButtonLink>
          ) : (
            <>
              <Link href="/sign-in" className="rounded-control px-3 py-2 text-sm font-medium text-ink-soft transition-colors duration-150 hover:bg-sunken hover:text-ink">Sign in</Link>
              <ButtonLink href="/sign-in" size="sm">Start free</ButtonLink>
            </>
          )}
        </nav>

        <details className="group relative ml-auto md:hidden">
          <summary className="novera-press flex cursor-pointer list-none items-center gap-2 rounded-control border border-line-strong px-3 py-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            <span>Menu</span>
            <span aria-hidden className="relative block h-2.5 w-3.5">
              <span className="absolute inset-x-0 top-0 h-px bg-ink transition-transform duration-200 group-open:translate-y-[5px] group-open:rotate-45" />
              <span className="absolute inset-x-0 bottom-0 h-px bg-ink transition-transform duration-200 group-open:-translate-y-[4px] group-open:-rotate-45" />
            </span>
          </summary>
          <div className="novera-drawer absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-2 shadow-modal">
            <nav aria-label="Primary (menu)" className="flex flex-col">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="rounded-control px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 border-t border-line pt-2">
              {signedIn ? (
                <ButtonLink href="/dashboard" className="w-full">Open your dashboard</ButtonLink>
              ) : (
                <div className="flex flex-col gap-2">
                  <ButtonLink href="/sign-in" className="w-full">Start with three free runs</ButtonLink>
                  <ButtonLink href="/sign-in" variant="secondary" className="w-full">Sign in</ButtonLink>
                </div>
              )}
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
