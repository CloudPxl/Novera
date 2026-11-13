import { assertPublicUrl, guardedFetch, publicOnlyDispatcher } from "../net/public-url.ts";
import { readTextLimited } from "../net/read-body.ts";

/**
 * A Dify app's declared input variables, read from its `GET /v1/parameters` when a person tests
 * the connection.
 *
 * Dify answers that endpoint, under the same app key, with `user_input_form`: every variable of the
 * app's Start node, its type, whether it is required, and its default. A chatflow whose Start node
 * requires `customer_tier` refuses every message sent without it, so knowing the list at
 * connection time turns 49 identical failures into one line on the test result.
 *
 * What is discovered only fills the form, the way a preset or a pasted curl command does: a person
 * adds the variables to the request body and saves. Nothing is added to a run's request on its
 * own, because a run sends the stored request and nothing else — that is what its manifest digests
 * and what its report describes. The address is the endpoint's own host, so the credential never
 * travels anywhere it was not already going; nothing is stored, and any failure is silent.
 */
export interface DifyInput {
  variable: string;
  label: string | null;
  /** Dify's control: text-input, paragraph, select, number, file, … */
  type: string;
  required: boolean;
  /** The default Dify shows, as text; null when there is none. */
  defaultValue: string | null;
  options?: string[];
}

export const DIFY_PARAMETERS_TIMEOUT_MS = 4_000;
const MAX_PARAMETERS_BYTES = 64 * 1024;
const MAX_INPUTS = 40;

/** The app's parameters address, for an endpoint that is one of Dify's message or run APIs. */
export function difyParametersUrl(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  const m = /^(.*)\/(chat-messages|completion-messages|workflows\/run)$/.exec(path);
  if (!m || path.includes("{{")) return null;
  return `${url.origin}${m[1]}/parameters`;
}

/** The variables a parameters answer declares, in order. Anything unexpected is skipped, never guessed. */
export function parseUserInputForm(body: unknown): DifyInput[] {
  const form = body && typeof body === "object" ? (body as { user_input_form?: unknown }).user_input_form : undefined;
  if (!Array.isArray(form)) return [];
  const out: DifyInput[] = [];
  for (const item of form.slice(0, MAX_INPUTS)) {
    if (!item || typeof item !== "object") continue;
    const [type, spec] = Object.entries(item as Record<string, unknown>)[0] ?? [];
    if (!type || !spec || typeof spec !== "object") continue;
    const s = spec as Record<string, unknown>;
    const variable = typeof s.variable === "string" ? s.variable : null;
    if (!variable || !/^[A-Za-z_][\w-]{0,63}$/.test(variable)) continue;
    const def = s.default;
    out.push({
      variable,
      label: typeof s.label === "string" ? s.label.slice(0, 120) : null,
      type: type.slice(0, 40),
      required: s.required === true,
      defaultValue: typeof def === "string" && def !== "" ? def.slice(0, 500) : typeof def === "number" || typeof def === "boolean" ? String(def) : null,
      ...(Array.isArray(s.options) ? { options: s.options.filter((o): o is string => typeof o === "string").slice(0, 20) } : {}),
    });
  }
  return out;
}

/** Required variables the request body's `inputs` does not carry a value for. */
export function missingInputs(declared: readonly DifyInput[], bodyTemplate: Record<string, unknown>): string[] {
  const inputs = bodyTemplate.inputs && typeof bodyTemplate.inputs === "object" && !Array.isArray(bodyTemplate.inputs)
    ? (bodyTemplate.inputs as Record<string, unknown>) : {};
  return declared
    .filter((d) => d.required && (inputs[d.variable] === undefined || inputs[d.variable] === ""))
    .map((d) => d.variable);
}

/** Asks the app for its parameters. Null when the endpoint is not Dify's or anything goes wrong. */
export async function discoverDifyInputs(
  config: { url: string; authHeaderName?: string; headers?: Record<string, string> },
  credential?: string,
): Promise<DifyInput[] | null> {
  const url = difyParametersUrl(config.url);
  if (!url) return null;
  try {
    await assertPublicUrl(url);
    const headers: Record<string, string> = { accept: "application/json", ...config.headers };
    if (credential && config.authHeaderName) headers[config.authHeaderName] = credential;
    const response = await guardedFetch(url, {
      method: "GET", headers, redirect: "manual",
      signal: AbortSignal.timeout(DIFY_PARAMETERS_TIMEOUT_MS),
      dispatcher: publicOnlyDispatcher(),
    } as RequestInit);
    if (!response.ok) return null;
    const text = await readTextLimited(response, MAX_PARAMETERS_BYTES);
    const found = parseUserInputForm(JSON.parse(text));
    return found.length ? found : null;
  } catch {
    return null;
  }
}
