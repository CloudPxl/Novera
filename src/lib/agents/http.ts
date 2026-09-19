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
export function httpAgent(config: HttpAgentConfig, authValue?: string): AgentAdapter {
  async function call(input: string, policy: string): Promise<AgentResult> {
    const started = Date.now();
    const headers: Record<string, string> = { "content-type": "application/json", ...config.headers };
    if (authValue && config.authHeaderName) headers[config.authHeaderName] = authValue;

    const body = fillTemplate(config.bodyTemplate, { input, policy });

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
    send: (invocation: AgentInvocation) => call(invocation.input, invocation.policy),
  };
}
