/**
 * Placeholder substitution for an HTTP agent's request body.
 *
 * The template is walked as a parsed object and only then serialised, so a policy
 * containing quotes, newlines or backslashes cannot break out of the JSON — which a
 * string-level template would happily let it do.
 */
export function fillTemplate(
  template: unknown,
  values: Record<string, string>,
  /**
   * Values substituted as themselves rather than as text, when a template string is
   * *exactly* one placeholder: `"messages": "{{history}}"` becomes an array, which is
   * what a chat endpoint expects. Anywhere else the text form in `values` is used.
   */
  structured: Record<string, unknown> = {},
): unknown {
  if (typeof template === "string") {
    const whole = /^\{\{(\w+)\}\}$/.exec(template);
    if (whole && Object.prototype.hasOwnProperty.call(structured, whole[1])) return structured[whole[1]];
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
    );
  }
  if (Array.isArray(template)) return template.map((item) => fillTemplate(item, values, structured));
  if (template && typeof template === "object") {
    return Object.fromEntries(
      Object.entries(template as Record<string, unknown>).map(([k, v]) => [k, fillTemplate(v, values, structured)]),
    );
  }
  return template;
}

/**
 * Reads "a.b.0.c" out of a parsed JSON response. Returns undefined rather than throwing.
 *
 * A `*` segment stands for every element of a list: "*.payload.message" reads that field from
 * each element. The result is then a list of what was found (nothing found is undefined), which
 * is how a reply sent as several message bubbles is read as one reply (`replyText`).
 */
export function readPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  return readSegments(source, path.split("."));
}

function readSegments(source: unknown, segments: string[]): unknown {
  let current: unknown = source;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (current === null || current === undefined) return undefined;
    if (segment === "*") {
      if (!Array.isArray(current)) return undefined;
      const rest = segments.slice(i + 1);
      const found = current
        .map((item) => (rest.length ? readSegments(item, rest) : item))
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v) => v !== undefined && v !== null);
      return found.length ? found : undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      // -1 is the last item, for a reply that is the last message of a list.
      current = current[index < 0 ? current.length + index : index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * The reply text at a path: the string there, or — for a `*` path — the strings found, one per
 * line in the order the response carried them. Anything else is not a reply.
 */
export function replyText(source: unknown, path: string): string | undefined {
  const value = readPath(source, path);
  if (typeof value === "string") return value;
  if (Array.isArray(value) && path.split(".").includes("*")) {
    const lines = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
    return lines.length ? lines.join("\n") : undefined;
  }
  return undefined;
}
