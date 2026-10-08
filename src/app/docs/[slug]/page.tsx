import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { currentUser } from "@/lib/auth/session.ts";
import { notFound } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server.ts";
import { parseDocBody, type Span } from "@/lib/docs/markdown.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const db = await sessionClient();
  const { data } = await db.from("doc_pages").select("title").eq("slug", slug).eq("published", true).maybeSingle();
  return { title: data ? `${data.title} · Novera` : "Novera" };
}

/**
 * Renders the parsed spans as elements.
 *
 * Nothing here takes a string of markup. The corpus is Markdown, it is parsed to a
 * typed structure, and that structure becomes React elements — so a doc page cannot
 * introduce markup no matter who writes one.
 */
function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) => {
        if (span.kind === "code") {
          return (
            <code key={i} className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink [overflow-wrap:anywhere]">
              {span.text}
            </code>
          );
        }
        if (span.kind === "em") return <em key={i}>{span.text}</em>;
        if (span.kind === "strong") return <strong key={i} className="font-semibold text-ink">{span.text}</strong>;
        return <span key={i}>{span.text}</span>;
      })}
    </>
  );
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const signedIn = Boolean(await currentUser());
  const { slug } = await params;
  const db = await sessionClient();
  const { data: page } = await db
    .from("doc_pages").select("title, body, updated_at").eq("slug", slug).eq("published", true).maybeSingle();

  if (!page) notFound();

  const blocks = parseDocBody(page.body as string);
  const updated = page.updated_at
    ? new Date(page.updated_at as string).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main id="main" className="mx-auto w-full max-w-2xl bg-surface px-6 py-10 text-ink sm:px-8">
        <Link href="/docs" className="text-sm text-ink-faint underline-offset-2 hover:underline">
          ← Documentation
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{page.title as string}</h1>

        {/* The date is not decoration. A support reply cites these pages, so "is this
            still true?" is the reader's next question and it should not need asking. */}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className="font-mono">{slug}</span>
          {updated && <span>Last updated {updated}</span>}
        </p>

        <div className="mt-6 space-y-4">
          {blocks.map((block, i) => {
            if (block.kind === "heading") {
              const Tag = block.level === 2 ? "h2" : "h3";
              return (
                <Tag
                  key={i}
                  className={`pt-2 font-semibold tracking-tight text-ink ${
                    block.level === 2 ? "text-lg" : "text-base"
                  }`}
                >
                  <Spans spans={block.spans} />
                </Tag>
              );
            }

            if (block.kind === "list") {
              const Tag = block.ordered ? "ol" : "ul";
              return (
                <Tag
                  key={i}
                  className={`space-y-1 pl-5 text-[15px] leading-relaxed text-ink-soft ${
                    block.ordered ? "list-decimal" : "list-disc"
                  }`}
                >
                  {block.items.map((item, j) => (
                    <li key={j}>
                      <Spans spans={item} />
                    </li>
                  ))}
                </Tag>
              );
            }

            if (block.kind === "codeblock") {
              // Verbatim text in a text node — never markup. Focusable so a keyboard
              // user can scroll a line wider than the column.
              return (
                <pre
                  key={i}
                  tabIndex={0}
                  className="overflow-x-auto rounded-control border border-line bg-sunken p-3 font-mono text-[13px] leading-relaxed text-ink"
                >
                  <code>{block.text}</code>
                </pre>
              );
            }

            return (
              <p key={i} className="text-[15px] leading-relaxed text-ink-soft">
                <Spans spans={block.spans} />
              </p>
            );
          })}
        </div>

        <p className="mt-10 border-t border-line pt-4 text-sm text-ink-soft">
          Something missing?{" "}
          <Link href="/support" className="font-medium underline underline-offset-2">
            Ask us
          </Link>
          .
        </p>
      </main>
    </>
  );
}
