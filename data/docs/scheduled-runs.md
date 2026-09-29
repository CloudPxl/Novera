---
title: Scheduled runs
published: true
---
A schedule runs a suite against an agent again on a calendar, so a change in the agent — a new model version, an edited system prompt, a changed knowledge base — shows up in a comparison without anyone having to remember to press **Run the suite**. Set one up on the agent's page, under **Schedule**.

## What a scheduled run is

An ordinary run. It is started the same way as the button starts one: the agent's current policy version, the suite you chose, the same checks and the same graders. It is declared before it executes, graded the same way, and gets its own sealed report when it finishes — unless nothing in it produced a verdict, as with any run. It compares with this agent's previous completed run on the same suite.

The run page and the agent's list of runs say it was **scheduled**, and which schedule started it. Over the API, a run carries `started_by`: `person`, `api_key` or `schedule`.

## Choosing when

- **Daily or weekly**, at a whole hour.
- **Times are in UTC, all year.** A schedule set in local time would move by an hour twice a year in most of the EU. 06:00 UTC is 08:00 in Berlin in summer and 07:00 in winter.
- **A schedule stays on the suite version you chose**, so its runs compare like with like. When a new version of a suite is published, set up a new schedule for it.
- A workspace can have up to five schedules that are not cancelled.

The form shows the first run's date and time before you save.

## What each run costs

Each scheduled run uses one of your trial runs, or grades on your own model key if you have connected one — exactly as if you had pressed the button. The form says which before you save.

## When a run cannot start

- **No runs left, or no policy saved:** the schedule **pauses** and shows the reason on the agent's page. It does not try again every day. Fix the cause, then press **Resume**.
- **The previous scheduled run is still going:** that occurrence is skipped, and the schedule says so. Two runs never grade the same agent from one schedule at once.
- **The clock was down:** a missed run is not caught up. When the clock returns, the schedule runs once and moves to its next time, rather than firing every missed occurrence in a row.

Resuming a paused schedule starts from the next time after now, never immediately.

## Pausing and cancelling

**Pause** stops new runs until you resume. **Cancel** is permanent. A schedule is never deleted, because the runs it started name it. To change a schedule's suite, day or time, cancel it and create another; its history stays with the runs it started.

## Limits

- The earliest a scheduled run starts is at its hour. It usually starts within a minute of it, but this is not guaranteed.
- A long suite is graded in slices of about 45 seconds, one a minute, so a 49-scenario run takes several minutes from start to report.
- Scheduling does not watch your agent between runs. It is a regular re-test, not monitoring.
