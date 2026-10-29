/**
 * Which documentation a question is answered from, and how much of it.
 *
 * Every anonymous support question sent the whole documentation set — about 187 KB, 47,000 tokens —
 * to a model, which no free tier can serve, so each draft landed on the weakest model or on the paid
 * one, at roughly $0.07 a question from a stranger (final audit E-4, 2026-10-28). Ask Novera chose
 * three pages but sent them whole: 25–44 KB, ten times what its comment assumed (E-5).
 *
 * So: the pages that share the most words with the question, then the paragraphs of those pages that
 * do, within a character budget. Pure, so the budget is tested rather than assumed.
 */
export interface SelectablePage {
  slug: string;
  title: string;
  body: string;
}

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);

function score(text: string, title: string, query: Set<string>): number {
  const haystack = text.toLowerCase();
  const heading = title.toLowerCase();
  let total = 0;
  for (const w of query) if (haystack.includes(w)) total += heading.includes(w) ? 3 : 1;
  return total;
}

/** The paragraphs of a page that best match the question, in page order, within `budget` characters. */
export function excerpt(body: string, query: Set<string>, budget: number): string {
  if (body.length <= budget) return body;
  const paragraphs = body.split(/\n{2,}/).map((text, order) => ({ text, order, score: score(text, "", query) }));
  const chosen: typeof paragraphs = [];
  let used = 0;
  // Highest score first; the page's opening paragraph breaks ties, since it says what the page is.
  for (const p of [...paragraphs].sort((a, b) => b.score - a.score || a.order - b.order)) {
    const room = budget - used;
    if (room < 80) break;
    // A paragraph longer than what is left is cut, not skipped: a one-block page would send nothing.
    const text = p.text.length > room ? `${p.text.slice(0, room - 1)}…` : p.text;
    chosen.push({ ...p, text });
    used += text.length + 2;
  }
  return chosen.sort((a, b) => a.order - b.order).map((p) => p.text).join("\n\n");
}

export function selectDocs<T extends SelectablePage>(
  question: string,
  pages: T[],
  options: { count: number; maxChars: number },
): T[] {
  const query = new Set(words(question));
  const ranked = pages
    .map((page, order) => ({ page, order, score: score(`${page.title} ${page.body}`, page.title, query) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, options.count);
  // The budget is shared by what was picked, weighted to the better matches by being given first-come
  // to the ranked list: each page takes at most an even share, and unused room passes to the next.
  let remaining = options.maxChars;
  return ranked.map((r, i) => {
    const share = Math.floor(remaining / (ranked.length - i));
    const body = excerpt(r.page.body, query, share);
    remaining -= body.length;
    return { ...r.page, body };
  });
}
