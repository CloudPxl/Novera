import type { SuiteCase } from "../runner/types.ts";
import { scenarioDigest } from "./digest.ts";

/**
 * What changed between two versions of a suite, computed from the scenarios themselves and
 * never written by hand, so it cannot disagree with them.
 *
 *   added      ids only the newer version has
 *   retired    ids only the older version had
 *   redefined  ids both have, with a different definition (`scenarioDigest` differs): the same
 *              name for a different test, which is why a verdict under one is not comparable
 *              with a verdict under the other
 *   unchanged  ids both have, byte for byte in canonical form
 *
 * Each list is in natural id order (T2 before T10).
 */
export interface SuiteChangelog {
  added: string[];
  retired: string[];
  redefined: string[];
  unchanged: string[];
}

const byId = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** `previous` null means there is no earlier version: every scenario is added. */
export function suiteChangelog(
  previous: { cases: SuiteCase[] } | null,
  next: { cases: SuiteCase[] },
): SuiteChangelog {
  const before = new Map((previous?.cases ?? []).map((c) => [c.id, scenarioDigest(c)]));
  const after = new Map(next.cases.map((c) => [c.id, scenarioDigest(c)]));
  const out: SuiteChangelog = { added: [], retired: [], redefined: [], unchanged: [] };
  for (const [id, digest] of after) {
    if (!before.has(id)) out.added.push(id);
    else if (before.get(id) === digest) out.unchanged.push(id);
    else out.redefined.push(id);
  }
  for (const id of before.keys()) if (!after.has(id)) out.retired.push(id);
  for (const list of Object.values(out)) list.sort(byId);
  return out;
}

/** The next-lower version of the same key among `rows`, or null when `row` is the first. */
export function previousVersion<T extends { key: string; version: number }>(rows: readonly T[], row: T): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.key === row.key && r.version < row.version && (!best || r.version > best.version)) best = r;
  }
  return best;
}

/** The next-higher version of the same key among `rows`, or null when `row` is the newest. */
export function nextVersion<T extends { key: string; version: number }>(rows: readonly T[], row: T): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.key === row.key && r.version > row.version && (!best || r.version < best.version)) best = r;
  }
  return best;
}
