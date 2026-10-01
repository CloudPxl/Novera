-- A webhook delivery attempt is claimed before it is sent.
--
-- deliverDue read the pending rows and then sent them, so two senders that read at the
-- same moment — a run's own immediate attempt and the clock's sweep, or two sweeps —
-- both POSTed the same delivery, and each wrote back `attempts` from the value it had
-- read, so a failed delivery sent five times was recorded as one attempt (audit
-- 2026-09-30, C2 and C3; 20 of 20 overlapping trials sent twice).
--
-- Now a sender first claims one row in one statement: it takes a lease and a token and
-- counts the attempt, and only the claimant sends. It records the outcome only while its
-- token still stands, so a sender that outlived its lease cannot overwrite the one that
-- took over. Delivery is at-least-once, not exactly-once: a sender can die after the
-- receiver accepted and before recording it, and the row is retried when the lease runs
-- out. That attempt is counted too. Receivers ignore a repeat by `Novera-Delivery`.

alter table webhook_deliveries
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz;

-- The lease is bookkeeping, like the attempt count: it may move while the row is pending.
create or replace function webhook_deliveries_guard()
returns trigger language plpgsql as $$
declare
  moving text[] := array['status', 'attempts', 'last_status', 'last_error', 'next_attempt_at', 'delivered_at', 'lease_token', 'lease_until'];
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A webhook delivery cannot be deleted';
  end if;
  if (to_jsonb(new) - moving) is distinct from (to_jsonb(old) - moving) then
    raise exception 'What a webhook delivery sent cannot be changed';
  end if;
  if old.status <> 'pending' then
    raise exception 'A webhook delivery that was % is final', old.status;
  end if;
  return new;
end;
$$;

-- Claims up to `max_rows` pending deliveries no one holds. Named ones are attempted at once
-- the first time (a run's own immediate attempt) and after that only when due, so a second
-- caller naming the same delivery cannot add an attempt its backoff has not reached. With
-- none named, those due by the database's clock. Rows another claimant is locking are
-- skipped, not waited for.
create or replace function claim_webhook_deliveries(only_ids uuid[], max_rows integer, lease_seconds integer)
returns table (id uuid, lease_token uuid, attempts integer, event text, body jsonb, endpoint_id uuid)
language sql
set search_path = public
as $$
  with candidate as (
    select d.id
      from webhook_deliveries d
     where d.status = 'pending'
       and (d.lease_until is null or d.lease_until < now())
       and (d.next_attempt_at <= now() or (only_ids is not null and d.attempts = 0))
       and (only_ids is null or d.id = any (only_ids))
     order by d.next_attempt_at
     limit greatest(max_rows, 0)
       for update skip locked
  )
  update webhook_deliveries w
     set lease_token = gen_random_uuid(),
         lease_until = now() + make_interval(secs => lease_seconds),
         attempts    = w.attempts + 1
    from candidate
   where w.id = candidate.id
  returning w.id, w.lease_token, w.attempts, w.event, w.body, w.endpoint_id;
$$;
revoke execute on function claim_webhook_deliveries(uuid[], integer, integer) from public, anon, authenticated;
grant execute on function claim_webhook_deliveries(uuid[], integer, integer) to service_role;
