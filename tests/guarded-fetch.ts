import type { TestContext } from "node:test";
import { setGuardedFetchForTests } from "../src/lib/net/public-url.ts";

/**
 * Answers every request to a customer-supplied address (agent, read-back, webhook, Builder page)
 * for one test. Those go through undici's own fetch (`guardedFetch`), not the global one, so
 * mocking `globalThis.fetch` no longer reaches them. Returns the mock, for its calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mockGuardedFetch(t: TestContext, impl: (...args: any[]) => Promise<Response>) {
  const fn = t.mock.fn(impl);
  setGuardedFetchForTests(fn as unknown as typeof fetch);
  t.after(() => setGuardedFetchForTests(null));
  return fn;
}
