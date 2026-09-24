-- A public write cannot be free.
--
-- `submitSupportRequest` and `submitTrialApplication` take anonymous POSTs, store a
-- row, and then call a model to draft an answer. Nothing limited how often. A script
-- drains the free-tier grading quota, fills the queue the operator reads, and takes
-- the product down for the one person running it.
--
-- Counted in Postgres rather than in memory, because a Vercel function is not one
-- process: an in-memory counter limits one lambda for as long as it happens to live,
-- which is to say it limits nothing.

create table if not exists request_throttle (
  -- A salted hash of who is asking — never an address, never an email. See
  -- src/lib/support/rate-limit.ts for what goes into it.
  identifier   text not null,
  -- The start of the fixed window this count belongs to.
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (identifier, window_start)
);

alter table request_throttle enable row level security;
-- No policies on purpose: nothing signed in has any business reading this, and the
-- public actions reach it through the service role.

comment on table request_throttle is
  'Fixed-window counters for unauthenticated writes. Holds salted hashes only, and '
  'rows older than a day are removed on the next write rather than kept.';

/**
 * One hit against a window, counted atomically.
 *
 * `on conflict … do update` rather than read-then-write: two requests arriving in the
 * same millisecond must not both read 4 and both decide they are under a limit of 5.
 */
create or replace function throttle_hit(key text, window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket timestamptz;
  hits integer;
begin
  if window_seconds is null or window_seconds < 1 then
    raise exception 'A throttle window must be at least one second';
  end if;

  bucket := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);

  -- Expired counters are rubbish, and this is the only scheduled moment we have on a
  -- free tier. Cheap: the index is the primary key and the range is closed.
  delete from request_throttle where window_start < now() - interval '1 day';

  insert into request_throttle (identifier, window_start, count)
  values (key, bucket, 1)
  on conflict (identifier, window_start)
    do update set count = request_throttle.count + 1
  returning count into hits;

  return hits;
end;
$$;

revoke execute on function throttle_hit(text, integer) from anon, authenticated;

comment on function throttle_hit(text, integer) is
  'Increments and returns the count for one identifier in the current fixed window. '
  'Service role only.';
