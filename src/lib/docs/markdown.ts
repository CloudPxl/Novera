/**
 * The small, deliberate subset of Markdown the documentation corpus uses.
 *
 * `data/docs/*.md` are Markdown files; the page rendered `body.split("\n\n")` into
 * paragraphs. So a reader saw literal backticks around `state_confirmed`, literal
 * asterisks around emphasis, and — once a page grew a heading — the line `## What is
 * sent where` printed as prose. One name meaning two things at a boundary, again: the
 * body is Markdown on the way in and plain text on the way out.
 *
 * Deliberately not a Markdown library, and deliberately not HTML. These pages are the
 * only material the support agent may quote, they are already authored by us, and the
 * corpus uses six constructs. Parsing to a structure that the page renders as React
 * elements means there is no path by which document text becomes markup — which
 * matters more the day a doc page is written by anyone else.
 *
 * Unsupported syntax is shown verbatim rather than swallowed. A raw `<script>` in a
 * doc renders as the characters `<script>`, because nothing here produces HTML.
 */

export type Span =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "em"; text: string }
  | { kind: "strong"; text: string };

export type Block =
  | { kind: "heading"; level: 2 | 3; spans: Span[] }
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: Span[][] }
  /** A fenced block, kept verbatim — line breaks and blank lines included. */
  | { kind: "codeblock"; text: string };

/** `**strong**`, `*em*` and `` `code` ``, in that precedence. */
const INLINE = /(\*\*[^*]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*)|`[^`\n]+`)/g;

export function parseSpans(text: string): Span[] {
  const spans: Span[] = [];

  for (const piece of text.split(INLINE)) {
    if (!piece) continue;
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
      spans.push({ kind: "strong", text: piece.slice(2, -2) });
    } else if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) {
      spans.push({ kind: "code", text: piece.slice(1, -1) });
    } else if (piece.startsWith("*") && piece.endsWith("*") && piece.length > 2) {
      spans.push({ kind: "em", text: piece.slice(1, -1) });
    } else {
      spans.push({ kind: "text", text: piece });
    }
  }

  return spans;
}

const HEADING = /^(#{2,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+\.\s+(.*)$/;

/**
 * A fenced block is cut out before anything else, because it may contain blank lines
 * (a workflow file does) and the prose below is split on exactly those.
 */
const FENCE = /^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm;

export function parseDocBody(body: string): Block[] {
  const blocks: Block[] = [];
  let last = 0;
  for (const match of body.matchAll(FENCE)) {
    parseProse(body.slice(last, match.index), blocks);
    blocks.push({ kind: "codeblock", text: match[1] });
    last = match.index + match[0].length;
  }
  parseProse(body.slice(last), blocks);
  return blocks;
}

function parseProse(body: string, blocks: Block[]): void {
  for (const raw of body.trim().split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;

    const lines = chunk.split("\n");
    const heading = lines[0].match(HEADING);

    // A heading is its own block even when the paragraph beneath it was not separated
    // by a blank line, because a heading that renders as the first sentence of a
    // paragraph is a heading nobody can navigate by.
    if (heading && lines.length === 1) {
      blocks.push({
        kind: "heading",
        level: heading[1].length === 2 ? 2 : 3,
        spans: parseSpans(heading[2]),
      });
      continue;
    }

    const bullets = lines.every((l) => BULLET.test(l));
    const numbers = lines.every((l) => ORDERED.test(l));
    if ((bullets || numbers) && lines.length > 0) {
      blocks.push({
        kind: "list",
        ordered: numbers,
        items: lines.map((l) => parseSpans((l.match(bullets ? BULLET : ORDERED) as RegExpMatchArray)[1])),
      });
      continue;
    }

    // Soft line breaks inside a paragraph are joined: the corpus is hard-wrapped at
    // about 100 columns, and rendering each wrapped line as its own paragraph would
    // turn every page into a column of fragments.
    blocks.push({ kind: "paragraph", spans: parseSpans(lines.join(" ")) });
  }
}

/** The text of a block, for a preview line or a search index. */
export function plainText(block: Block): string {
  if (block.kind === "list") return block.items.map((i) => i.map((s) => s.text).join("")).join(" · ");
  if (block.kind === "codeblock") return block.text;
  return block.spans.map((s) => s.text).join("");
}
