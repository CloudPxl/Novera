/**
 * How a delivery attempt is shown: the receiver's status and how long it took to answer,
 * "200 · 184 ms". Either part is left out when it was not recorded — an attempt that was never
 * sent has neither, and one that timed out has a time but no status.
 */
export function statusAndLatency(status: number | null | undefined, latencyMs: number | null | undefined): string {
  const parts: string[] = [];
  if (typeof status === "number") parts.push(String(status));
  if (typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0) {
    parts.push(latencyMs >= 10_000 ? `${(latencyMs / 1000).toFixed(1)} s` : `${Math.round(latencyMs)} ms`);
  }
  return parts.join(" · ");
}

/** The deliveries the settings page lists, newest first: the brief's last ten. */
export const RECENT_DELIVERIES = 10;
