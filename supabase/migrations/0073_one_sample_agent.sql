-- One sample agent per workspace, however many clicks race (2026-10-17).
--
-- "Or try a sample support agent first" reuses a workspace's sample when one exists, but the
-- read and the insert are two statements: two clicks within milliseconds both found none and
-- both inserted, leaving two samples and two policies (found by the Block 6 chaos audit). An
-- agent cannot be deleted, so the duplicate could not even be cleaned up afterwards.
--
-- The index makes the second insert fail; the action then opens the sample the first one made.
-- It covers only the sample — Novera's own name on an address ending in the fixture's path —
-- so a customer's agents, whatever they are called, are untouched. An archived sample is
-- outside it, so a new one can be made after archiving, as the action allows.
--
-- A workspace that already holds two samples keeps the oldest; each later one is archived
-- (named as archived by the person who created it), which is what archiving is for: nothing new
-- reaches it, and its runs and reports still name it. No other row changes. The index changes no
-- rule about erasure, so it needs no erasure path: it goes with the rows.

update agents a
   set archived_at = now(), archived_by = a.attested_by
 where a.id in (
   select id from (
     select id, row_number() over (partition by workspace_id order by created_at, id) as nth
       from agents
      where archived_at is null
        and name = 'Sample support agent (Novera test fixture)'
        and (config ->> 'url') like '%/api/test-agent'
   ) samples
   where nth > 1
 );

create unique index if not exists agents_one_sample_per_workspace
  on agents (workspace_id)
  where archived_at is null
    and name = 'Sample support agent (Novera test fixture)'
    and (config ->> 'url') like '%/api/test-agent';
