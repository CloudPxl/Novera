"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser.ts";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { Spinner } from "@/components/ui/button.tsx";
import { Reveal } from "@/components/ui/reveal.tsx";
import { obligationLabel } from "@/lib/report/payload.ts";
import { gradingNote } from "./grading-note.ts";

type Status = "queued" | "running" | "completed" | "aborted";

interface CaseRow {
  case_id: string;
  obligation: string;
  severity: string;
  status: "pass" | "fail" | "error";
  rationale: string | null;
  error: string | null;
  judge_model: string | null;
  judge_agreement: string | null;
}

/**
 * Drives the run and shows it happening.
 *
 * Progress is read from the database rather than pushed from the executing request,
 * so a refreshed tab, a second window, or a colleague opening the same run all see
 * the same truth — and a browser that closes mid-run does not lose what was graded.
 */
export function LiveRun({
  runId,
  initialStatus,
  plannedCases,
  initialError,
  reportToken,
  hasBaseline,
}: {
  runId: string;
  initialStatus: string;
  plannedCases: number;
  initialError: string | null;
  reportToken: string | null;
  hasBaseline: boolean;
}) {
  const [status, setStatus] = useState<Status>(initialStatus as Status);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [token, setToken] = useState(reportToken);
  const [failure, setFailure] = useState(initialError);
  const started = useRef(false);
  const lastKick = useRef(0);
  const completedPolls = useRef(0);
  const router = useRouter();

  const poll = useCallback(async () => {
    const db = browserClient();
    const [{ data: rows }, { data: run }] = await Promise.all([
      db.from("run_cases").select("case_id, obligation, severity, status, rationale, error, judge_model, judge_agreement")
        .eq("run_id", runId).order("case_id"),
      db.from("runs").select("status, error").eq("id", runId).maybeSingle(),
    ]);

    if (rows) setCases(rows as CaseRow[]);
    if (run) {
      setStatus(run.status as Status);
      if (run.error) setFailure(run.error);
      if (run.status === "completed" || run.status === "aborted") {
        const { data: rep } = await db.from("reports").select("token").eq("run_id", runId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (rep?.token) setToken(rep.token);
        // A run is marked completed a moment *before* its report is sealed. Handing the
        // page back at that moment rendered a finished run with no report link and no
        // export, until someone reloaded. So a completed run waits for its report —
        // for about twenty seconds, after which the page is handed back regardless and
        // shows whatever the server has, rather than spinning over a failed publish.
        if (run.status === "completed" && !rep?.token && ++completedPolls.current < 16) return false;
        return true;
      }
    }
    return false;
  }, [runId]);

  useEffect(() => {
    let cancelled = false;

    /**
     * Asks the server to work on this run.
     *
     * Called repeatedly rather than once. Each invocation grades what fits in its
     * time budget and returns; a serverless function that is killed at the ceiling
     * leaves the run resumable, and this is what resumes it. The server holds a
     * lease, so calling too eagerly is refused rather than duplicated.
     */
    function kick() {
      if (Date.now() - lastKick.current < 15_000) return;
      lastKick.current = Date.now();
      started.current = true;

      fetch(`/api/runs/${runId}/execute`, { method: "POST", redirect: "error" })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            if (!cancelled) setFailure(body.error ?? `The run could not be started (${res.status}).`);
          }
        })
        // `redirect: "error"` rather than the default: a redirect to the sign-in page
        // is followed transparently and arrives as HTML with status 200, which this
        // read as success — leaving the run at "running" forever, silently. The route
        // answers 401 with a body now, and this refuses to mistake a redirect for one.
        .catch(() => {
          if (!cancelled) {
            setFailure("The run could not be started. Your session may have expired — sign in again and it will pick up where it stopped.");
          }
        });
    }

    async function drive() {
      // Already settled: read the final rows once and stop. Nothing to drive, and no
      // refresh — the server already rendered this run in its finished form.
      if (status === "completed" || status === "aborted") {
        await poll();
        return;
      }

      if (status === "queued" && !started.current) kick();

      while (!cancelled) {
        const done = await poll();
        if (done) {
          // Hand the page back to the server. A settled run is rendered there, with
          // the comparison and the decision controls that only make sense once every
          // verdict is in — this view's job was to show the run happening.
          if (!cancelled) router.refresh();
          break;
        }
        await new Promise((r) => setTimeout(r, 1200));
        // Keep asking. If the last invocation was killed mid-run, this is what picks
        // it back up; if one is still working, the server's lease refuses politely.
        if (!cancelled) kick();
      }
    }

    drive();

    return () => { cancelled = true; };
    // Intentionally runs once: `drive` owns its own loop and exits on completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const graded = cases.filter((c) => c.status !== "error").length;
  const passed = cases.filter((c) => c.status === "pass").length;
  const failed = cases.filter((c) => c.status === "fail").length;
  const errored = cases.filter((c) => c.status === "error").length;
  const done = cases.length;
  const percent = plannedCases > 0 ? Math.round((done / plannedCases) * 100) : 0;
  const running = status === "queued" || status === "running";

  return (
    <>
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {running && <Spinner className="text-ink-faint" />}
            <Badge
              tone={status === "completed" ? "pass" : status === "aborted" ? "fail" : "live"}
              pulse={running}
            >
              {status === "queued" ? "starting" : status}
            </Badge>
            <span className="text-sm text-ink-soft">
              {done} of {plannedCases} scenarios
            </span>
          </div>
          {status === "completed" && (
            <span className="text-sm font-medium tabular-nums">
              {graded > 0 ? `${Math.round((passed / graded) * 1000) / 10}%` : "no score"}
            </span>
          )}
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-sunken">
          <div
            className={`novera-bar h-full rounded-full ${running ? "novera-progress" : "bg-ink"}`}
            style={{ width: `${Math.max(percent, done > 0 ? 4 : 0)}%` }}
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={plannedCases}
            aria-label="Scenarios graded"
          />
        </div>

        {done > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Badge tone="pass">{passed} passed</Badge>
            <Badge tone="fail">{failed} failed</Badge>
            {errored > 0 && <Badge tone="error">{errored} no result</Badge>}
          </div>
        )}

        {failure && (
          <p role="alert" className="mt-4 rounded-lg border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">
            {failure}
          </p>
        )}

        {token && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Link
              href={`/report/${token}`}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-on-ink transition-all duration-150 hover:bg-ink-hover active:scale-[0.98]"
            >
              Open the client report
            </Link>
            <span className="text-xs text-ink-faint">
              {hasBaseline ? "Includes a comparison with the previous run." : "First run for this agent, so there is nothing to compare against yet."}
            </span>
          </div>
        )}
      </Card>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">Scenarios</h2>
        {cases.length === 0 ? (
          <div className="mt-3">
            <EmptyState title={running ? "Waiting for the first result" : "Nothing was graded"}>
              {running
                ? "Each scenario is sent to your agent and graded as its answer comes back."
                : "This run produced no gradable result. The failures above explain why."}
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {cases.map((c, i) => (
              <Reveal key={c.case_id} delay={Math.min(i, 8) * 40}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.status === "pass" ? "pass" : c.status === "fail" ? "fail" : "error"}>
                      {c.status === "error" ? "no result" : c.status}
                    </Badge>
                    <span className="font-mono text-xs text-ink-faint">{c.case_id}</span>
                    <span className="text-sm font-medium">{obligationLabel(c.obligation)}</span>
                  </div>
                  {(c.rationale || c.error) && (
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">{c.rationale ?? c.error}</p>
                  )}
                  {c.judge_model && (
                    <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
                      {gradingNote(c.judge_model, c.judge_agreement)}
                    </p>
                  )}
                </Card>
              </Reveal>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
