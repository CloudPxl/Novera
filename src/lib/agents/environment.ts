import type { AgentConfig } from "./types.ts";

/**
 * The sentence a report prints under "Environment", derived from the agent rather than
 * written once for every run.
 *
 * It used to be a constant — "Customer-operated agent, tested with recorded
 * authorisation" — so a run against Novera's own scripted fixture sealed a report that
 * described a real customer's agent. A fixture is never displayed as a real external
 * action: this names it, and the report page labels any environment that mentions a
 * fixture as test data.
 */
export const CUSTOMER_ENVIRONMENT = "Customer-operated agent, tested with recorded authorisation";
export const FIXTURE_ENVIRONMENT = "Novera test fixture: scripted responses with planted failures, not a real agent";

const FIXTURE_PATHS = new Set(["/api/test-agent"]);
const OWN_HOSTS = new Set(["localhost", "127.0.0.1", "nover.space", "www.nover.space"]);

export function isNoveraFixture(config: AgentConfig, appUrl = process.env.NEXT_PUBLIC_APP_URL): boolean {
  if (config.kind !== "http") return false;
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    return false;
  }
  const hosts = new Set(OWN_HOSTS);
  try {
    if (appUrl) hosts.add(new URL(appUrl).hostname);
  } catch {
    // An unparseable app URL adds nothing; the fixed hosts still apply.
  }
  return hosts.has(url.hostname) && FIXTURE_PATHS.has(url.pathname.replace(/\/+$/, ""));
}

export function reportEnvironment(config: AgentConfig): string {
  return isNoveraFixture(config) ? FIXTURE_ENVIRONMENT : CUSTOMER_ENVIRONMENT;
}
