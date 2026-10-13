import { highlight, languageLabel } from "@/lib/docs/highlight.ts";
import { CopyButton } from "./copy-button.tsx";
import styles from "./code-block.module.css";

/**
 * A fenced block from a documentation page. Server-rendered: the highlighting is done here
 * and only the small copy button ships as client code. Every token is a text node inside a
 * span; the page's text never becomes markup.
 */
export function CodeBlock({ text, lang, id }: { text: string; lang: string | null; id: string }) {
  const label = languageLabel(lang);
  return (
    <figure className="overflow-hidden rounded-control border border-line bg-sunken">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
        <span className="font-mono text-xs text-ink-soft">{label ?? "text"}</span>
        <CopyButton text={text} targetId={id} />
      </figcaption>
      {/* Focusable so a keyboard user can scroll a line wider than the column. */}
      <pre tabIndex={0} className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-ink">
        <code id={id}>
          {highlight(text, lang).map((token, i) =>
            token.type === "plain" ? token.text : <span key={i} className={styles[`t-${token.type}`]}>{token.text}</span>,
          )}
        </code>
      </pre>
    </figure>
  );
}
