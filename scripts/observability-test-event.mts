/**
 * Sends one synthetic error through the configured reporters and proves it left scrubbed.
 *
 *   npm run observability:test-event
 *
 * The error carries a fake value of every secret shape the scrubber must remove — provider
 * keys, `nvk_`, `whsec_`, Stripe, a bearer token, a service-role JWT, an email, a report
 * token in a /report/ path, a session cookie, policy text and an agent's reply. The event
 * that left is printed (the console reporter's line) and checked for every one of them.
 *
 * With NOVERA_ERROR_SENTRY_DSN or NOVERA_ERROR_WEBHOOK_URL set, the same event is sent
 * there too: open the vendor and look for "Provider refused key [SECRET_1]".
 *
 * Exit: 0 sent and nothing leaked; 1 something leaked or nothing was sent.
 */
import { captureError, configuredReporters } from "../src/lib/observability/capture.ts";
import { syntheticFailure, leakedFragments } from "../src/lib/observability/test-event.ts";

const { console: on, vendors, problems } = configuredReporters();
if (!on) {
  console.error("NOVERA_ERROR_REPORTING=off: nothing is reported, so there is nothing to test.");
  process.exit(1);
}
for (const p of problems) console.error(`Not configured: ${p}`);
console.log(`Reporters: console${vendors.map((v) => `, ${v.name}`).join("")}\n`);

const { error, request, context } = syntheticFailure();
const event = await captureError(error, { request, context, detail: { source: "observability-test-event" } });
if (!event) {
  console.error("\nNo event was produced.");
  process.exit(1);
}
const leaked = leakedFragments(JSON.stringify(event));
console.log(leaked.length
  ? `\nFAIL: the event still contains ${leaked.join(", ")}.`
  : `\nok: none of the 12 planted secrets reached the event${vendors.length ? ` (also sent to ${vendors.map((v) => v.name).join(", ")}; failures, if any, are printed above)` : ""}.`);
process.exit(leaked.length ? 1 : 0);
