import { Badge, Tooltip } from "@/components/ui/primitives.tsx";
import type { Grade } from "@/lib/evidence/grade.ts";
import type { Coverage } from "@/lib/evidence/coverage.ts";

/**
 * The band's colour ring. `INCOMPLETE` and `WITHHELD` are deliberately not red: neither is a bad
 * result, it is the absence of one, and colouring it like a failure would push an
 * operator to explain away a gap instead of re-running it.
 */
const BAND_RING = {
  A: "border-pass-border bg-pass-surface text-pass-text",
  B: "border-pass-border bg-pass-surface text-pass-text",
  C: "border-warning-border bg-warning-surface text-warning-text",
  F: "border-fail-border bg-fail-surface text-fail-text",
  // Amber and dashed: as loud as a letter, never red. See the client report.
  INCOMPLETE: "border-dashed border-warning-text bg-warning-surface text-warning-text",
  // Same treatment, different reason. Neither is a bad grade, so neither is red.
  WITHHELD: "border-dashed border-warning-text bg-warning-surface text-warning-text",
} as const;

export interface Corroboration {
  agreed: number;
  settled: number;
  unconfirmed: number;
  unresolved: number;
}

function engineLine(c: Corroboration, judgeModel: string | null): string {
  const total = c.agreed + c.settled + c.unconfirmed + c.unresolved;
  if (total === 0) return judgeModel ? `Graded by ${judgeModel}.` : "No verdict was recorded.";

  const parts = [`${c.agreed} of ${total} verdicts were confirmed by a second model`];
  if (c.settled) parts.push(`${c.settled} needed a third to settle a disagreement`);
  if (c.unconfirmed) parts.push(`${c.unconfirmed} could not be corroborated`);
  if (c.unresolved) parts.push(`${c.unresolved} could not be resolved at all`);
  return `${parts.join(", ")}.`;
}

function duration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function Scorecard({
  grade,
  coverage,
  corroboration,
  agentName,
  policyVersion,
  suiteLabel,
  createdAt,
  startedAt,
  finishedAt,
  judgeModel,
  status,
  runError,
}: {
  grade: Grade;
  coverage: Coverage;
  corroboration: Corroboration;
  agentName: string;
  policyVersion: number | null;
  suiteLabel: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  judgeModel: string | null;
  status: string;
  runError: string | null;
}) {
  const took = duration(startedAt, finishedAt);
  // Two reasons for no letter: the run did not finish, or it finished and the evidence
  // does not support one. Both hide the badge; only the wording differs.
  const ungraded = grade.band === "INCOMPLETE" || grade.band === "WITHHELD";

  return (
    <section className="rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        {/* ------------------------------------------------------- the badge */}
        <div className="flex items-center gap-4 sm:block">
          <div
            className={`grid size-24 shrink-0 place-items-center rounded-full border-4 ${BAND_RING[grade.band]}`}
          >
            {ungraded ? (
              <span className="text-center text-xs font-bold uppercase leading-tight tracking-wide">
                {grade.band === "WITHHELD" ? <>Grade<br />withheld</> : <>Not<br />graded</>}
              </span>
            ) : (
              <>
                <span className="text-4xl font-bold leading-none">{grade.band}</span>
                <span className="tnum mt-0.5 text-xs font-semibold">{grade.score}%</span>
              </>
            )}
          </div>
          {!ungraded && (
            <p className="mt-2 text-center text-xs text-ink-faint sm:w-24">
              pass mark {grade.threshold}%
            </p>
          )}
        </div>

        {/* -------------------------------------------------------- the facts */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="type-h1 min-w-0 break-words">{agentName}</h1>
            <Badge tone={status === "completed" ? "pass" : "error"}>{status}</Badge>
          </div>

          <p className="mt-1 type-body text-ink-soft">
            {suiteLabel} · policy v{policyVersion ?? "?"} ·{" "}
            <time dateTime={createdAt} className="tnum">
              {new Date(createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
            </time>
            {took && <> · ran in <span className="tnum">{took}</span></>}
          </p>

          {/* The basis line is not optional decoration. A number with no stated
              basis is the thing this product exists to argue against. */}
          <p className="mt-3 rounded-control bg-sunken px-3 py-2 text-sm leading-relaxed text-ink-soft">
            {grade.basis}
            {coverage.assuranceGap > 0 && (
              <>
                {" "}
                <strong className="font-semibold text-ink">
                  {coverage.assuranceGap}% of this evaluation produced no verdict.
                </strong>
              </>
            )}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{coverage.planned} planned</Badge>
            <Badge tone={coverage.passed > 0 ? "pass" : "neutral"}>{coverage.passed} passed</Badge>
            <Badge tone={coverage.failed > 0 ? "fail" : "neutral"}>{coverage.failed} failed</Badge>
            {coverage.errored - coverage.disputed - coverage.unverifiable > 0 && (
              <Badge tone="error">
                {coverage.errored - coverage.disputed - coverage.unverifiable} no result
              </Badge>
            )}
            {/* Separated on purpose. "The endpoint timed out" and "our two judges
                deadlocked on what this reply means" are different facts about the
                agent, and only one of them is something the customer can fix. */}
            {coverage.disputed > 0 && (
              <Tooltip text="Two models disagreed on this scenario and a third could not settle it. Novera records that as no verdict rather than picking a side.">
                <Badge tone="error">{coverage.disputed} disputed</Badge>
              </Tooltip>
            )}
            {/* A third distinct thing, and the one least likely to be the agent's
                fault: the reply arrived, the models read it, and nothing evidenced the
                action it described. */}
            {coverage.unverifiable > 0 && (
              <Tooltip text="These scenarios expected the agent to do something. Nothing independent of the agent evidenced that it happened, so the pass was withheld rather than granted on the agent's own account.">
                <Badge tone="high">{coverage.unverifiable} unable to verify</Badge>
              </Tooltip>
            )}
            {coverage.notRun > 0 && <Badge tone="error">{coverage.notRun} not run</Badge>}
          </div>

          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs leading-relaxed text-ink-faint">
            <Tooltip text="Every verdict goes to two models from different vendors wherever a second vendor can be reached. A third settles a disagreement. A tie that cannot be broken is recorded as no result, never guessed.">
              <span className="underline decoration-dotted underline-offset-2">How verdicts were reached</span>
            </Tooltip>
            <span>— {engineLine(corroboration, judgeModel)}</span>
          </p>

          {runError && (
            <p role="alert" className="mt-3 rounded-control border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">
              {runError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
