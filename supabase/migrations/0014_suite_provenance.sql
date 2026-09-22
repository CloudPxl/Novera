-- Where an imported suite came from.
--
-- A suite decides what every future score is out of, so "who wrote these scenarios and
-- when" is part of the evidence, not metadata. A report that cites `acme-support v1`
-- should be traceable to the file someone uploaded, the tool that produced it, and the
-- day it entered the workspace — otherwise the most load-bearing input to a client
-- document is the one thing with no history.
--
-- Null for the suites shipped with the product: those are versioned in the repository,
-- which is a better provenance record than a row could be.

alter table suites
  add column provenance jsonb;

comment on column suites.provenance is
  'How an imported suite arrived: source tool and version, original filename, byte size, '
  'a SHA-256 of the uploaded file, who imported it and when. Null for built-in suites, '
  'which are versioned in the repository instead.';
