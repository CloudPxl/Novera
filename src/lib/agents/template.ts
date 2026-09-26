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

/** Reads "a.b.0.c" out of a parsed JSON response. Returns undefined rather than throwing. */
export function readPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}
