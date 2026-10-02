"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Badge, Card, Field, inputClass } from "@/components/ui/primitives.tsx";
import {
  WEEKDAYS, describeTiming, formatUtc, hourLabel, nextOccurrence, type Cadence, type ScheduleState,
} from "@/lib/schedules/cadence.ts";
import {
  cancelSchedule, createSchedule, pauseSchedule, resumeSchedule, type ScheduleFormState,
} from "@/lib/workflow/schedules.ts";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";

export interface ScheduleView {
  id: string;
  cadence: Cadence;
  hourUtc: number;
  weekday: number | null;
  suiteLabel: string;
  state: ScheduleState;
  nextRunAt: string;
  pausedReason: string | null;
  lastOutcome: string | null;
  lastAttemptAt: string | null;
  lastRun: { id: string; status: string } | null;
}

/**
 * Setting up a scheduled re-evaluation. Both choices — which suite, and when — are
 * stated in a sentence before it will save, like the run launcher, and so is what each
 * run costs, because the calendar spends runs without anyone pressing a button.
 */
export function ScheduleForm({
  agentId,
  suites,
  defaultSuiteId,
  costNote,
}: {
  agentId: string;
  suites: Array<{ id: string; label: string }>;
  defaultSuiteId: string | undefined;
  costNote: string;
}) {
  const [state, submit] = useActionState<ScheduleFormState, FormData>(createSchedule, {});
  const keepValues = useKeepValuesOnError(state);
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [hourUtc, setHourUtc] = useState(6);
  const [weekday, setWeekday] = useState(1);
  const [suiteId, setSuiteId] = useState(defaultSuiteId ?? "");

  const timing = { cadence, hourUtc, weekday: cadence === "weekly" ? weekday : null };
  const suite = suites.find((s) => s.id === suiteId);

  return (
    <form onSubmitCapture={keepValues} action={submit} className="mt-3 space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Suite" htmlFor="schedule-suite">
          <select
            id="schedule-suite" name="suiteId" required value={suiteId}
            onChange={(e) => setSuiteId(e.target.value)} className={inputClass}
          >
            <option value="">Choose a suite…</option>
            {suites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="How often" htmlFor="schedule-cadence">
          <select
            id="schedule-cadence" name="cadence" value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)} className={inputClass}
          >
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
          </select>
        </Field>
        {cadence === "weekly" && (
          <Field label="Day" htmlFor="schedule-weekday">
            <select
              id="schedule-weekday" name="weekday" value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))} className={inputClass}
            >
              {/* Monday first, as a European calendar reads. */}
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
            </select>
          </Field>
        )}
        <Field label="Time (UTC)" htmlFor="schedule-hour" hint="UTC all year, so it never moves with summer time.">
          <select
            id="schedule-hour" name="hourUtc" value={hourUtc}
            onChange={(e) => setHourUtc(Number(e.target.value))} className={inputClass}
          >
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </Field>
      </div>

      <p className="rounded-control bg-sunken px-3 py-2 text-xs leading-relaxed text-ink-soft">
        {suite ? (
          <>
            <strong className="font-semibold text-ink">{describeTiming(timing)}</strong>, running{" "}
            <strong className="font-semibold text-ink">{suite.label}</strong> against the agent&rsquo;s current policy.
            First run{" "}
            <span suppressHydrationWarning>{formatUtc(nextOccurrence(timing, new Date()))}</span>. {costNote}
          </>
        ) : (
          "Choose the suite to run. A schedule stays on the version you choose, so its runs compare like with like."
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="Saving…" disabled={!suite}>Schedule it</SubmitButton>
        {state.error && <p role="status" className="text-sm text-fail-text">{state.error}</p>}
        {state.notice && <p role="status" className="text-sm text-pass-text">{state.notice}</p>}
      </div>
    </form>
  );
}

// "error" is the warning colour: a paused schedule needs attention, it has not failed.
const STATE_TONE = { active: "pass", paused: "error", cancelled: "neutral" } as const;

export function ScheduleCard({ schedule: s }: { schedule: ScheduleView }) {
  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {describeTiming({ cadence: s.cadence, hourUtc: s.hourUtc, weekday: s.weekday })}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">{s.suiteLabel}</p>
        </div>
        <Badge tone={STATE_TONE[s.state]}>{s.state}</Badge>
      </div>

      <dl className="mt-2 space-y-1 text-xs leading-relaxed text-ink-soft">
        {s.state === "active" && (
          <div><dt className="inline text-ink-faint">Next run: </dt><dd className="inline">{formatUtc(s.nextRunAt)}</dd></div>
        )}
        {s.state === "paused" && (
          <div>
            <dt className="inline text-ink-faint">Paused: </dt>
            <dd className="inline">{s.pausedReason ?? "by a person. Resume it to continue."}</dd>
          </div>
        )}
        {s.lastOutcome && s.lastAttemptAt && s.state !== "paused" && (
          <div>
            <dt className="inline text-ink-faint">Last attempt {formatUtc(s.lastAttemptAt)}: </dt>
            <dd className="inline">{s.lastOutcome}</dd>
          </div>
        )}
        {s.lastRun && (
          <div>
            <dt className="inline text-ink-faint">Latest run: </dt>
            <dd className="inline">
              <Link href={`/runs/${s.lastRun.id}`} className="font-mono text-ink underline underline-offset-2">
                {s.lastRun.id.slice(0, 8)}
              </Link>{" "}
              ({s.lastRun.status})
            </dd>
          </div>
        )}
      </dl>

      {s.state !== "cancelled" && <ScheduleControls scheduleId={s.id} paused={s.state === "paused"} />}
    </Card>
  );
}

function ScheduleControls({ scheduleId, paused }: { scheduleId: string; paused: boolean }) {
  const [toggleState, toggle] = useActionState<ScheduleFormState, FormData>(paused ? resumeSchedule : pauseSchedule, {});
  const [cancelState, cancel] = useActionState<ScheduleFormState, FormData>(cancelSchedule, {});
  const [confirming, setConfirming] = useState(false);
  const message = cancelState.error ?? cancelState.notice ?? toggleState.error ?? toggleState.notice;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <form action={toggle}>
        <input type="hidden" name="scheduleId" value={scheduleId} />
        <SubmitButton size="sm" variant="secondary" pendingLabel={paused ? "Resuming…" : "Pausing…"}>
          {paused ? "Resume" : "Pause"}
        </SubmitButton>
      </form>
      <form action={cancel} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="scheduleId" value={scheduleId} />
        {confirming ? (
          <>
            <span className="text-xs text-ink-soft">Cancel this schedule for good?</span>
            <SubmitButton size="sm" variant="danger" pendingLabel="Cancelling…">Cancel schedule</SubmitButton>
            <button type="button" onClick={() => setConfirming(false)} className="text-xs text-ink-faint underline-offset-2 hover:underline">
              Keep it
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
            Cancel…
          </button>
        )}
      </form>
      {message && <span role="status" className="text-xs text-ink-soft">{message}</span>}
    </div>
  );
}
