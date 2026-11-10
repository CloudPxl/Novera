import type { Category } from "./types.ts";

/**
 * Whether a scan may be queued now. Every rule here is also held by the database or the claim
 * function (0082): a target that is not Category A, or marked do-not-contact, is refused at
 * claim time even if a queued row got in; one active scan per target is a unique index. This
 * function exists so the refusal is worded before anything is written.
 */
export const SCAN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** A worker not seen for this long is probably not running; the page says so, the scan still queues. */
export const WORKER_STALE_MS = 10 * 60 * 1000;

export function scanRefusal(input: {
  category: Category;
  doNotContact: boolean;
  activeScan: boolean;
  lastScanAt: string | null;
  now: Date;
}): string | null {
  if (input.doNotContact) return "This target is marked do not contact. No scan is run for it.";
  if (input.category === "D") return "Category D is never tested.";
  if (input.category === "C") {
    return "Category C is behind a login. It is evaluated only with the owner's authorisation and safe credentials, on the staging-evaluation path.";
  }
  if (input.category === "B") {
    return "Category B can touch real money, orders or accounts. It is evaluated only with the owner's authorisation; offer a staging evaluation instead.";
  }
  if (input.activeScan) return "A scan of this target is already queued or running. One session at a time.";
  if (input.lastScanAt) {
    const since = input.now.getTime() - Date.parse(input.lastScanAt);
    if (since < SCAN_COOLDOWN_MS) {
      const hours = Math.max(1, Math.ceil((SCAN_COOLDOWN_MS - since) / 3_600_000));
      return `This target was scanned less than 24 hours ago. The next scan can start in about ${hours} hour${hours === 1 ? "" : "s"}.`;
    }
  }
  return null;
}

/** A notice, not a refusal: the scan queues either way. */
export function workerNotice(lastSeenAt: string | null, now: Date): string | null {
  if (!lastSeenAt) return "No browser worker has connected to this deployment yet. The scan waits in the queue until one does.";
  const since = now.getTime() - Date.parse(lastSeenAt);
  if (since > WORKER_STALE_MS) {
    const minutes = Math.round(since / 60_000);
    return `The browser worker was last seen ${minutes} minutes ago. The scan waits in the queue until it reports again.`;
  }
  return null;
}
