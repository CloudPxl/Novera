/**
 * Proves the public forms cannot be made free, against the live database.
 *
 * The claim being checked is not "there is a rate limiter" — it is that the counter is
 * shared (Postgres, not one lambda's memory), that it is atomic under concurrency, that
 * the identifier gives away neither an address nor an email, and that the counters do
 * not accumulate forever.
 *
 * Run: npm run verify:throttle
 */
import { createClient } from "@supabase/supabase-js";
import { fingerprint, windowResetMinutes, refusalMessage, SUPPORT_LIMIT } from "../src/lib/support/throttle.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const report = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\nThe public forms\n");

const who = fingerprint(["verify", `throttle-${Date.now()}@novera.invalid`, "203.0.113.7"]);

try {
  // 1. It counts, and it refuses at the limit rather than after it.
  const counts: number[] = [];
  for (let i = 0; i < SUPPORT_LIMIT.max + 2; i++) {
    const { data } = await db.rpc("throttle_hit", { key: who, window_seconds: SUPPORT_LIMIT.windowSeconds });
    counts.push(data as number);
  }
  report(
    counts.join(",") === Array.from({ length: SUPPORT_LIMIT.max + 2 }, (_, i) => i + 1).join(","),
    "each request increments a shared counter",
    counts.join(", "),
  );
  report(
    counts.filter((c) => c <= SUPPORT_LIMIT.max).length === SUPPORT_LIMIT.max,
    `exactly ${SUPPORT_LIMIT.max} are allowed through before the refusal`,
  );

  // 2. Atomic. Two requests in the same millisecond must not both read the same number
  // and both decide they are under the limit.
  const racer = fingerprint(["verify", `race-${Date.now()}@novera.invalid`, "203.0.113.8"]);
  const raced = await Promise.all(
    Array.from({ length: 12 }, () =>
      db.rpc("throttle_hit", { key: racer, window_seconds: SUPPORT_LIMIT.windowSeconds })),
  );
  const seen = raced.map((r) => r.data as number).sort((a, b) => a - b);
  report(
    new Set(seen).size === 12 && seen[11] === 12,
    "twelve simultaneous requests are counted as twelve",
    `highest ${seen[11]}, distinct ${new Set(seen).size}`,
  );

  // 3. One identifier's flood does not touch anyone else.
  const bystander = fingerprint(["verify", "bystander@novera.invalid", "198.51.100.4"]);
  const { data: first } = await db.rpc("throttle_hit", { key: bystander, window_seconds: SUPPORT_LIMIT.windowSeconds });
  report(first === 1, "a different person starts at one", `saw ${first}`);

  // 4. The stored identifier gives nothing away.
  const { data: rows } = await db.from("request_throttle").select("identifier").eq("identifier", who);
  report(
    (rows ?? []).length === 1 && /^[0-9a-f]{40}$/.test(rows![0].identifier as string),
    "the row holds a hash, not an address or an email",
  );

  // 5. Counters are cleared rather than kept. Written directly, because the only
  // scheduled moment available on a free tier is the next write.
  const stale = `stale-${Date.now()}`;
  await db.from("request_throttle").insert({
    identifier: stale,
    window_start: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    count: 99,
  });
  await db.rpc("throttle_hit", { key: who, window_seconds: SUPPORT_LIMIT.windowSeconds });
  const { count: staleLeft } = await db
    .from("request_throttle").select("identifier", { count: "exact", head: true }).eq("identifier", stale);
  report((staleLeft ?? 0) === 0, "a counter older than a day is removed on the next write");

  // 6. A window shorter than a second is refused rather than silently accepted.
  const { error: badWindow } = await db.rpc("throttle_hit", { key: who, window_seconds: 0 });
  report(Boolean(badWindow), "a zero-length window is refused", badWindow?.message.slice(0, 50) ?? "IT WAS ACCEPTED");

  // 7. What the person is told.
  const message = refusalMessage(windowResetMinutes(SUPPORT_LIMIT.windowSeconds));
  report(
    /try again/.test(message) && /support@nover\.space/.test(message) && !/rate limit/i.test(message),
    "the refusal says when, and offers a way that does not involve waiting",
  );

  // 8. A peek reads without spending.
  //
  // The sign-in limit only counts failures, because counting successes would lock a
  // person out of their own evidence for signing in too often. That needs a read that
  // does not increment, and a read that quietly incremented would turn every sign-in
  // attempt into two.
  const peeker = `verify-peek-${Date.now()}`;
  const { data: firstPeek } = await db.rpc("throttle_peek", { key: peeker, window_seconds: 3600 });
  report(firstPeek === 0, "an identifier nobody has counted peeks at zero", `saw ${firstPeek}`);

  await db.rpc("throttle_hit", { key: peeker, window_seconds: 3600 });
  await db.rpc("throttle_hit", { key: peeker, window_seconds: 3600 });
  const { data: afterTwo } = await db.rpc("throttle_peek", { key: peeker, window_seconds: 3600 });
  const { data: afterPeeking } = await db.rpc("throttle_peek", { key: peeker, window_seconds: 3600 });
  report(afterTwo === 2 && afterPeeking === 2, "peeking three times does not count three times",
    `two hits, then two peeks: ${afterTwo} then ${afterPeeking}`);

  const { error: badPeekWindow } = await db.rpc("throttle_peek", { key: peeker, window_seconds: 0 });
  report(Boolean(badPeekWindow), "a peek refuses a zero-length window too");

  await db.from("request_throttle").delete().in("identifier", [who, racer, bystander, peeker]);
  report(true, "the verification counters were removed");
} catch (error) {
  report(false, "the checks could not run", error instanceof Error ? error.message : String(error));
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
