-- Correcting the constraint added in 0025, which did not hold.
--
-- `array_length('{}', 1)` is NULL, not 0 — an empty array has no first dimension. So
-- `models is null or array_length(models, 1) >= 1` evaluated to NULL for the one value
-- it was written to refuse, and a CHECK that evaluates to NULL passes. An empty model
-- list was therefore storable, and an empty model list is precisely the state 0025
-- exists to prevent: a key recorded as gradeable that resolves to a route with no
-- candidates, which errors every case in the run.
--
-- 0025 is already applied, and a migration that has run is not edited. This replaces
-- the constraint rather than amending history.
--
-- Caught by `npm run verify:byok`, which asserts the insert is refused, and would not
-- have been caught by reading the SQL — which is why the check is in the script.

alter table secrets drop constraint if exists secrets_models_not_empty;
alter table secrets add constraint secrets_models_not_empty
  check (models is null or coalesce(array_length(models, 1), 0) >= 1);
