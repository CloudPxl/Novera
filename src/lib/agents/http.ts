import type { AgentAdapter, AgentInvocation, AgentResult, HttpAgentConfig } from "./types.ts";
import { PROBE_INPUT } from "./types.ts";
import { fillTemplate, readPath } from "./template.ts";
import { suggestPathHint } from "./discover.ts";
import { assertPublicUrl, publicOnlyDispatcher, refusedAddress } from "../net/public-url.ts";

/**
 * Calls a customer's deployed agent over HTTP.
 *
 * Every failure mode here — unreachable host, non-2xx, unparseable body, a response
 * path that matches nothing — returns ok:false with an explanation rather than
 * throwing. The runner turns that into an `error` case, which is excluded from the
 * score and shown in the report's coverage block.
 */
/**
 * Whether the operator's body template has a given placeholder. Walked as a parsed
 * object, like `fillTemplate` itself, so a placeholder nested three levels inside the
 * template still counts.
 */
function templateCarries(template: unknown, placeholder: string): boolean {
  if (typeof template === "string") return template.includes(placeholder);
  if (Array.isArray(template)) return template.some((t) => templateCarries(t, placeholder));
  if (template && typeof template === "object") {
    return Object.values(template as Record<string, unknown>).some((t) => templateCarries(t, placeholder));
  }
  return false;
}

/** The conversation so far, in the role names chat APIs use. */
function chatHistory(history: AgentInvocation["history"]): Array<{ role: "user" | "assistant"; content: string }> {
  return (history ?? []).map((t) => ({ role: t.role === "customer" ? "user" : "assistant", content: t.content }));
}

/**
 * How long an agent has to answer one message: its configured timeout, never more than
 * 30 s. A run executes in slices inside a 60 s function, so a longer wait is not a
 * patient setting — it is a case the platform kills halfway through.
 */
export const AGENT_TIMEOUT_MAX_MS = 30_000;

/**
 * The most of an agent's reply Novera reads. A support reply is a few kilobytes; past this
 * it is an attachment or a fault, and reading it whole cost minutes of CPU in redaction
 * and could keep a slice past the platform's limit (audit 2026-10-01, C6).
 */
export const MAX_REPLY_BYTES = 256 * 1024;

class ReplyTooLarge extends Error {}

/** The body, read under the request's own deadline and never past `limit` bytes. */
async function readReply(response: Response, limit: number): Promise<string> {
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
      throw new ReplyTooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}
/** Below this, a message is not sent at all: the answer could not be waited for. */
const MIN_AGENT_WAIT_MS = 2_000;

export function agentTimeoutMs(config: { timeoutMs?: number }): number {
  const own = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : AGENT_TIMEOUT_MAX_MS;
  return Math.min(own, AGENT_TIMEOUT_MAX_MS);
}

export function httpAgent(config: HttpAgentConfig, authValue?: string): AgentAdapter {
  async function call(
    input: string,
    policy: string,
    context?: Record<string, string>,
    history?: AgentInvocation["history"],
    conversationId?: string,
    deadline?: number,
  ): Promise<AgentResult> {
    const started = Date.now();
    const headers: Record<string, string> = { "content-type": "application/json", ...config.headers };
    if (authValue && config.authHeaderName) headers[config.authHeaderName] = authValue;

    const messages = chatHistory(history);
    const body = fillTemplate(config.bodyTemplate, {
      input,
      policy,
      // Serialised rather than spread, because the shape of a customer's metadata is
      // theirs, not ours: one placeholder carries whatever the scenario declared.
      context: JSON.stringify(context ?? {}),
      history: JSON.stringify(messages),
      // A single-message scenario still gets an id, so a stateful agent never mixes two
      // scenarios into one conversation.
      conversation_id: conversationId ?? crypto.randomUUID(),
    }, { history: messages });

    // Checked on every call, not only when the agent was connected: what a hostname
    // resolves to can change afterwards.
    try {
      await assertPublicUrl(config.url);
    } catch (error) {
      return {
        ok: false, responseText: null, toolActivity: null, latencyMs: 0,
        error: `Not sent: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const own = agentTimeoutMs(config);
    const wait = deadline === undefined ? own : Math.min(own, deadline - Date.now());
    if (wait < MIN_AGENT_WAIT_MS) {
      return {
        ok: false, responseText: null, toolActivity: null, latencyMs: 0, timedOut: true, cutByNovera: true,
        error: "Not sent: this run's time slice was ending. This says nothing about the agent; retest the scenario.",
      };
    }

    let response: Response;
    try {
      response = await fetch(config.url, {
        method: config.method ?? "POST",
        headers,
        body: JSON.stringify(body),
        // A redirect is answered, never followed: following it could carry the request
        // to an address the check above never saw.
        redirect: "manual",
        signal: AbortSignal.timeout(wait),
        // The address connected to is checked when the connection opens, not only above.
        dispatcher: publicOnlyDispatcher(),
      } as RequestInit);
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        const cut = wait < own;
        return {
          ok: false, responseText: null, toolActivity: null, latencyMs: Date.now() - started, timedOut: true,
          ...(cut ? { cutByNovera: true } : {}),
          error: cut
            ? `Novera stopped waiting after ${Math.round(wait / 1000)} s because this run's time slice was ending. This says nothing about the agent; retest the scenario.`
            : `The agent did not answer within ${Math.round(own / 1000)} s.`,
        };
      }
      const refused = refusedAddress(error);
      return {
        ok: false,
        responseText: null,
        toolActivity: null,
        latencyMs: Date.now() - started,
        error: refused ? `Not sent: ${refused}` : `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const latencyMs = Date.now() - started;
    // The headers arriving is not the reply arriving: the body is read under the same
    // deadline, and a body that stalls is this scenario's timeout, not an exception that
    // ends the run (audit 2026-10-01, C5).
    let text: string;
    try {
      text = await readReply(response, MAX_REPLY_BYTES);
    } catch (error) {
      const base = { ok: false as const, responseText: null, toolActivity: null, statusCode: response.status, latencyMs: Date.now() - started };
      if (error instanceof ReplyTooLarge) {
        return { ...base, error: `The agent's reply was larger than ${MAX_REPLY_BYTES / 1024} KB, so Novera stopped reading it. Nothing was graded; this says nothing about whether the reply was right.` };
      }
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        const cut = wait < own;
        return {
          ...base, timedOut: true, ...(cut ? { cutByNovera: true } : {}),
          error: cut
            ? `Novera stopped waiting after ${Math.round(wait / 1000)} s because this run's time slice was ending. This says nothing about the agent; retest the scenario.`
            : `The agent's reply did not finish arriving within ${Math.round(own / 1000)} s.`,
        };
      }
      return { ...base, error: `The agent's reply could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }

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
      // The most common way an integration dies, and the least useful place to stop
      // talking. The response is right here; saying where the reply appears to be
      // turns a dead end into a one-line fix, at connection time and at run time both.
      return {
        ok: false, responseText: null, toolActivity: null, statusCode: response.status, latencyMs,
        raw: parsed,
        error: `No text found at response path "${config.responsePath}".${suggestPathHint(parsed)}`,
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
      call(invocation.input, invocation.policy, invocation.context, invocation.history, invocation.conversationId, invocation.deadline),
    acceptsContext: () => templateCarries(config.bodyTemplate, "{{context}}"),
    acceptsConversation: () =>
      templateCarries(config.bodyTemplate, "{{history}}") || templateCarries(config.bodyTemplate, "{{conversation_id}}"),
  };
}
