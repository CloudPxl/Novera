import type { ChatRequest, ChatResponse } from "../providers/types.ts";
import type { Connection } from "../providers/registry.ts";
import type { Candidate, RouteTable, Task } from "./routes.ts";

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

export type RoutedChat = (
  task: Task,
  request: Omit<ChatRequest, "model">,
) => Promise<RoutedResponse>;

export function createRoutedChat(options: RouterOptions): RoutedChat {
  const { connections, routes, onFallback } = options;

  return async function routedChat(task, request) {
    const attempts: RoutedAttempt[] = [];

    for (const candidate of routes[task] ?? []) {
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

      const started = Date.now();
      try {
        const response = await connection.provider.chat(
          { ...request, model: candidate.model },
          connection.apiKey,
        );
        attempts.push({ connection: candidate.connection, model: candidate.model, ok: true, ms: Date.now() - started });
        return { ...response, servedBy: candidate, attempts };
      } catch (error) {
        const attempt = {
          connection: candidate.connection,
          model: candidate.model,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
        };
        attempts.push(attempt);
        onFallback?.(attempt);
      }
    }

    throw new RouteExhaustedError(task, attempts);
  };
}
