import { parseDocBody, parseSpans, type Block, type Span } from "../docs/markdown.ts";

/**
 * The legal drafts' body: the documentation subset (src/lib/docs/markdown.ts) plus pipe
 * tables, which a sub-processor list and a retention schedule need.
 *
 * Same rule as the docs renderer: text is parsed to a structure and rendered as React
 * elements, so nothing in a document can become markup. Tables are cut out first and
 * everything between them is handed to the docs parser unchanged, so the two cannot
 * drift apart on what a paragraph or a heading is.
 */

export type LegalBlock = Block | { kind: "table"; head: Span[][]; rows: Span[][][] };

const TABLE_LINE = /^\s*\|.*\|\s*$/;
const DIVIDER = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function parseTable(lines: string[]): LegalBlock | null {
  if (lines.length < 2 || !DIVIDER.test(lines[1])) return null;
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  if (rows.some((r) => r.length !== head.length)) return null;
  return { kind: "table", head: head.map(parseSpans), rows: rows.map((r) => r.map(parseSpans)) };
}

export function parseLegalBody(body: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) blocks.push(...parseDocBody(prose.join("\n\n")));
    prose = [];
  };

  for (const raw of body.trim().split(/\n{2,}/)) {
    const lines = raw.trim().split("\n");
    const table = lines.every((l) => TABLE_LINE.test(l)) ? parseTable(lines) : null;
    if (table) {
      flush();
      blocks.push(table);
    } else {
      prose.push(raw);
    }
  }
  flush();
  return blocks;
}

/**
 * A placeholder is a run of capitals in square brackets — [LEGAL ENTITY NAME] — and the
 * page shows each one highlighted, so a missing fact can never read as a real one.
 */
export const PLACEHOLDER = /(\[[A-Z0-9][^\]\n]*\])/g;

export function splitPlaceholders(text: string): Array<{ text: string; placeholder: boolean }> {
  return text
    .split(PLACEHOLDER)
    .filter((piece) => piece.length > 0)
    .map((piece) => ({ text: piece, placeholder: /^\[[A-Z0-9][^\]\n]*\]$/.test(piece) && piece === piece.toUpperCase() }));
}

/** Every placeholder in a body, in order, for the inputs checklist and the tests. */
export function placeholdersIn(body: string): string[] {
  return [...body.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((p) => p === p.toUpperCase());
}

/** A stable anchor for a heading: lower case, letters and digits joined by hyphens. */
export function headingId(spans: Span[]): string {
  return spans
    .map((s) => s.text)
    .join("")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
