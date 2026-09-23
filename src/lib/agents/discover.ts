/**
 * Finding the reply in someone else's JSON.
 *
 * Connecting an agent asks the operator for a dot path into a response they have
 * probably never looked at. They get one shot at guessing it, the probe fails with
 * "No text found at response path", and the product has told them nothing they did not
 * already know. This is the single most common place an integration dies, and it dies
 * before anyone has seen what Novera does.
 *
 * So: read the response that actually came back and say where the reply looks like it
 * is. Discovery happens once, at connection time, and the chosen path is *stored*. It
 * is never re-guessed during a run — a suite that resolved its own paths per response
 * could grade two scenarios off two different fields and call the difference a
 * regression.
 */

/** A string leaf in a response, with enough of it to recognise. */
export interface ShapePath {
  path: string;
  preview: string;
  /** Length of the full value, so a truncated preview is not mistaken for the whole. */
  length: number;
}

export interface DiscoveredShape {
  paths: ShapePath[];
  /** Ranked best guesses for where the reply text is. */
  replyPaths: string[];
  /** Ranked best guesses for a list of recorded tool calls. */
  toolPaths: string[];
}

const MAX_PATHS = 60;
const PREVIEW = 90;

/**
 * Key names that carry a reply, most conventional first. Ordering is the ranking:
 * a response with both `message` and `reply` almost always means the second.
 */
const REPLY_KEYS = [
  "reply", "answer", "output_text", "output", "text", "content", "message",
  "response", "result", "completion", "data",
];

const TOOL_KEYS = [
  "tool_calls", "toolCalls", "tools", "tool_activity", "toolActivity",
  "actions", "steps", "trace", "function_calls",
];

/** The keys that indicate an array really is tool activity rather than any old list. */
const TOOL_ITEM_KEYS = ["tool", "name", "tool_name", "function", "arguments", "args", "input"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walks a parsed response collecting every string leaf.
 *
 * Arrays are indexed rather than summarised, because `choices.0.message.content` is a
 * real path an operator needs and "an array of things" is not.
 */
export function describeShape(source: unknown): ShapePath[] {
  const found: ShapePath[] = [];

  const walk = (value: unknown, path: string, depth: number) => {
    if (found.length >= MAX_PATHS || depth > 6) return;

    if (typeof value === "string") {
      if (value.trim()) {
        found.push({
          path,
          preview: value.length > PREVIEW ? `${value.slice(0, PREVIEW)}…` : value,
          length: value.length,
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      // Only the first few entries: a hundred-item array would bury everything else,
      // and the operator needs the shape, not the contents.
      value.slice(0, 3).forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i), depth + 1));
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };

  walk(source, "", 0);
  return found;
}

/**
 * Scores a string leaf for being the reply.
 *
 * Length matters, but not linearly and not most: a long string is usually the answer,
 * yet an `id` or a base64 blob is long too. The key name is the stronger signal, and a
 * leaf whose final key says nothing is only a candidate if nothing better exists.
 */
function scoreReply(p: ShapePath): number {
  const segments = p.path.split(".");
  const last = segments[segments.length - 1].toLowerCase();
  const keyRank = REPLY_KEYS.indexOf(last);

  let score = 0;
  if (keyRank >= 0) score += 100 - keyRank * 5;

  // A conventional full path beats a conventional key on its own.
  if (/^choices\.\d+\.message\.content$/.test(p.path)) score += 60;
  if (/^(data|result|response)\./.test(p.path) && keyRank >= 0) score += 10;

  // Real prose, in the range a support reply lives in.
  if (p.length >= 20) score += 20;
  if (p.length >= 60) score += 10;
  if (p.length > 5000) score -= 20;

  // Things that are never the reply, however long they are.
  if (/\b(id|uuid|token|key|hash|url|href|model|role|type|status|version|created|timestamp)$/.test(last)) {
    score -= 80;
  }
  if (/^[0-9a-f-]{16,}$/i.test(p.preview)) score -= 60;

  // Shallow is likelier than deep, all else equal.
  score -= segments.length * 2;

  return score;
}

/** Paths to arrays that look like recorded tool calls. */
function findToolPaths(source: unknown): string[] {
  const hits: Array<{ path: string; score: number }> = [];

  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 5) return;

    if (Array.isArray(value)) {
      const last = path.split(".").pop()?.toLowerCase() ?? "";
      const named = TOOL_KEYS.findIndex((k) => k.toLowerCase() === last);
      // An empty array named `tool_calls` is still the right path: an agent that took
      // no action this time will take one on another scenario.
      const looksLikeTools =
        value.length === 0
          ? named >= 0
          : isRecord(value[0]) && TOOL_ITEM_KEYS.some((k) => k in (value[0] as Record<string, unknown>));

      if (looksLikeTools) {
        hits.push({ path, score: (named >= 0 ? 100 - named * 5 : 20) - path.split(".").length * 2 });
      }
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };

  walk(source, "", 0);
  return hits.sort((a, b) => b.score - a.score).map((h) => h.path);
}

export function discoverShape(source: unknown): DiscoveredShape {
  const paths = describeShape(source);
  const replyPaths = paths
    .map((p) => ({ p, score: scoreReply(p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.p.path);

  return { paths, replyPaths, toolPaths: findToolPaths(source).slice(0, 3) };
}

/**
 * The sentence a failed extraction should end with.
 *
 * Returned as a suffix rather than a whole message so the caller keeps saying what it
 * was looking for — "we could not find X" and "it looks like it is at Y" are both
 * needed, and only one of them is the error.
 */
export function suggestPathHint(source: unknown): string {
  const { replyPaths, paths } = discoverShape(source);
  if (replyPaths.length) {
    const rest = replyPaths.slice(1, 3);
    return ` The reply looks like it is at "${replyPaths[0]}"${
      rest.length ? ` (or ${rest.map((p) => `"${p}"`).join(", ")})` : ""
    }.`;
  }
  if (paths.length) {
    return ` The response carries text at ${paths.slice(0, 3).map((p) => `"${p.path}"`).join(", ")}.`;
  }
  return " The response carried no text at all, so there may be nothing to read here.";
}
