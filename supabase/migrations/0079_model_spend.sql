-- What Novera's own paid model key costs, call by call, and the month's running total
-- (2026-10-22).
--
-- Novera now holds a paid Gemini key (AI Studio, billed against a fixed credit). A run, a
-- diagnosis or a Suite Builder extraction graded on it costs money, and nothing counted that
-- money: a busy pilot week or a loop could spend the credit. The router (src/lib/router/execute.ts)
-- writes one row here for every call it makes on a paid connection of ours, priced from the
-- published table in src/lib/billing/model-prices.ts, and before each such call it reads this
-- month's total: once the monthly budget (NOVERA_MODEL_BUDGET_USD, default 50) is spent, the paid
-- connection is skipped and grading continues on the free vendors, labelled as always.
--
-- A row holds a connection, a model, a purpose, token counts and a price — no prompt, no reply, no
-- workspace, no person. It is Novera's own operating record, not tenant data, so no workspace or
-- account erasure touches it and it needs no erasure path of its own. Append-only.

create table if not exists model_spend (
  id               bigserial primary key,
  occurred_at      timestamptz not null default now(),
  period           date not null default (date_trunc('month', now() at time zone 'utc'))::date,
  connection       text not null,
  model            text not null,
  purpose          text not null,
  input_tokens     integer not null default 0 check (input_tokens >= 0),
  cached_tokens    integer not null default 0 check (cached_tokens >= 0),
  output_tokens    integer not null default 0 check (output_tokens >= 0),
  cost_micro_usd   bigint not null check (cost_micro_usd >= 0)
);
create index if not exists model_spend_period on model_spend (period);

create table if not exists model_spend_months (
  period          date primary key,
  cost_micro_usd  bigint not null default 0,
  calls           integer not null default 0
);

alter table model_spend enable row level security;
alter table model_spend_months enable row level security;
revoke all on model_spend from anon, authenticated;
revoke all on model_spend_months from anon, authenticated;

create or replace function model_spend_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'model_spend is append-only';
end;
$$;
drop trigger if exists model_spend_frozen on model_spend;
create trigger model_spend_frozen before update or delete on model_spend
  for each row execute function model_spend_frozen();

-- The month's total, kept with every insert so the router's check is one row read.
create or replace function model_spend_add_to_month()
returns trigger language plpgsql as $$
begin
  insert into model_spend_months (period, cost_micro_usd, calls)
  values (new.period, new.cost_micro_usd, 1)
  on conflict (period) do update
    set cost_micro_usd = model_spend_months.cost_micro_usd + excluded.cost_micro_usd,
        calls = model_spend_months.calls + 1;
  return new;
end;
$$;
drop trigger if exists model_spend_add_to_month on model_spend;
create trigger model_spend_add_to_month after insert on model_spend
  for each row execute function model_spend_add_to_month();
