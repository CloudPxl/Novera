/**
 * Prints the browser worker's secret once, derived from NOVERA_ENCRYPTION_KEY
 * (src/lib/insight/worker-secret.ts). Run it with the deployment's key in the environment:
 * the secret only opens /api/internal/insight/* on a deployment whose key it came from.
 *
 *   npm run insight-worker:secret
 *
 * Put the value in the worker's environment as NOVERA_INSIGHT_WORKER_SECRET. Do not commit it.
 */
import { workerSecret } from "../src/lib/insight/worker-secret.ts";

try {
  const secret = workerSecret();
  console.log("The browser worker's secret for the deployment whose NOVERA_ENCRYPTION_KEY is in this environment:\n");
  console.log(`  ${secret}\n`);
  console.log("Set it on the worker as NOVERA_INSIGHT_WORKER_SECRET. Changing the encryption key retires it.");
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(3);
}
