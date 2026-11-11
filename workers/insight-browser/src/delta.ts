/**
 * What the widget said after a prompt: the lines that appeared in its text, without the
 * echoed prompt, typing indicators or timestamps. Pure.
 */
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const TYPING = /^(\.{2,}|…+|typing\.*…?|is typing\.*…?|.{0,40}\b(is typing|typing|thinking|writing)\b\.*…?)$/i;
const CHROME = /^(\d{1,2}:\d{2}(\s?[ap]m)?|just now|now|sent|read|delivered|seen|today|yesterday|send|message|bot|assistant|you)$/i;

export function isTypingLine(line: string): boolean {
  return TYPING.test(norm(line));
}

/** Lines in `after` that were not in `before`, in order (a multiset difference). */
export function newLines(before: string, after: string): string[] {
  const seen = new Map<string, number>();
  for (const line of before.split(/\n+/).map(norm).filter(Boolean)) seen.set(line, (seen.get(line) ?? 0) + 1);
  const out: string[] = [];
  for (const line of after.split(/\n+/).map(norm).filter(Boolean)) {
    const n = seen.get(line) ?? 0;
    if (n > 0) seen.set(line, n - 1);
    else out.push(line);
  }
  return out;
}

export interface Delta {
  /** The reply text, or empty when nothing new arrived. */
  text: string;
  /** A typing indicator is still showing among the new lines. */
  typing: boolean;
}

export function extractDelta(before: string, after: string, prompt: string): Delta {
  const promptNorm = norm(prompt);
  const lines = newLines(before, after);
  const typing = lines.some(isTypingLine);
  const kept = lines.filter((line) => {
    if (isTypingLine(line) || CHROME.test(line)) return false;
    if (line === promptNorm) return false;
    // An echo the widget split over lines: a long piece of the prompt, verbatim.
    if (line.length >= 20 && promptNorm.includes(line)) return false;
    return true;
  });
  return { text: kept.join("\n").trim(), typing };
}

/** Bytes of UTF-8, and the text cut to fit, at a character boundary. */
export function fitBytes(text: string, limit: number): { text: string; cut: boolean } {
  if (Buffer.byteLength(text, "utf8") <= limit) return { text, cut: false };
  let out = text.slice(0, limit);
  while (Buffer.byteLength(out, "utf8") > limit) out = out.slice(0, -1);
  return { text: out, cut: true };
}
