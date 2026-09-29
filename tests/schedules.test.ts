import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeTiming, formatUtc, nextOccurrence, scheduleState, validTiming,
} from "../src/lib/schedules/cadence.ts";
import { isTickRequest, tickSecret } from "../src/lib/schedules/secret.ts";

const at = (iso: string) => new Date(iso);

test("a daily schedule runs later today if the hour is still ahead, tomorrow if not", () => {
  const daily = { cadence: "daily" as const, hourUtc: 6, weekday: null };
  assert.equal(nextOccurrence(daily, at("2026-09-29T05:59:00Z")).toISOString(), "2026-09-29T06:00:00.000Z");
  assert.equal(nextOccurrence(daily, at("2026-09-29T06:00:00Z")).toISOString(), "2026-09-30T06:00:00.000Z");
  assert.equal(nextOccurrence(daily, at("2026-09-29T23:30:00Z")).toISOString(), "2026-09-30T06:00:00.000Z");
});

test("a weekly schedule lands on its weekday, across a month and a year end", () => {
  // 2026-09-29 is a Tuesday.
  const monday = { cadence: "weekly" as const, hourUtc: 6, weekday: 1 };
  assert.equal(nextOccurrence(monday, at("2026-09-29T12:00:00Z")).toISOString(), "2026-10-05T06:00:00.000Z");
  const tuesday = { cadence: "weekly" as const, hourUtc: 6, weekday: 2 };
  assert.equal(nextOccurrence(tuesday, at("2026-09-29T05:00:00Z")).toISOString(), "2026-09-29T06:00:00.000Z");
  assert.equal(nextOccurrence(tuesday, at("2026-09-29T06:00:00Z")).toISOString(), "2026-10-06T06:00:00.000Z");
  const friday = { cadence: "weekly" as const, hourUtc: 23, weekday: 5 };
  assert.equal(nextOccurrence(friday, at("2026-12-31T23:30:00Z")).toISOString(), "2027-01-01T23:00:00.000Z");
});

test("missed occurrences are not caught up: after an outage the schedule runs once", () => {
  const daily = { cadence: "daily" as const, hourUtc: 6, weekday: null };
  // The clock was down from the 20th; the tick on the 29th moves it to the 30th, not the 21st.
  assert.equal(nextOccurrence(daily, at("2026-09-29T09:00:00Z")).toISOString(), "2026-09-30T06:00:00.000Z");
});

test("UTC is UTC: the summer-time change does not move a schedule", () => {
  const sunday = { cadence: "weekly" as const, hourUtc: 1, weekday: 0 };
  // The EU leaves summer time at 01:00 UTC on 2026-10-25.
  assert.equal(nextOccurrence(sunday, at("2026-10-24T12:00:00Z")).toISOString(), "2026-10-25T01:00:00.000Z");
});

test("only a daily or weekly timing with a whole hour and, for weekly, a weekday is valid", () => {
  assert.equal(validTiming({ cadence: "daily", hourUtc: 0, weekday: null }), true);
  assert.equal(validTiming({ cadence: "weekly", hourUtc: 23, weekday: 6 }), true);
  assert.equal(validTiming({ cadence: "daily", hourUtc: 24, weekday: null }), false);
  assert.equal(validTiming({ cadence: "daily", hourUtc: 6.5, weekday: null }), false);
  assert.equal(validTiming({ cadence: "daily", hourUtc: 6, weekday: 1 }), false);
  assert.equal(validTiming({ cadence: "weekly", hourUtc: 6, weekday: null }), false);
  assert.equal(validTiming({ cadence: "weekly", hourUtc: 6, weekday: 7 }), false);
  assert.equal(validTiming({ cadence: "hourly", hourUtc: 6, weekday: null }), false);
  assert.equal(validTiming({ cadence: "daily", hourUtc: Number.NaN, weekday: null }), false);
});

test("a schedule is described in words, with the date spelled out and the zone named", () => {
  assert.equal(describeTiming({ cadence: "daily", hourUtc: 6, weekday: null }), "Daily at 06:00 UTC");
  assert.equal(describeTiming({ cadence: "weekly", hourUtc: 18, weekday: 1 }), "Mondays at 18:00 UTC");
  assert.equal(formatUtc("2026-10-05T06:00:00Z"), "Mon 5 Oct, 06:00 UTC");
});

test("cancelled outranks paused", () => {
  assert.equal(scheduleState({ paused_at: null, cancelled_at: null }), "active");
  assert.equal(scheduleState({ paused_at: "2026-09-29", cancelled_at: null }), "paused");
  assert.equal(scheduleState({ paused_at: "2026-09-29", cancelled_at: "2026-09-30" }), "cancelled");
});

test("the clock's secret is derived, stable, and checked exactly", () => {
  const key = "test-only-encryption-key";
  const secret = tickSecret(key);
  assert.equal(secret, tickSecret(key));
  assert.notEqual(secret, tickSecret("another-key"));
  assert.ok(!secret.includes(key));

  assert.equal(isTickRequest(`Bearer ${secret}`, key), true);
  assert.equal(isTickRequest(`Bearer ${secret}x`, key), false);
  assert.equal(isTickRequest(`Bearer ${secret.slice(1)}`, key), false);
  assert.equal(isTickRequest(secret, key), false);
  assert.equal(isTickRequest(null, key), false);
  assert.equal(isTickRequest(`Bearer ${secret}`, ""), false);
});
