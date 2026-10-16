"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ExplainEntry, ExplainKey } from "@/lib/explainability/glossary.ts";
import { ExplainCard } from "./explain-card.tsx";

/** The entries a server parent resolved for a client component (`explainEntries`). */
export type ExplainEntries = Partial<Record<ExplainKey, ExplainEntry>>;

const Entries = createContext<ExplainEntries>({});

/**
 * Hands a client subtree the glossary entries it can render, so it never imports the glossary.
 * Only the entries named by the parent cross to the browser, as props.
 */
export function ExplainProvider({ entries, children }: { entries: ExplainEntries; children: ReactNode }) {
  return <Entries.Provider value={entries}>{children}</Entries.Provider>;
}

/**
 * The client-side twin of `ExplainTrigger`: same marker, same words. A key the parent did not
 * resolve renders nothing and says so in development, so a missing entry is found by looking
 * (tests/explainability.test.ts also checks each client file's keys against its list).
 */
export function Explained({ id, label }: { id: ExplainKey; label?: string }) {
  const entry = useContext(Entries)[id];
  if (!entry) {
    if (process.env.NODE_ENV !== "production") console.error(`Explained "${id}" has no entry: its server parent did not resolve it.`);
    return null;
  }
  return <ExplainCard entry={entry} label={label} />;
}
