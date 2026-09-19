"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/browser.ts";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { Spinner } from "@/components/ui/button.tsx";
import { Reveal } from "@/components/ui/reveal.tsx";
import { obligationLabel } from "@/lib/report/payload.ts";

type Status = "queued" | "running" | "completed" | "aborted";

interface CaseRow {
  case_id: string;
  obligation: string;
  severity: string;
  status: "pass" | "fail" | "error";
  rationale: string | null;
  error: string | null;
  judge_model: string | null;
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

  const poll = useCallback(async () => {
    const db = browserClient();
    const [{ data: rows }, { data: run }] = await Promise.all([
      db.from("run_cases").select("case_id, obligation, severity, status, rationale, error, judge_model")
        .eq("run_id", runId).order("case_id"),
      db.from("runs").select("status, error").eq("id", runId).maybeSingle(),
    ]);

    if (rows) setCases(rows as CaseRow[]);
    if (run) {
      setStatus(run.status as Status);
      if (run.error) setFailure(run.error);
      if (run.status === "completed" || run.status === "aborted") {
        const { data: rep } = await db.from("reports").select("token").eq("run_id", runId).maybeSingle();
        if (rep?.token) setToken(rep.token);
        return true;
      }
    }
    return false;
  }, [runId]);

  useEffect(() => {
    let cancelled = false;

    async function drive() {
      if (status === "queued" && !started.current) {
        started.current = true;
        // Kick off execution. The response arrives only when the run is finished, so
        // polling below is what keeps the page informative in the meantime.
        fetch(`/api/runs/${runId}/execute`, { method: "POST" })
          .then(async (res) => {
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              if (!cancelled) setFailure(body.error ?? `The run could not be started (${res.status}).`);
            }
          })
          .catch((e) => !cancelled && setFailure(String(e)));
      }

      while (!cancelled) {
        const done = await poll();
        if (done) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    if (status !== "completed" && status !== "aborted") drive();
    else poll();

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
            {running && <Spinner className="text-slate-500" />}
            <Badge
              tone={status === "completed" ? "pass" : status === "aborted" ? "fail" : "live"}
              pulse={running}
            >
              {status === "queued" ? "starting" : status}
            </Badge>
            <span className="text-sm text-slate-600">
              {done} of {plannedCases} scenarios
            </span>
          </div>
          {status === "completed" && (
            <span className="text-sm font-medium tabular-nums">
              {graded > 0 ? `${Math.round((passed / graded) * 1000) / 10}%` : "no score"}
            </span>
          )}
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`novera-bar h-full rounded-full ${running ? "novera-progress" : "bg-slate-900"}`}
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
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {failure}
          </p>
        )}

        {token && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
            <Link
              href={`/report/${token}`}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-slate-700 active:scale-[0.98]"
            >
              Open the client report
            </Link>
            <span className="text-xs text-slate-500">
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
                    <span className="font-mono text-xs text-slate-500">{c.case_id}</span>
                    <span className="text-sm font-medium">{obligationLabel(c.obligation)}</span>
                  </div>
                  {(c.rationale || c.error) && (
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">{c.rationale ?? c.error}</p>
                  )}
                  {c.judge_model && (
                    <p className="mt-1.5 font-mono text-[11px] text-slate-400">graded by {c.judge_model}</p>
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
