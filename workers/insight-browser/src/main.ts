import { hostname } from "node:os";
import { chromium, type Browser } from "playwright";
import { serverClient } from "./client.ts";
import { runScan } from "./runner.ts";

/**
 * Novera's browser worker for public-demo insight scans.
 *
 *   node dist/worker.mjs --once    claim one scan if one is queued, run it, exit
 *   node dist/worker.mjs --loop    keep claiming, one scan at a time, every 30 s when idle
 *
 * Environment:
 *   NOVERA_BASE_URL                 the deployment, e.g. https://www.nover.space
 *   NOVERA_INSIGHT_WORKER_SECRET    `npm run insight-worker:secret` in the app's repository
 *   NOVERA_INSIGHT_WORKER_ID        this worker's name: lowercase letters, digits, dots, dashes
 *   NOVERA_INSIGHT_WORKER_CHANNEL   optional: "chrome" to use the installed Google Chrome
 *
 * It holds no model key and no database credential; it types the server's prompts and reports
 * what the widget displayed. See README.md for what it never does.
 */
export const WORKER_VERSION = "0.1.0";
const IDLE_MS = 30_000;

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`${name} is not set. See workers/insight-browser/README.md.`);
    process.exit(3);
  }
  return v;
}

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

async function main(): Promise<number> {
  const mode = process.argv.includes("--loop") ? "loop" : process.argv.includes("--once") ? "once" : null;
  if (!mode) {
    console.error("Usage: worker --once | --loop");
    return 3;
  }
  const baseUrl = env("NOVERA_BASE_URL");
  const secret = env("NOVERA_INSIGHT_WORKER_SECRET");
  const workerId = env("NOVERA_INSIGHT_WORKER_ID");
  const channel = process.env.NOVERA_INSIGHT_WORKER_CHANNEL?.trim() || undefined;
  const client = serverClient(baseUrl, secret);

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) process.exit(130);
      stopping = true;
      log(`${signal}: finishing the current step, then stopping (again to stop at once)`);
    });
  }

  let browser: Browser | null = null;
  try {
    while (!stopping) {
      let answer;
      try {
        answer = await client.claim({ worker_id: workerId, host_label: hostname().slice(0, 100), version: WORKER_VERSION });
      } catch (e) {
        log(e instanceof Error ? e.message : "The claim failed.");
        if (mode === "once") return 4;
        await new Promise((r) => setTimeout(r, IDLE_MS));
        continue;
      }
      if (!answer.scan) {
        if (answer.retry) continue;
        if (mode === "once") { log("nothing queued"); return 0; }
        await new Promise((r) => setTimeout(r, IDLE_MS));
        continue;
      }
      const scan = answer.scan;
      log(`scan ${scan.id}: claimed, ${scan.scenarios.length} scenarios, pacing ${scan.pacing_ms} ms`);
      browser ??= await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
      const outcome = await runScan(scan, { browser, client, workerId, log, stopping: () => stopping });
      log(`scan ${scan.id}: ${outcome}`);
      if (mode === "once") return outcome === "graded" ? 0 : outcome === "stopped" ? 2 : 1;
    }
    return 0;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

main().then((code) => process.exit(code), (e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(4);
});
