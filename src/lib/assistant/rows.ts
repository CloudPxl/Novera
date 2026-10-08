/**
 * The two rows one question and its answer are stored as.
 *
 * Every row carries every column. PostgREST inserts several rows with the union of their keys
 * and writes NULL — not the column default — where a row leaves one out: the question row had
 * no `citations`, a NOT NULL column, so every Ask Novera answer since 0054 failed to save and the
 * person read "The conversation could not be saved" (found by the production audit, 2026-10-08).
 */
export function messageRows(threadId: string, question: string, answer: { reply: string; citations: string[]; fundedBy: string; model: string | null }) {
  return [
    { thread_id: threadId, role: "user" as const, content: question, citations: [] as string[], funded_by: null, model: null },
    { thread_id: threadId, role: "assistant" as const, content: answer.reply, citations: answer.citations, funded_by: answer.fundedBy, model: answer.model },
  ];
}
