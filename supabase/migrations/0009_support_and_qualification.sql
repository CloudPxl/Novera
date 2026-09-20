-- The two surfaces that face people who are not yet customers.
--
-- Both carry the same discipline as the rest of the product: a reply is drafted, a
-- person approves it, and only then is it sent. Those are three persisted states, not
-- three values of a boolean, because "we sent it" and "we meant to send it" are
-- different facts and a support queue that conflates them will eventually claim to
-- have answered someone it did not.

-- ---------------------------------------------------------------- published docs

-- The only material the support agent may answer from. Nothing else is in scope: an
-- answer that cannot be traced to a row here is not sent.
create table doc_pages (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  body        text not null,
  published   boolean not null default false,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table doc_pages enable row level security;
-- Published pages are world-readable: they are the public documentation.
create policy doc_pages_select on doc_pages for select using (published = true);

-- ---------------------------------------------------------------- inbound

create table inbound_requests (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('support', 'trial_application')),
  email         text not null,
  organisation  text,
  message       text not null,
  -- 'escalated' is not a failure state: it is the correct outcome for anything
  -- consequential, and it is reached deliberately rather than by the model giving up.
  status        text not null default 'new'
                check (status in ('new', 'drafted', 'approved', 'sent', 'escalated', 'closed')),
  escalation_reason text,
  source_ip_hash text,
  created_at    timestamptz not null default now()
);
create index on inbound_requests (status, created_at desc);
create index on inbound_requests (kind, created_at desc);

alter table inbound_requests enable row level security;
-- No policy at all: the queue is staff-only and reached through the service role.
-- A public form inserts through a server action, never straight from the browser.

-- ---------------------------------------------------------------- drafts

create table reply_drafts (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references inbound_requests (id) on delete cascade,
  body         text not null,
  -- Which doc_pages slugs the answer rests on. Validated against real rows before
  -- the draft is stored; an answer citing a page that does not exist is discarded.
  citations    jsonb not null default '[]'::jsonb,
  model        text,
  status       text not null default 'draft' check (status in ('draft', 'approved', 'sent')),
  approved_by  uuid references auth.users (id),
  approved_at  timestamptz,
  sent_at      timestamptz,
  send_error   text,
  created_at   timestamptz not null default now()
);
create index on reply_drafts (request_id, created_at desc);

alter table reply_drafts enable row level security;
-- Staff-only, same as the queue.

-- A draft's text is frozen. Editing one means writing another, exactly as a policy
-- version does — so what a person approved is always what was drafted, and the
-- history shows every wording that was considered.
create or replace function reply_drafts_forward_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A draft cannot be deleted; supersede it with a new one';
  end if;

  if new.body is distinct from old.body
  or new.citations is distinct from old.citations
  or new.request_id is distinct from old.request_id
  or new.created_at is distinct from old.created_at then
    raise exception 'A draft is immutable; write a new draft instead of editing this one';
  end if;

  -- draft -> approved -> sent, one step at a time, never backwards.
  if old.status = 'draft' and new.status not in ('draft', 'approved') then
    raise exception 'A draft must be approved before it can be sent';
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'sent') then
    raise exception 'An approved draft cannot return to %', new.status;
  end if;
  if old.status = 'sent' and new.status <> 'sent' then
    raise exception 'A sent reply cannot be unsent';
  end if;

  if new.status = 'approved' and (new.approved_by is null or new.approved_at is null) then
    raise exception 'An approval must record who made it and when';
  end if;
  if new.status = 'sent' and new.sent_at is null then
    raise exception 'A sent reply must record when it was sent';
  end if;

  return new;
end;
$$;

drop trigger if exists reply_drafts_forward_only on reply_drafts;
create trigger reply_drafts_forward_only before update or delete on reply_drafts
  for each row execute function reply_drafts_forward_only();

comment on table reply_drafts is
  'Drafted replies. Text frozen at insert; status moves draft -> approved -> sent only '
  'forwards; editing means writing a new draft.';
