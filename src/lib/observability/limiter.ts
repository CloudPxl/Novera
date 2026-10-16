/**
 * A fixed-window counter, per function instance: at most `limit` yeses in each `windowMs`.
 * In memory, so each instance has its own window; that is enough to keep a burst of identical
 * failures from becoming a burst of vendor calls, and it needs no store.
 */
export function windowLimiter(limit: number, windowMs: number): (now: number) => boolean {
  let start = 0;
  let count = 0;
  return (now) => {
    if (now - start > windowMs) { start = now; count = 0; }
    count++;
    return count <= limit;
  };
}
