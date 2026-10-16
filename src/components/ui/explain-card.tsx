import Link from "next/link";
import type { ExplainEntry } from "@/lib/explainability/glossary.ts";
import { HelpDisclosure } from "./help.tsx";

/**
 * One resolved glossary entry as a "?" disclosure: what it is, why it matters and what to do
 * next. Takes the entry itself, never a key, so it imports no glossary text and a client
 * component can render it without carrying the glossary in its bundle: the server resolves the
 * entry (`ExplainTrigger`, or `explainEntries` for a client component that renders several) and
 * passes it down. Only the type is imported from the glossary, and a type import is erased.
 *
 * One per concept per screen, beside the thing it explains and never inside a sentence, a
 * heading or a link. The panel flows below the marker (see `HelpDisclosure`), so it cannot
 * overflow a narrow screen, and it is left out of print. `label` replaces the glossary title in
 * the marker's accessible name when the surrounding words call the thing something else.
 */
export function ExplainCard({ entry, label }: { entry: ExplainEntry; label?: string }) {
  return (
    <HelpDisclosure label={label ?? entry.title}>
      <Part heading="What it is">{entry.whatItMeans}</Part>
      <Part heading="Why it matters">{entry.whyItMatters}</Part>
      <Part heading="What to do next">{entry.nextAction}</Part>
      {entry.docsHref && (
        <span className="block">
          <Link href={entry.docsHref} className="font-medium text-ink underline underline-offset-2">Read more in the docs</Link>
        </span>
      )}
    </HelpDisclosure>
  );
}

function Part({ heading, children }: { heading: string; children: string }) {
  return (
    <span className="block">
      <span className="block text-xs font-semibold text-ink">{heading}</span>
      <span className="block">{children}</span>
    </span>
  );
}
