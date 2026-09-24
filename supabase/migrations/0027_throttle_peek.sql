-- Reading a throttle counter without spending one.
--
-- `throttle_hit` always increments, which is right for a form: every submission is an
-- act worth counting. A sign-in is different — the thing worth counting is a *failed*
-- attempt, because counting successes would lock a person out of their own evidence
-- for signing in too often, and the limit exists to slow guessing rather than use.
--
-- That needs two operations: ask whether this identifier is already over the limit,
-- and, only when the password was wrong, count one. Computing the current window in
-- application code instead would put the same bucket arithmetic in two languages,
-- which is how the two stop agreeing.
--
-- No new table, no new data, and nothing to erase: it reads `request_throttle`, whose
-- rows already expire and are already swept by `throttle_hit`.

create or replace function throttle_peek(key text, window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket timestamptz;
  hits   integer;
begin
  if window_seconds is null or window_seconds < 1 then
    raise exception 'A throttle window must be at least one second';
  end if;

  bucket := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);

  select count into hits
  from request_throttle
  where identifier = key and window_start = bucket;

  return coalesce(hits, 0);
end;
$$;

comment on function throttle_peek is
  'Current count for an identifier in the window it falls in, without incrementing. For limits that should only count failures.';
