import type { ChatRequest, ChatResponse } from "../providers/types.ts";
import type { Connection } from "../providers/registry.ts";
import type { Candidate, RouteTable, Task } from "./routes.ts";
import { allows, ceilingFor, classify, describeClass, type DataClass } from "../privacy/data-class.ts";

/**
 * Runs a chat request down a route, falling back on failure.
 *
 * Every attempt is recorded, including the ones that failed. A run whose grading
 * quietly moved to a different model is not the same evidence as one that did not,
 * so the caller persists `servedBy` and `attempts` rather than just the answer.
 */
export interface RoutedAttempt {
  connection: string;
  model: string;
  ok: boolean;
  error?: string;
  ms: number;
  /** The provider was sent the request with detectable personal data replaced. */
  redacted?: true;
  /** Not sent at all: the request's data class exceeds what this provider may receive. */
  refused?: true;
}

export interface RoutedResponse extends ChatResponse {
  servedBy: Candidate;
  attempts: RoutedAttempt[];
}

export class RouteExhaustedError extends Error {
  attempts: RoutedAttempt[];

  constructor(task: string, attempts: RoutedAttempt[]) {
    const detail = attempts.map((a) => `${a.connection}/${a.model}: ${a.error}`).join("; ");
    super(`Every candidate for "${task}" failed — ${detail || "no candidate was configured"}`);
    this.name = "RouteExhaustedError";
    this.attempts = attempts;
  }
}

export interface RouterOptions {
  connections: Map<string, Connection>;
  routes: RouteTable;
  /** Called for each failed attempt, so a degraded route is visible rather than silent. */
  onFallback?: (attempt: RoutedAttempt) => void;
}

export interface RouteRequestOptions {
  /**
   * Candidates to skip. Consensus grading uses this to get a genuinely second
   * opinion: asking the same model twice is not corroboration.
   */
  exclude?: Candidate[];
  /**
   * Whole connections to skip. A different model from the same vendor is a weaker
   * second opinion than it looks: `groq/openai/gpt-oss-120b` and
   * `groq/openai/gpt-oss-20b` share a training lineage, a serving stack and a rate
   * limit, so they can agree for reasons that have nothing to do with the evidence.
   * Consensus asks across vendors first and only falls back to within one.
   */
  excludeConnections?: string[];
  /**
   * What the request carries by origin (`src/lib/privacy/data-class.ts`). Detection can
   * only raise it. Omitted means identifiable customer data: a call site that has not
   * said what it sends is treated as sending the most a provider of ours may receive.
   */
  data?: DataClass;
}

export type RoutedChat = (
  task: Task,
  request: Omit<ChatRequest, "model">,
  options?: RouteRequestOptions,
) => Promise<RoutedResponse>;

export function createRoutedChat(options: RouterOptions): RoutedChat {
  const { connections, routes, onFallback } = options;

  return async function routedChat(task, request, options) {
    const attempts: RoutedAttempt[] = [];

    // Classed once per request, before any candidate: the answer does not depend on
    // who receives it, only whether they may.
    const system = request.system;
    const classified = classify({
      floor: options?.data ?? "identifiable_customer",
      texts: [system ?? "", ...request.messages.map((m) => m.content)],
      rebuild: ([s, ...contents]) => ({
        ...request,
        system: system === undefined ? undefined : s,
        messages: request.messages.map((m, i) => ({ ...m, content: contents[i] })),
      }),
    });

    for (const candidate of routes[task] ?? []) {
      const excluded = options?.exclude?.some(
        (e) => e.connection === candidate.connection && e.model === candidate.model,
      );
      if (excluded) continue;
      if (options?.excludeConnections?.includes(candidate.connection)) continue;

      const connection = connections.get(candidate.connection);

      if (!connection) {
        // A route naming a connection with no key is a configuration gap, not a
        // runtime failure. Record it so it surfaces, then keep going.
        const attempt = {
          connection: candidate.connection,
          model: candidate.model,
          ok: false,
          error: "no credential configured for this connection",
          ms: 0,
        };
        attempts.push(attempt);
        onFallback?.(attempt);
        continue;
      }

      // The original if this provider may receive it; the redacted copy if that is
      // enough; otherwise it is not sent, and the refusal is recorded like any other
      // reason a candidate was passed over.
      const ceiling = ceilingFor(connection);
      const redacted = !allows(ceiling, classified.original) && classified.redacted && allows(ceiling, classified.redacted.dataClass);
      if (!allows(ceiling, classified.original) && !redacted) {
        const attempt: RoutedAttempt = {
          connection: candidate.connection,
          model: candidate.model,
          ok: false,
          refused: true,
          error: `not sent: ${describeClass(classified.original)} data exceeds what this provider may receive (${describeClass(ceiling)})`,
          ms: 0,
        };
        attempts.push(attempt);
        onFallback?.(attempt);
        continue;
      }
      const outgoing = redacted ? classified.redacted!.request : request;
      const marks = redacted ? { redacted: true as const } : {};

      const started = Date.now();
      try {
        const response = await connection.provider.chat(
          { ...outgoing, model: candidate.model },
          connection.apiKey,
        );
        attempts.push({ connection: candidate.connection, model: candidate.model, ok: true, ms: Date.now() - started, ...marks });
        return { ...response, servedBy: candidate, attempts };
      } catch (error) {
        const attempt: RoutedAttempt = {
          connection: candidate.connection,
          model: candidate.model,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
          ...marks,
        };
        attempts.push(attempt);
        onFallback?.(attempt);
      }
    }

    throw new RouteExhaustedError(task, attempts);
  };
}
