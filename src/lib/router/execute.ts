import { PROVIDER_TIMEOUT_MS, ProviderError, type ChatRequest, type ChatResponse } from "../providers/types.ts";
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
/**
 * Why a candidate did not give a usable answer. Stored with the attempt, so what a case
 * says about its graders is read from the row, not inferred from an error message.
 * Attempts recorded before 2026-09-29 have none, and read as "unclassified".
 */
export type AttemptReason =
  | "rate_limited"
  | "timed_out"
  | "provider_error"
  | "unauthorized"
  | "invalid_output"
  | "refused_data_class"
  | "no_credential"
  | "out_of_time"
  | "skipped_open_circuit";

export interface RoutedAttempt {
  connection: string;
  model: string;
  ok: boolean;
  error?: string;
  ms: number;
  reason?: AttemptReason;
  /** From a 429's Retry-After, when the provider sent one. */
  retryAfterMs?: number;
  /** The provider was sent the request with detectable personal data replaced. */
  redacted?: true;
  /** Not sent at all: the request's data class exceeds what this provider may receive. */
  refused?: true;
}

export interface RoutedResponse extends ChatResponse {
  servedBy: Candidate;
  attempts: RoutedAttempt[];
}

/** What a thrown provider error means for routing. */
export function reasonFor(error: unknown): AttemptReason {
  if (error instanceof ProviderError) {
    if (error.timedOut) return "timed_out";
    if (error.status === 429) return "rate_limited";
    if (error.status === 401 || error.status === 403) return "unauthorized";
  }
  return "provider_error";
}

const REASON_WORDS: Record<AttemptReason, string> = {
  rate_limited: "was rate-limited",
  timed_out: "did not answer in time",
  provider_error: "returned an error",
  unauthorized: "refused the key",
  invalid_output: "answered without a readable verdict",
  refused_data_class: "was not sent the reply, which its terms do not cover",
  no_credential: "has no credential configured",
  out_of_time: "was not asked: the run's time slice was ending",
  skipped_open_circuit: "was skipped after failing repeatedly in this slice",
};

/** One attempt in words: "mistral/ministral-8b-latest did not answer in time". */
export function describeAttempt(a: RoutedAttempt): string {
  // An unclassified error keeps its own detail: "returned an error" alone would hide
  // the one thing an operator needs to fix it.
  const detail = (a.error ?? "no detail").slice(0, 120);
  const words = !a.reason ? `failed (${detail})` : a.reason === "provider_error" ? `returned an error (${detail})` : REASON_WORDS[a.reason];
  const wait = a.reason === "rate_limited" && a.retryAfterMs ? `, asked to wait ${Math.ceil(a.retryAfterMs / 1000)} s` : "";
  return `${a.connection}/${a.model} ${words}${wait}`;
}

/** Every failed attempt, in order, as one sentence fragment. */
export function describeFailures(attempts: RoutedAttempt[]): string {
  const failed = attempts.filter((a) => !a.ok || a.reason === "invalid_output");
  return failed.length ? failed.map(describeAttempt).join("; ") : "no candidate was configured";
}

/**
 * Remembers, for one slice, which vendors are failing, so later cases do not wait on
 * them again. A vendor opens after two consecutive rate limits, timeouts or errors — or
 * at once for the length of a Retry-After it sent — and closes on its own after that.
 * In memory on purpose: a slice is one function call, and the next slice asks afresh.
 * The agent is never behind a breaker, and nothing here retries anything.
 */
export class CircuitBreaker {
  private failures = new Map<string, number>();
  private openUntil = new Map<string, { until: number; cause: AttemptReason }>();

  private readonly options: { threshold?: number; openMs?: number; maxRetryAfterMs?: number };

  constructor(options: { threshold?: number; openMs?: number; maxRetryAfterMs?: number } = {}) {
    this.options = options;
  }

  isOpen(connection: string, now = Date.now()): AttemptReason | null {
    const open = this.openUntil.get(connection);
    if (!open) return null;
    if (now >= open.until) {
      this.openUntil.delete(connection);
      this.failures.delete(connection);
      return null;
    }
    return open.cause;
  }

  record(connection: string, attempt: Pick<RoutedAttempt, "ok" | "reason" | "retryAfterMs">, now = Date.now()): void {
    if (attempt.ok && attempt.reason !== "invalid_output") {
      this.failures.delete(connection);
      return;
    }
    if (attempt.reason !== "rate_limited" && attempt.reason !== "timed_out" && attempt.reason !== "provider_error") return;
    const count = (this.failures.get(connection) ?? 0) + 1;
    this.failures.set(connection, count);
    const maxWait = this.options.maxRetryAfterMs ?? 60_000;
    if (attempt.reason === "rate_limited" && attempt.retryAfterMs) {
      this.openUntil.set(connection, { until: now + Math.min(attempt.retryAfterMs, maxWait), cause: attempt.reason });
    } else if (count >= (this.options.threshold ?? 2)) {
      this.openUntil.set(connection, { until: now + (this.options.openMs ?? 30_000), cause: attempt.reason });
    }
  }
}

export class RouteExhaustedError extends Error {
  attempts: RoutedAttempt[];

  constructor(task: string, attempts: RoutedAttempt[]) {
    super(`No model could answer "${task}": ${describeFailures(attempts)}`);
    this.name = "RouteExhaustedError";
    this.attempts = attempts;
  }
}

export interface RouterOptions {
  connections: Map<string, Connection>;
  routes: RouteTable;
  /** Called for each failed attempt, so a degraded route is visible rather than silent. */
  onFallback?: (attempt: RoutedAttempt) => void;
  /** Shared by every request of one slice, so a failing vendor is asked once, not per case. */
  breaker?: CircuitBreaker;
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
  /**
   * The moment (epoch ms) past which no answer can be used: the end of a run's time
   * slice. Each candidate is given at most what is left, and none is asked once too
   * little is — recorded as such, so the case says its graders ran out of time rather
   * than that they failed.
   */
  deadline?: number;
  /**
   * This request settles a disagreement, so a verdict depends on it. The breaker's skip
   * is a trade of a wait for speed, which is right for an ordinary opinion and wrong
   * here: an unsettled tie costs the verdict itself. A settling request is sent past an
   * open breaker, and a rate limit with a short Retry-After is waited out once.
   */
  settling?: boolean;
}

/** The longest Retry-After a settling request waits out, if the deadline allows it. */
const SETTLING_WAIT_MAX_MS = 8_000;

/** A model call is not started with less time than this left before the deadline. */
const MIN_CALL_MS = 1_500;

/** The same routed chat, with every request bounded by one deadline unless it sets its own. */
export function withDeadline(chat: RoutedChat, deadline: number): RoutedChat {
  return (task, request, options) => chat(task, request, { ...options, deadline: options?.deadline ?? deadline });
}

export type RoutedChat = (
  task: Task,
  request: Omit<ChatRequest, "model">,
  options?: RouteRequestOptions,
) => Promise<RoutedResponse>;

export function createRoutedChat(options: RouterOptions): RoutedChat {
  const { connections, routes, onFallback, breaker } = options;

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
          reason: "no_credential" as const,
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
          reason: "refused_data_class",
          error: `not sent: ${describeClass(classified.original)} data exceeds what this provider may receive (${describeClass(ceiling)})`,
          ms: 0,
        };
        attempts.push(attempt);
        onFallback?.(attempt);
        continue;
      }
      const outgoing = redacted ? classified.redacted!.request : request;
      const marks = redacted ? { redacted: true as const } : {};

      const openFor = options?.settling ? null : breaker?.isOpen(candidate.connection);
      if (openFor) {
        const attempt: RoutedAttempt = {
          connection: candidate.connection,
          model: candidate.model,
          ok: false,
          // The cause is in the words, so a slice whose vendors are all rate-limited is
          // still recognised as out of quota rather than as broken.
          error: `not asked: ${candidate.connection} ${openFor === "rate_limited" ? "was rate-limited" : openFor === "timed_out" ? "timed out" : "failed"} repeatedly earlier in this slice`,
          ms: 0,
          reason: "skipped_open_circuit",
        };
        attempts.push(attempt);
        onFallback?.(attempt);
        continue;
      }

      let timeoutMs = request.timeoutMs ?? PROVIDER_TIMEOUT_MS;
      if (options?.deadline !== undefined) {
        const left = options.deadline - Date.now();
        if (left < MIN_CALL_MS) {
          const attempt: RoutedAttempt = {
            connection: candidate.connection,
            model: candidate.model,
            ok: false,
            error: "not asked: this run's time slice was ending",
            ms: 0,
            reason: "out_of_time",
          };
          attempts.push(attempt);
          onFallback?.(attempt);
          break;
        }
        timeoutMs = Math.min(timeoutMs, left);
      }

      let started = Date.now();
      try {
        let response: ChatResponse;
        try {
          response = await connection.provider.chat({ ...outgoing, model: candidate.model, timeoutMs }, connection.apiKey);
        } catch (first) {
          // Settling a tie: a short Retry-After is worth waiting for once, if the case's
          // deadline leaves room for the wait and the call. Anything else fails as usual.
          const wait = first instanceof ProviderError && first.status === 429 ? first.retryAfterMs : undefined;
          const room = options?.deadline === undefined ? Infinity : options.deadline - Date.now() - (wait ?? 0) - MIN_CALL_MS;
          if (!options?.settling || wait === undefined || wait > SETTLING_WAIT_MAX_MS || room < MIN_CALL_MS) throw first;
          const limited: RoutedAttempt = {
            connection: candidate.connection, model: candidate.model, ok: false, ms: Date.now() - started,
            error: (first as Error).message, reason: "rate_limited", retryAfterMs: wait, ...marks,
          };
          attempts.push(limited);
          onFallback?.(limited);
          await new Promise((r) => setTimeout(r, wait));
          started = Date.now();
          response = await connection.provider.chat(
            { ...outgoing, model: candidate.model, timeoutMs: Math.min(timeoutMs, room) },
            connection.apiKey,
          );
        }
        attempts.push({ connection: candidate.connection, model: candidate.model, ok: true, ms: Date.now() - started, ...marks });
        breaker?.record(candidate.connection, { ok: true });
        return { ...response, servedBy: candidate, attempts };
      } catch (error) {
        const retryAfter = error instanceof ProviderError ? error.retryAfterMs : undefined;
        const attempt: RoutedAttempt = {
          connection: candidate.connection,
          model: candidate.model,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
          reason: reasonFor(error),
          ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}),
          ...marks,
        };
        attempts.push(attempt);
        breaker?.record(candidate.connection, attempt);
        onFallback?.(attempt);
      }
    }

    throw new RouteExhaustedError(task, attempts);
  };
}
