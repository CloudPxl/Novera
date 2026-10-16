import { GLOSSARY, type ExplainKey } from "@/lib/explainability/glossary.ts";
import { ExplainCard } from "./explain-card.tsx";

/**
 * A "?" that explains one of Novera's own terms where it appears, from the glossary
 * (src/lib/explainability/glossary.ts). For SERVER components: it reads the glossary, so a
 * "use client" file must never import it (tests/explainability.test.ts holds that). A client
 * component renders `Explained` with an `id` (explain-context.tsx) inside an `<ExplainProvider>` whose
 * entries its server parent resolved with `explainEntries`, and the glossary stays on the server.
 */
export function ExplainTrigger({ id, label }: { id: ExplainKey; label?: string }) {
  return <ExplainCard entry={GLOSSARY[id]} label={label} />;
}
