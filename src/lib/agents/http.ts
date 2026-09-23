import type { AgentAdapter, AgentInvocation, AgentResult, HttpAgentConfig } from "./types.ts";
import { PROBE_INPUT } from "./types.ts";
import { fillTemplate, readPath } from "./template.ts";

/**
 * Calls a customer's deployed agent over HTTP.
 *
 * Every failure mode here — unreachable host, non-2xx, unparseable body, a response
 * path that matches nothing — returns ok:false with an explanation rather than
 * throwing. The runner turns that into an `error` case, which is excluded from the
 * score and shown in the report's coverage block.
 */
const CONTEXT_PLACEHOLDER = "{{context}}";

/**
 * Whether the operator's body template has a slot for a scenario's context. Walked
 * as a parsed object, like `fillTemplate` itself, so a placeholder nested three
 * levels inside the template still counts.
 */
function templateCarriesContext(template: unknown): boolean {
  if (typeof template === "string") return template.includes(CONTEXT_PLACEHOLDER);
  if (Array.isArray(template)) return template.some(templateCarriesContext);
  if (template && typeof template === "object") {
    return Object.values(template as Record<string, unknown>).some(templateCarriesContext);
  }
  return false;
}

export function httpAgent(config: HttpAgentConfig, authValue?: string): AgentAdapter {
  async function call(
    input: string,
    policy: string,
    context?: Record<string, string>,
  ): Promise<AgentResult> {
    const started = Date.now();
    const headers: Record<string, string> = { "content-type": "application/json", ...config.headers };
    if (authValue && config.authHeaderName) headers[config.authHeaderName] = authValue;

    const body = fillTemplate(config.bodyTemplate, {
      input,
      policy,
      // Serialised rather than spread, because the shape of a customer's metadata is
      // theirs, not ours: one placeholder carries whatever the scenario declared.
      context: JSON.stringify(context ?? {}),
    });

    let response: Response;
    try {
      response = await fetch(config.url, {
        method: config.method ?? "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
      });
    } catch (error) {
      return {
        ok: false,
        responseText: null,
        toolActivity: null,
        latencyMs: Date.now() - started,
        error: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const latencyMs = Date.now() - started;
    const text = await response.text();

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        responseText: null,
        toolActivity: null,
        statusCode: response.status,
        latencyMs,
        raw: parsed ?? text,
        error: `Agent returned HTTP ${response.status}`,
      };
    }

    if (parsed === null) {
      return {
        ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs,
        raw: text,
        error: "Agent response was not valid JSON",
      };
    }

    const extracted = readPath(parsed, config.responsePath);
    if (typeof extracted !== "string" || extracted.trim() === "") {
      return {
        ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs,
        raw: parsed,
        error: `No text found at response path "${config.responsePath}"`,
      };
    }

    return {
      ok: true,
      responseText: extracted,
      toolActivity: config.toolActivityPath ? readPath(parsed, config.toolActivityPath) ?? null : null,
      statusCode: response.status,
      latencyMs,
      raw: parsed,
    };
  }

  return {
    probe: () => call(PROBE_INPUT, ""),
    send: (invocation: AgentInvocation) =>
      call(invocation.input, invocation.policy, invocation.context),
    acceptsContext: () => templateCarriesContext(config.bodyTemplate),
  };
}
