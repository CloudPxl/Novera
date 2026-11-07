-- The sample agent points at the canonical host (2026-11-07).
--
-- `createSampleAgent` built the sample's address from NEXT_PUBLIC_APP_URL. Where that named the
-- apex (https://nover.space), the sample was stored as https://nover.space/api/test-agent — and in
-- production every host but www.nover.space answers with a 308 before the route runs
-- (src/lib/net/canonical-host.ts). A run never follows a redirect, so every scenario of every run
-- against such a sample was recorded as "Agent returned HTTP 308", and its read-back
-- (/api/test-verification/) was unavailable for the same reason.
--
-- New samples are connected on the canonical host in production (`sampleOrigin`). This repairs the
-- ones already stored: only an agent that is the sample by name AND whose address is the fixture's
-- on Novera's own apex (or the fixture's with a trailing slash, which also redirects). Nothing
-- else in the row changes; a customer's agent can never match. The sample carries no credential,
-- so the rule that a credential never follows its address to another host has nothing to move.
-- Runs keep the address they recorded when they started: a manifest is frozen (0016).
--
-- An update to existing rows creates nothing, so it needs no erasure path. Idempotent: a repaired
-- row no longer matches.

update agents
   set config = jsonb_set(config, '{url}', to_jsonb('https://www.nover.space/api/test-agent'::text)),
       verification = case
         when verification ->> 'url' ~ '^https://nover\.space/api/test-verification/?$'
           then jsonb_set(verification, '{url}', to_jsonb('https://www.nover.space/api/test-verification/'::text))
         else verification
       end
 where name = 'Sample support agent (Novera test fixture)'
   and kind = 'http'
   and config ->> 'url' ~ '^https://(nover\.space/api/test-agent/?|www\.nover\.space/api/test-agent/)$';
