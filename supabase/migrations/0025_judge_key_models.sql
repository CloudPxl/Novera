-- Which models a workspace's own key is allowed to grade with.
--
-- The settings form has always asked for a model, used it to prove the key worked, and
-- then thrown it away. At run time the grading route came from DEFAULT_ROUTES, which
-- names *our* connections — so a workspace holding a google, anthropic or openrouter
-- key had no routable candidate at all and every case in the run errored. The model the
-- customer named is the only thing that can say what their key can actually serve, so it
-- is kept with the credential it belongs to.
--
-- An array rather than a column, because two models from one vendor is a materially
-- different product from one: consensus can ask a second opinion and the verdict is
-- recorded as corroborated within one vendor instead of not corroborated at all. The
-- cap is enforced in code, not here; what the database enforces is that the list is
-- never empty when it exists, since an empty array would resolve to a route with no
-- candidates — the exact failure this column was added to end.
--
-- No new erasure path: secrets are deleted with their workspace in erase_workspace(),
-- and this column travels with the row.

alter table secrets add column if not exists models text[];

alter table secrets drop constraint if exists secrets_models_not_empty;
alter table secrets add constraint secrets_models_not_empty
  check (models is null or array_length(models, 1) >= 1);

comment on column secrets.models is
  'For scope=judge_key: the models this key may grade with, in the order the customer '
  'named them, proved reachable before the key was stored. Null on secrets that are not '
  'a judge key, and on judge keys stored before 2026-09-24.';
