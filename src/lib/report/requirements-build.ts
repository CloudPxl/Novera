import { neverSent } from "../evidence/coverage.ts";
import type { RunCaseRecord } from "../runner/types.ts";
import { sourcesFor, type MappedVersion } from "../suites/sources.ts";
import type { ReportRequirements } from "./payload.ts";
import { REQUIREMENTS_NOTE } from "./requirements.ts";

/**
 * The requirements matrix a new report seals (payload format 16), or null when the run's suite has
 * no sources sidecar. Article 50 pack, 2026-11-05.
 *
 * Every outcome is read from the stored case rows the report already reads for `obligations` and
 * `findings` — pass, fail, error (disputed included), or no row — and nothing else. The mapping
 * is the sidecar as it stands at sealing, copied in, so a later correction to a reference never
 * changes a document already issued.
 *
 * A constant in a sealed document is a claim about every run: the policy sentence names the
 * version *this* run was given, and the matrix is attached only when the run's recorded scenarios
 * are the ones the mapping was written for. A workspace suite that reused the key with other
 * scenarios gets no matrix rather than one describing different tests.
 */
export function buildRequirements(args: {
  suite: { key: string; version: number };
  /** On an extension, the official suite it carried: the mapping covers those scenarios only. */
  extension?: { base_suite: string } | null;
  policyVersion: number;
  cases: readonly RunCaseRecord[];
}): ReportRequirements | null {
  let mapped = sourcesFor(args.suite.key, args.suite.version);
  if (!mapped && args.extension) {
    const base = /^([a-z0-9][a-z0-9-]*) v(\d+)$/.exec(args.extension.base_suite);
    if (base) mapped = sourcesFor(base[1], Number(base[2]));
  }
  if (!mapped) return null;
  if (!recordsMatch(mapped, args.cases, Boolean(args.extension))) return null;

  const rowOf = new Map<string, RunCaseRecord>();
  for (const c of args.cases) if (!rowOf.has(c.caseId)) rowOf.set(c.caseId, c);

  const { sources } = mapped;
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  // Suite order, which is the order the run declared its scenarios in.
  const rows: ReportRequirements["rows"] = [...mapped.scenarios.keys()]
    .filter((id) => id in sources.cases)
    .map((id) => {
      const record = rowOf.get(id);
      const outcome: ReportRequirements["rows"][number]["outcome"] = !record
        ? "not_run"
        : record.status === "pass"
          ? "pass"
          : record.status === "fail"
            ? "fail"
            // An error the agent never received is a scenario that did not run, as coverage counts it.
            : neverSent(record) ? "not_run" : "no_result";
      return {
        case: id,
        obligation: mapped.scenarios.get(id)!.obligation,
        outcome,
        // Decision G5, as `corroboration.uncorroborated_passes` counts it.
        uncorroborated: outcome === "pass" && record?.judgeAgreement === "unconfirmed",
        sources: clone(sources.cases[id].sources),
        scope_limit: sources.cases[id].scope_limit,
      };
    });

  const byCase = new Map(rows.map((r) => [r.case, r]));
  const groups: ReportRequirements["groups"] = sources.groups.map((g) => {
    const own = g.cases.map((id) => byCase.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    const count = (o: ReportRequirements["rows"][number]["outcome"]) => own.filter((r) => r.outcome === o).length;
    const passed = count("pass");
    const failed = count("fail");
    const uncorroboratedPasses = own.filter((r) => r.uncorroborated).length;
    return {
      id: g.id,
      label: g.label,
      refs: g.refs,
      // A failure is a finding whatever else is missing. "Present" needs every scenario passed,
      // and no pass resting on one model's verdict — the release gate's reading (G5).
      status: failed > 0
        ? "observed_deficient"
        : own.length > 0 && passed === own.length && uncorroboratedPasses === 0
          ? "observed_present"
          : "inconclusive",
      passed,
      failed,
      no_result: count("no_result"),
      not_run: count("not_run"),
      uncorroborated_passes: uncorroboratedPasses,
    };
  });

  return {
    as_of: sources.as_of,
    note: REQUIREMENTS_NOTE,
    boundary: sources.boundary,
    customer_policy: `${sources.customer_policy.trim()} The run was given policy version ${args.policyVersion}.`,
    voluntary_code: sources.voluntary_code,
    groups,
    rows,
    not_evaluated: clone(sources.not_evaluated).map((n) => ({ id: n.id, label: n.label, refs: n.refs, sources: n.sources, reason: n.reason })),
  };
}

/**
 * Whether the run's recorded scenarios are the mapped ones: each recorded row the mapping names
 * has that scenario's obligation and expected behaviour (a language variant changes neither), and
 * a run that is not an extension recorded nothing the mapping does not name.
 */
function recordsMatch(mapped: MappedVersion, cases: readonly RunCaseRecord[], extension: boolean): boolean {
  for (const c of cases) {
    const own = mapped.scenarios.get(c.caseId);
    if (!own) {
      if (extension) continue;
      return false;
    }
    if (own.obligation !== c.obligation || own.expected !== c.expected) return false;
  }
  return true;
}
