/** JSON for an API caller: never cached, never indexed. */
export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}

/** A report's public link, for a caller that already holds this workspace's key. */
export function reportUrl(origin: string, token: string): string {
  return `${origin}/report/${token}`;
}
