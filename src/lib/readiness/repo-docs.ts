/**
 * The repository documents the staff readiness page reads at request time: the questions for
 * counsel, the legal inputs still missing, and the launch-readiness ledger. Read from disk on
 * each request, so the page never shows a copy older than the deployment it runs on.
 *
 * The files are named here and nowhere else (an allow-list: no path ever comes from a request),
 * and next.config.ts `outputFileTracingIncludes` ships them with the /readiness function.
 *
 * The parsing below is pure and tested; only `readRepoDoc` touches the disk.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const READINESS_DOCS = {
  counsel: "docs/LEGAL-COUNSEL-QUESTIONS.md",
  inputs: "docs/legal-inputs-required.md",
  launch: "docs/LAUNCH-READINESS.md",
} as const;

export type ReadinessDocKey = keyof typeof READINESS_DOCS;

/** The file's text, or null when it is not in this deployment — the page says so instead of failing. */
export async function readRepoDoc(key: ReadinessDocKey, root: string = process.cwd()): Promise<string | null> {
  try {
    return await readFile(join(root, READINESS_DOCS[key]), "utf8");
  } catch {
    return null;
  }
}

/**
 * A repository document made ready for the legal renderer (src/lib/legal/document.ts): its `# `
 * title taken out (that renderer knows `##` and `###` only, and would print the hashes), and a
 * hard-wrapped list item's indented continuation lines joined back onto the item. Without the
 * second step a numbered question wrapped over three lines is not a list, and every question in a
 * section runs together into one paragraph.
 */
export function prepareRepoDoc(text: string): { title: string | null; body: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let title: string | null = null;
  if (/^# \S/.test(lines[0] ?? "")) title = lines.shift()!.slice(2).trim();

  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const item = /^\s*(?:[-*]|\d+\.)\s+\S/.test(line);
    const continuation = /^\s+\S/.test(line) && !item;
    if (continuation && inList && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`;
      continue;
    }
    if (item) inList = true;
    else if (line.trim() === "" || !continuation) inList = false;
    out.push(line);
  }
  return { title, body: out.join("\n").trim() };
}

export interface LedgerRow {
  id: string;
  item: string;
  owner: string;
  /** The Status cell as written, emphasis removed: "BLOCKED", "PASS (offline)". */
  status: string;
}

/**
 * The work items of docs/LAUNCH-READINESS.md by their id (A1, O10, L3…), from every table whose
 * header has `#`, `Work item`, `Owner` and `Status` columns. Column positions are read from each
 * header, because the phases' tables do not all have the same columns.
 */
export function parseLaunchLedger(text: string): Map<string, LedgerRow> {
  const rows = new Map<string, LedgerRow>();
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  let columns: { id: number; item: number; owner: number; status: number } | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) {
      columns = null;
      continue;
    }
    const c = cells(line);
    if (c[0] === "#") {
      const at = (name: string) => c.findIndex((h) => h.toLowerCase() === name);
      const [item, owner, status] = [at("work item"), at("owner"), at("status")];
      columns = item > 0 && owner > 0 && status > 0 ? { id: 0, item, owner, status } : null;
      continue;
    }
    if (!columns || /^:?-{3,}/.test(c[0])) continue;
    const id = c[columns.id];
    if (!/^[A-Z]\d*[a-z]?$/.test(id)) continue;
    rows.set(id, {
      id,
      item: c[columns.item] ?? "",
      owner: c[columns.owner] ?? "",
      status: (c[columns.status] ?? "").replace(/\*\*/g, "").trim(),
    });
  }
  return rows;
}
