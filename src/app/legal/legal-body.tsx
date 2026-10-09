import type { ReactNode } from "react";
import type { Span } from "@/lib/docs/markdown.ts";
import { headingId, splitPlaceholders, type LegalBlock } from "@/lib/legal/document.ts";
import { DRAFT_BANNER } from "../../../data/legal/index.ts";
import type { LegalSource } from "../../../data/legal/types.ts";

/**
 * Renders a legal draft from its parsed structure. Like the documentation pages, nothing
 * here takes a string of markup: every piece of text reaches the page as a text node.
 */

function Text({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((piece, i) =>
        piece.placeholder ? (
          // A missing fact, shown as one: highlighted and in capitals, never blended into prose.
          <mark key={i} className="rounded bg-warning-surface px-1 py-0.5 font-mono text-[0.85em] text-warning-text ring-1 ring-warning-border [overflow-wrap:break-word]">
            {piece.text}
          </mark>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  );
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) => {
        if (span.kind === "code") {
          return <code key={i} className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink [overflow-wrap:anywhere]">{span.text}</code>;
        }
        if (span.kind === "em") return <em key={i}><Text text={span.text} /></em>;
        if (span.kind === "strong") return <strong key={i} className="font-semibold text-ink"><Text text={span.text} /></strong>;
        return <Text key={i} text={span.text} />;
      })}
    </>
  );
}

export function DraftBanner({ lastReviewed, version }: { lastReviewed: string; version?: string }) {
  return (
    <div role="note" aria-label="Document status" className="rounded-panel border border-warning-border bg-warning-surface px-4 py-3 text-warning-text">
      <p className="text-sm font-semibold">{DRAFT_BANNER}</p>
      <p className="mt-1 text-sm">
        Not in force and not legal advice. Last reviewed <time dateTime={lastReviewed}>{formatDate(lastReviewed)}</time>
        {version ? <> · Version {version}</> : null}.
      </p>
    </div>
  );
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function Contents({ blocks }: { blocks: LegalBlock[] }) {
  const headings = blocks.filter((b): b is Extract<LegalBlock, { kind: "heading" }> => b.kind === "heading" && b.level === 2);
  if (headings.length < 3) return null;
  return (
    <nav aria-label="On this page" className="mt-6 rounded-panel border border-line bg-ground px-4 py-3">
      <p className="text-xs font-medium text-ink-faint">On this page</p>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {headings.map((h) => (
          <li key={headingId(h.spans)}>
            <a href={`#${headingId(h.spans)}`} className="text-ink-soft underline-offset-2 hover:text-ink hover:underline">
              {h.spans.map((s) => s.text).join("")}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Each scrollable table is a labelled region, and two regions with one name are two
 * landmarks a screen reader cannot tell apart (axe: landmark-unique). Named after the
 * heading above it, numbered when one section holds more than one.
 */
function tableLabels(blocks: LegalBlock[]): Map<number, string> {
  const labels = new Map<number, string>();
  const used = new Map<string, number>();
  let heading = "";
  blocks.forEach((b, i) => {
    if (b.kind === "heading") heading = b.spans.map((s) => s.text).join("");
    if (b.kind === "table") {
      const n = (used.get(heading) ?? 0) + 1;
      used.set(heading, n);
      const name = heading ? `${heading}: table` : "Table";
      labels.set(i, n === 1 ? name : `${name} ${n}`);
    }
  });
  return labels;
}

export function LegalBody({ blocks }: { blocks: LegalBlock[] }) {
  const labels = tableLabels(blocks);
  return (
    <div className="mt-8 space-y-4">
      {blocks.map((block, i): ReactNode => {
        if (block.kind === "heading") {
          const Tag = block.level === 2 ? "h2" : "h3";
          return (
            <Tag key={i} id={headingId(block.spans)} className={`scroll-mt-24 pt-3 font-semibold tracking-tight text-ink ${block.level === 2 ? "text-lg" : "text-base"}`}>
              <Spans spans={block.spans} />
            </Tag>
          );
        }
        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={i} className={`space-y-1.5 pl-5 text-[15px] leading-relaxed text-ink-soft ${block.ordered ? "list-decimal" : "list-disc"}`}>
              {block.items.map((item, j) => <li key={j}><Spans spans={item} /></li>)}
            </Tag>
          );
        }
        if (block.kind === "table") {
          // Scrolls inside its own box on a phone, so the page itself never scrolls sideways.
          return (
            <div key={i} tabIndex={0} role="region" aria-label={labels.get(i)} className="overflow-x-auto rounded-panel border border-line">
              {/* Wide enough per column that a placeholder wraps between words, not inside one;
                  the box scrolls instead. */}
              <table className="w-full border-collapse text-left text-sm" style={{ minWidth: `${Math.max(36, block.head.length * 10)}rem` }}>
                <thead className="bg-sunken">
                  <tr>
                    {block.head.map((cell, j) => (
                      <th key={j} scope="col" className="px-3 py-2 align-bottom text-xs font-semibold text-ink"><Spans spans={cell} /></th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {block.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, j) =>
                        j === 0 ? (
                          <th key={j} scope="row" className="px-3 py-2 align-top font-medium text-ink"><Spans spans={cell} /></th>
                        ) : (
                          <td key={j} className="px-3 py-2 align-top leading-relaxed text-ink-soft"><Spans spans={cell} /></td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === "codeblock") {
          return <pre key={i} tabIndex={0} className="overflow-x-auto rounded-control border border-line bg-sunken p-3 font-mono text-[13px] text-ink"><code>{block.text}</code></pre>;
        }
        return <p key={i} className="text-[15px] leading-relaxed text-ink-soft"><Spans spans={block.spans} /></p>;
      })}
    </div>
  );
}

const KIND_LABEL: Record<LegalSource["kind"], string> = {
  primary: "Law",
  "official-guidance": "Official guidance",
  authority: "Authority",
  "non-authoritative": "Non-authoritative commentary",
};

export function SourcesConsulted({ sources }: { sources: LegalSource[] }) {
  return (
    <section aria-labelledby="sources-heading" className="mt-12 border-t border-line pt-6">
      <h2 id="sources-heading" className="text-base font-semibold tracking-tight">Sources consulted</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Read while drafting, to identify what this document must address. A source listed here is not a statement that Novera meets it.
      </p>
      <ul className="mt-3 space-y-3 text-sm">
        {sources.map((s) => (
          <li key={s.id} className="leading-relaxed">
            <span className="text-xs font-medium text-ink-faint">{KIND_LABEL[s.kind]} · read <time dateTime={s.fetched}>{formatDate(s.fetched)}</time></span>
            <br />
            <a href={s.url} rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2 [overflow-wrap:anywhere]">{s.title}</a>
            <br />
            <span className="text-ink-soft">{s.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
