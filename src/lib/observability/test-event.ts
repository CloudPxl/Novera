/**
 * A synthetic failure carrying one of every secret shape the scrubber must remove, and the
 * check that none of them survived. Used by tests/observability.test.ts and by
 * `npm run observability:test-event`, which sends it through the configured reporters — the
 * way to prove a newly configured vendor receives scrubbed events.
 *
 * Every value here is fake and built at run time, so this file carries no key shape.
 */
const filler = (n: number) => Array.from({ length: n }, (_, i) => "Qz7Hk2Lm9Rt4Vw8Xy3Bn6Cd5Fg1Jp"[(i * 5 + 1) % 29]).join("");

export function syntheticSecrets() {
  return {
    openai: `sk-proj-${filler(48)}`,
    groq: `gsk_${filler(52)}`,
    novera: `nvk_${filler(43)}`,
    webhook: `whsec_${filler(43)}`,
    stripe: `sk_live_${filler(30)}`,
    bearer: `Bearer ${filler(36)}`,
    jwt: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role", sub: "x" })).toString("base64url")}.${filler(43)}`,
    email: "jane.customer@example-shop.eu",
    reportToken: filler(32),
    cookie: `sb-abcdefghij-auth-token=base64-${filler(60)}`,
    policy: "Refunds above 500 EUR always need a supervisor's written approval before any money moves.",
    agentReply: "Sure! I have refunded your order 18823 in full and closed your account as you asked, Jane.",
  };
}

export function syntheticFailure() {
  const s = syntheticSecrets();
  const error = new Error(
    `Provider refused key ${s.openai} (also tried ${s.groq}, ${s.novera}); webhook ${s.webhook}; stripe ${s.stripe}; ` +
    `header Authorization: ${s.bearer}; jwt ${s.jwt}; user ${s.email}; ` +
    `new row for relation "policies" violates check constraint "policies_body_check" Failing row contains (7d3c, ${s.policy}). ` +
    `Could not parse agent reply "${s.agentReply}" at https://www.nover.space/report/${s.reportToken}?code=${filler(20)}`,
  );
  const request = {
    path: `/report/${s.reportToken}?download=json&token=${filler(24)}`,
    method: "GET",
    headers: {
      cookie: s.cookie,
      authorization: s.bearer,
      "x-api-key": s.novera,
      "user-agent": `Mozilla/5.0 (${s.email})`,
      accept: "text/html",
    },
  };
  const context = { routerKind: "App Router", routePath: "/report/[token]", routeType: "render", renderSource: "react-server-components" };
  return { error, request, context, secrets: s };
}

/** The fragments of each secret that must not appear anywhere in a serialised event. */
export function leakedFragments(serialised: string): string[] {
  const s = syntheticSecrets();
  const probes: Record<string, string> = {
    openai: s.openai.slice(8, 28),
    groq: s.groq.slice(4, 24),
    novera: s.novera.slice(4, 24),
    webhook: s.webhook.slice(6, 26),
    stripe: s.stripe.slice(8, 28),
    bearer: s.bearer.slice(7, 27),
    jwt: s.jwt.split(".")[1].slice(0, 20),
    email: s.email,
    reportToken: s.reportToken,
    cookie: s.cookie.slice(32, 52),
    policy: "supervisor's written approval",
    agentReply: "closed your account",
  };
  return Object.entries(probes).filter(([, fragment]) => serialised.includes(fragment)).map(([name]) => name);
}
