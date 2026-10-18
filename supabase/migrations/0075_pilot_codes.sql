-- Self-service pilot codes (docs/BILLING-DECISIONS.md, "Pilot codes", 2026-10-17).
--
-- Before billing opens, a workspace past its trial runs only under a manual grant (0060, 0067),
-- which an operator inserted by hand. A pilot code lets the founder hand an agency a single-use
-- code instead: an owner or admin types it on Settings → Billing, and one transaction creates the
-- same `kind = 'pilot'` grant an operator would have inserted, with the same rules (terms frozen,
-- revoked once with a reason, reason and granted_by required).
--
--   billing_pilot_codes              one row per code. The code itself is never stored: only an
--                                    HMAC-SHA256 of its normalised form under the server secret
--                                    (NOVERA_ENCRYPTION_KEY, label "pilot-codes:v1",
--                                    src/lib/billing/pilot-codes.ts), and a hint showing at most a
--                                    third of its start and a sixth of its end. Terms frozen; only
--                                    the redemption count moves, one at a time, never past the
--                                    maximum; revoked once, with a reason; never deleted.
--   billing_pilot_code_redemptions   which workspace redeemed which code, and the grant it got.
--                                    One per workspace (an operator's manual grant is still the
--                                    override). Append-only.
--   redeem_pilot_code()              the only way a code becomes a grant: the code row locked,
--                                    then the grant, the count, the redemption, the billing trail
--                                    line and the audit line, all or nothing.
--
-- Clients write none of this (0057's lesson). Codes are the server's alone: no policy, no grant.
-- A redemption is read like billing_events — by the roles that hold billing.manage — and never
-- shows the code's hash.
--
-- Erasure. A redemption names a workspace, so it leaves with it: its grant_id cascades from
-- billing_entitlement_grants, which erase_workspace() already deletes with novera.erasing on
-- (refuse_mutation lets that delete through), and workspace_id cascades as a second path. The
-- body of erase_workspace() therefore does not change here (as in 0070).
-- A code is not workspace data: it is Novera's own record of an offer it made, holding a hash,
-- a hint, an internal label and terms. Nothing in it names a workspace or a person except
-- `granted_by`, a plain id exactly like billing_entitlement_grants.granted_by: erase_account()
-- (0054, 0058) pseudonymises the sign-in and leaves grants' granted_by as an id that no longer
-- carries a name or an email, and the same holds here, so no erasure path is needed. After a
-- workspace is erased its code keeps its count: a used code stays used.

-- ------------------------------------------------------------------ codes
create table if not exists billing_pilot_codes (
  -- HMAC-SHA256 (hex) of the normalised code. The plaintext is never stored.
  code_hash        text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  -- At most a third of the code's start and a sixth of its end, e.g. "PILOT…30": enough for the
  -- founder's listing and the grant's reason, never enough to reconstruct a code.
  hint             text not null check (char_length(hint) between 3 and 40),
  -- Internal, for the founder's listing (it may name the agency). Never copied into a grant,
  -- an event or anything a workspace can read.
  label            text not null check (char_length(btrim(label)) between 1 and 200),
  runs_allowed     integer not null default 50 check (runs_allowed between 1 and 500),
  duration_days    integer not null default 30 check (duration_days between 1 and 365),
  max_redemptions  integer not null default 1 check (max_redemptions >= 1),
  redemptions_count integer not null default 0,
  -- The redeem-by deadline. Null: no deadline.
  expires_at       timestamptz,
  -- Who offered it: copied to each grant's granted_by. A plain id, like the grant's.
  granted_by       uuid not null,
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_reason   text,
  check (redemptions_count between 0 and max_redemptions),
  check (expires_at is null or expires_at > created_at),
  check ((revoked_at is null) = (revoked_reason is null)),
  check (revoked_reason is null or char_length(btrim(revoked_reason)) between 3 and 500)
);

comment on table billing_pilot_codes is
  'Single-use (or few-use) pilot codes, stored as an HMAC of the code. Terms frozen; only the redemption count moves, +1 at a time, never past the maximum; revoked once with a reason; never deleted. Server only.';

create or replace function billing_pilot_codes_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A pilot code is revoked, not deleted.';
  end if;

  if tg_op = 'INSERT' then
    if new.redemptions_count <> 0 or new.revoked_at is not null then
      raise exception 'A pilot code starts unused and not revoked.';
    end if;
    return new;
  end if;

  if new.code_hash <> old.code_hash or new.hint <> old.hint or new.label <> old.label
     or new.runs_allowed <> old.runs_allowed or new.duration_days <> old.duration_days
     or new.max_redemptions <> old.max_redemptions or new.expires_at is distinct from old.expires_at
     or new.granted_by <> old.granted_by or new.created_at <> old.created_at then
    raise exception 'A pilot code''s terms are frozen; revoke it and create another.';
  end if;

  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at or new.revoked_reason is distinct from old.revoked_reason) then
    raise exception 'A revoked pilot code stays revoked.';
  end if;

  if new.redemptions_count <> old.redemptions_count then
    if new.redemptions_count <> old.redemptions_count + 1 then
      raise exception 'A pilot code''s redemptions are counted one at a time, upwards.';
    end if;
    if old.revoked_at is not null or new.revoked_at is not null then
      raise exception 'A revoked pilot code takes no redemption.';
    end if;
    if old.expires_at is not null and now() >= old.expires_at then
      raise exception 'An expired pilot code takes no redemption.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists billing_pilot_codes_guard on billing_pilot_codes;
create trigger billing_pilot_codes_guard before insert or update or delete on billing_pilot_codes
  for each row execute function billing_pilot_codes_guard();

alter table billing_pilot_codes enable row level security;
-- No policy: the codes are the server's. Nothing signed in reads or writes them.
revoke all on billing_pilot_codes from public, anon, authenticated;

-- ------------------------------------------------------------------ redemptions
create table if not exists billing_pilot_code_redemptions (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null references billing_pilot_codes (code_hash),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Erasure path: erase_workspace() deletes the grant, and this row goes with it.
  grant_id     uuid not null unique references billing_entitlement_grants (id) on delete cascade,
  -- The owner or admin who typed it. A plain id, like audit_events.actor_id.
  redeemed_by  uuid not null,
  created_at   timestamptz not null default now(),
  unique (code_hash, workspace_id),
  -- One pilot code per workspace. An operator's manual grant stays the override.
  unique (workspace_id)
);

comment on table billing_pilot_code_redemptions is
  'Which workspace redeemed which pilot code, and the grant it produced. One per workspace; append-only; leaves with its workspace through the grant it names.';

drop trigger if exists billing_pilot_code_redemptions_append_only on billing_pilot_code_redemptions;
create trigger billing_pilot_code_redemptions_append_only before update or delete on billing_pilot_code_redemptions
  for each row execute function refuse_mutation();

drop trigger if exists billing_pilot_code_redemptions_same_workspace on billing_pilot_code_redemptions;
create trigger billing_pilot_code_redemptions_same_workspace before insert or update on billing_pilot_code_redemptions
  for each row execute function refuse_cross_workspace('grant_id', 'billing_entitlement_grants');

alter table billing_pilot_code_redemptions enable row level security;
-- Read like billing_events: by the roles that hold billing.manage. The grant itself stays
-- readable by every member (0060); this is the record of who redeemed it.
drop policy if exists billing_pilot_code_redemptions_select on billing_pilot_code_redemptions;
create policy billing_pilot_code_redemptions_select on billing_pilot_code_redemptions for select
  using (has_workspace_role(workspace_id, array['owner', 'admin']));
revoke all on billing_pilot_code_redemptions from public, anon, authenticated;
-- Every column but the code's hash.
grant select (id, workspace_id, grant_id, redeemed_by, created_at) on billing_pilot_code_redemptions to authenticated;

-- ------------------------------------------------------------------ redeeming
-- Outcomes, as jsonb {outcome, ...}:
--   redeemed             {grant_id, runs_allowed, ends_at}
--   workspace_has_pilot  this workspace already redeemed a code. Checked before the code is
--                        looked at, so a workspace that has one learns nothing about other codes.
--   invalid              unknown, revoked or past its redeem-by date: one outcome, so the answer
--                        is not an oracle for which codes exist.
--   used_up              every redemption the code allows has been made.
create or replace function redeem_pilot_code(p_code_hash text, p_workspace uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c billing_pilot_codes%rowtype;
  grant_row uuid;
  ends timestamptz;
begin
  -- The server checked the role (billing.manage); checked again here, for the service role too.
  if not exists (
    select 1 from workspace_members
     where workspace_id = p_workspace and user_id = p_user and role in ('owner', 'admin')
  ) then
    raise exception 'Only an owner or admin of the workspace redeems a pilot code.' using errcode = '42501';
  end if;

  if exists (select 1 from billing_pilot_code_redemptions where workspace_id = p_workspace) then
    return jsonb_build_object('outcome', 'workspace_has_pilot');
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Two workspaces racing for one single-use code queue here; the second reads the first's count.
  select * into c from billing_pilot_codes where code_hash = p_code_hash for update;
  if not found or c.revoked_at is not null or (c.expires_at is not null and now() >= c.expires_at) then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if c.redemptions_count >= c.max_redemptions then
    return jsonb_build_object('outcome', 'used_up');
  end if;

  ends := now() + make_interval(days => c.duration_days);
  begin
    -- The reason names the code by its hint only. The label is internal and may name the agency;
    -- every member of the workspace reads a grant's reason.
    insert into billing_entitlement_grants (workspace_id, kind, runs_allowed, ends_at, reason, granted_by)
    values (p_workspace, 'pilot', c.runs_allowed, ends, 'Pilot code ' || c.hint || ' redeemed', c.granted_by)
    returning id into grant_row;

    update billing_pilot_codes set redemptions_count = redemptions_count + 1 where code_hash = c.code_hash;

    insert into billing_pilot_code_redemptions (code_hash, workspace_id, grant_id, redeemed_by)
    values (c.code_hash, p_workspace, grant_row, p_user);

    -- The billing trail and the workspace's audit trail. Ids and counts; never the code or its hash.
    insert into billing_events (workspace_id, actor_id, source, action, detail)
    values (p_workspace, p_user, 'member', 'pilot_code.redeemed', jsonb_build_object(
      'grant_id', grant_row, 'runs_allowed', c.runs_allowed, 'duration_days', c.duration_days, 'ends_at', ends));
    insert into audit_events (workspace_id, actor_id, action, detail)
    values (p_workspace, p_user, 'billing.pilot_code_redeemed', jsonb_build_object(
      'grant_id', grant_row, 'runs_allowed', c.runs_allowed, 'ends_at', ends));
  exception when unique_violation then
    -- The same workspace redeemed another code at the same moment and won. Everything in this
    -- block is undone; the count did not move.
    return jsonb_build_object('outcome', 'workspace_has_pilot');
  end;

  return jsonb_build_object('outcome', 'redeemed', 'grant_id', grant_row, 'runs_allowed', c.runs_allowed, 'ends_at', ends);
end;
$$;

revoke all on function redeem_pilot_code(text, uuid, uuid) from public, anon, authenticated;
revoke all on function billing_pilot_codes_guard() from public, anon, authenticated;

comment on function redeem_pilot_code(text, uuid, uuid) is
  'Turns a pilot code into a pilot grant for one workspace, all or nothing: redeemed, workspace_has_pilot, invalid (unknown, revoked or expired) or used_up. Service role only.';
