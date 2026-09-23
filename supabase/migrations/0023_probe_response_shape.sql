-- What the agent's response looked like, so the operator does not have to guess.
--
-- Connecting an agent asks for a dot path into a response the operator has often never
-- seen. Get it wrong and the probe says "No text found at response path" — which is
-- true, unhelpful, and the most common place an integration dies, before anyone has
-- watched Novera do anything.
--
-- The probe already has the answer in its hands. This keeps it: the paths to every
-- string in the response, each with a short preview, and the ranked guesses at which
-- one is the reply.
--
-- Deliberately not the raw body. The response belongs to the customer and could
-- contain anything; a shape with truncated previews is what is needed to offer "your
-- reply looks like it is at data.output", and nothing more is stored to do it. The
-- previews are capped in code (90 characters, 60 paths, the first three entries of any
-- array), because a column that could hold a whole transcript eventually holds one.
--
-- No erasure path is needed here that does not already exist: probes are deleted with
-- their workspace in erase_workspace(), and this column travels with the row.

alter table probes add column if not exists response_shape jsonb;

comment on column probes.response_shape is
  'Paths to the text in the probe response, with truncated previews and ranked guesses '
  'at where the reply sits. Operator-facing only; never rendered into a client report. '
  'Not the raw body — only enough to suggest a response path.';
