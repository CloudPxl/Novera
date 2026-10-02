/**
 * Reads a response body to a fixed size, never more (audit C13).
 *
 * `response.text()` and `.json()` read whatever arrives: a reply that never ends, or a
 * gigabyte, costs the function its memory before anything can refuse it. This reads the
 * stream and stops at the limit. What it counts is what `fetch` hands over — decoded, so
 * a small compressed body that expands is counted at its expanded size — and a
 * Content-Length above the limit is refused before a byte is read. A Content-Length that
 * lies smaller is caught by the count. Bytes that are not valid UTF-8 become U+FFFD, as
 * `text()` would do; they are never a reason to throw.
 *
 * Whatever deadline the request carries (its AbortSignal) also bounds the reading: a body
 * that stalls after the headers ends in the same abort error the request would.
 */
export class BodyTooLarge extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`The response was larger than ${formatLimit(limit)}, so it was not read.`);
    this.name = "BodyTooLarge";
    this.limit = limit;
  }
}

export function formatLimit(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MB` : `${bytes / 1024} KB`;
}

export async function readTextLimited(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await discardBody(response);
    throw new BodyTooLarge(limit);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge(limit);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** JSON within the limit, or null when the body is not JSON. Too large still throws. */
export async function readJsonLimited(response: Response, limit: number): Promise<Record<string, unknown> | null> {
  const text = await readTextLimited(response, limit);
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Releases a body that will not be read, so its connection is not held until collected. */
export async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}
