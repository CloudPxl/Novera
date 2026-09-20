-- A diagnosis is a decision record, and a decision record that can be rewritten is
-- not evidence of anything.
--
-- `diagnoses` was left mutable on purpose: unlike a verdict or a policy version, it
-- genuinely has to change state once, from 'proposed' to 'approved' or 'rejected'.
-- But "mutable once, in one direction" is a much narrower rule than "mutable", and
-- nothing was enforcing the difference. Without this, an approved change could be
-- quietly flipped to rejected after a bad rerun, or the model's analysis edited to
-- match whatever the policy ended up saying.
--
-- So: the analysis is frozen at insert, the decision may be made exactly once, and
-- deletion is refused outside an authorised workspace erasure — the same rule the
-- rest of the evidence tables follow (0005).

create or replace function diagnoses_decide_once()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A diagnosis cannot be deleted; reject it instead';
  end if;

  -- What the model was asked, what it said, and what it quoted are the evidence.
  if new.workspace_id  is distinct from old.workspace_id
  or new.run_case_id   is distinct from old.run_case_id
  or new.analysis      is distinct from old.analysis
  or new.quoted_old    is distinct from old.quoted_old
  or new.proposed_new  is distinct from old.proposed_new
  or new.risks         is distinct from old.risks
  or new.created_at    is distinct from old.created_at then
    raise exception 'A diagnosis is immutable except for its decision';
  end if;

  if old.status <> 'proposed' then
    raise exception 'This diagnosis was already %; a decision is made once', old.status;
  end if;

  if new.status not in ('approved', 'rejected') then
    raise exception 'A decision must be either approved or rejected';
  end if;

  -- An approval is what creates a policy version, so it must name the one it created.
  if new.status = 'approved' and new.resulting_policy_id is null then
    raise exception 'An approved diagnosis must name the policy version it produced';
  end if;

  if new.decided_by is null or new.decided_at is null then
    raise exception 'A decision must record who made it and when';
  end if;

  return new;
end;
$$;

drop trigger if exists diagnoses_decide_once on diagnoses;
create trigger diagnoses_decide_once before update or delete on diagnoses
  for each row execute function diagnoses_decide_once();

comment on table diagnoses is
  'Proposed policy changes. Frozen at insert; decided exactly once; never deleted '
  'outside an authorised workspace erasure.';
