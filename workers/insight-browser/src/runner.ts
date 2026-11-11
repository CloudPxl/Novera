import type { Browser, BrowserContext, Page } from "playwright";
import { BOT_TOKEN, REPLY_LIMIT_BYTES, type ClaimedScan, type EventAnswer, type WorkerEvent } from "../../../src/lib/insight/protocol.ts";
import type { ObservationCapture, ScanErrorKind } from "../../../src/lib/insight/types.ts";
import { robotsFromResponse } from "../../../src/lib/net/robots.ts";
import type { ServerClient } from "./client.ts";
import { extractDelta, fitBytes } from "./delta.ts";
import { challengeOf, loginOrPaymentOf, sameSite } from "./guards.ts";
import { acceptConsentOnce, discoverWidget, pageFacts, scopeFacts, sendPrompt, widgetText, type Widget } from "./page.ts";

/**
 * One claimed scan, start to finish. The order is the safety order: robots.txt, then the page,
 * then a challenge check, then one consent click, then the widget, then a login or payment check
 * before every prompt and after every reply. Each scenario gets a fresh browser context, so no
 * reply carries the conversation before it. The server paces the turns; this waits as told and
 * never retries a prompt.
 *
 * Logs name scenario ids, outcomes and timings — never a reply's text.
 */
export interface RunnerOptions {
  browser: Browser;
  client: ServerClient;
  workerId: string;
  log: (line: string) => void;
  /** Set when the process was asked to stop: no further prompt is sent. */
  stopping: () => boolean;
  /** How often the reply's text is read while waiting for it to settle. */
  pollMs?: number;
  /** How long the text must stay unchanged to count as the whole reply. */
  stableMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScan(scan: ClaimedScan, opts: RunnerOptions): Promise<"graded" | "error" | "stopped"> {
  const { client, workerId, log } = opts;
  const pollMs = opts.pollMs ?? 500;
  const stableMs = opts.stableMs ?? 2500;
  let lost = false;

  const send = async (event: WorkerEvent): Promise<EventAnswer> => {
    for (let attempt = 0; attempt < 6; attempt++) {
      let answer: EventAnswer;
      try {
        answer = await client.event(scan.id, { worker_id: workerId, lease_token: scan.lease_token, event });
      } catch (e) {
        answer = { ok: false, status: 0, error: e instanceof Error ? e.message : "The server could not be reached.", stop: false };
      }
      if (answer.ok) return answer;
      if (answer.stop) { lost = true; return answer; }
      // Paced, or a server that did not answer: the same event again, never the prompt again.
      if (answer.status === 429 || answer.status === 0 || answer.status >= 500) {
        await sleep(answer.retry_after_ms ?? Math.min(2000 * 2 ** attempt, 15_000));
        continue;
      }
      return answer;
    }
    return { ok: false, status: 0, error: "The server did not accept the event after several attempts.", stop: true };
  };

  const fail = async (kind: ScanErrorKind, detail: string) => {
    log(`scan ${scan.id}: ${kind} — ${detail}`);
    if (!lost) await send({ kind: "error", error_kind: kind, detail: detail.slice(0, 500) });
    return "error" as const;
  };

  const heartbeat = setInterval(() => {
    void send({ kind: "heartbeat" }).then((a) => { if (!a.ok && a.stop) lost = true; });
  }, scan.heartbeat_ms);

  try {
    // 1. robots.txt, read by the worker too; the server already checked it at claim.
    const target = new URL(scan.target.url);
    let robotsStatus: number | null = null;
    let robotsBody: string | null = null;
    try {
      const res = await fetch(new URL("/robots.txt", target.origin), { redirect: "manual", headers: { "User-Agent": scan.user_agent }, signal: AbortSignal.timeout(10_000) });
      robotsStatus = res.status;
      robotsBody = res.status >= 200 && res.status < 300 ? (await res.text()).slice(0, 64 * 1024) : null;
    } catch { robotsStatus = null; }
    const robots = robotsFromResponse(robotsStatus, robotsBody, BOT_TOKEN, target.pathname + target.search);
    await send({ kind: "robots", allowed: robots.allowed, crawl_delay_ms: robots.crawlDelayMs, status: robotsStatus });
    if (!robots.allowed) return await fail("robots_disallowed", robots.reason);
    if (lost) return "stopped";

    let nextAllowedAt = 0;
    let pageReported = false;
    for (const [n, scenario] of scan.scenarios.entries()) {
      if (opts.stopping()) return await fail("worker_error", "The worker was stopped before the scan finished.");
      if (lost) return "stopped";

      // 2. A fresh session for this scenario.
      const context: BrowserContext = await opts.browser.newContext({
        userAgent: scan.user_agent, viewport: { width: 1280, height: 900 }, locale: "en-GB", serviceWorkers: "block",
      });
      const page: Page = await context.newPage();
      try {
        const navStart = Date.now();
        try {
          await page.goto(scan.target.url, { waitUntil: "domcontentloaded", timeout: scan.nav_timeout_ms });
          await page.waitForLoadState("load", { timeout: Math.max(1000, scan.nav_timeout_ms - (Date.now() - navStart)) }).catch(() => undefined);
          await page.waitForTimeout(1200);
        } catch (e) {
          return await fail("page_load_failed", (e instanceof Error ? e.message.split("\n")[0] : "The page did not load.").slice(0, 300));
        }
        const navMs = Date.now() - navStart;

        // 3. Still on the target's site?
        if (!sameSite(scan.target.url, page.url())) {
          return await fail("redirected_offsite", `The page moved the browser to ${new URL(page.url()).host}, which is not the target's site.`);
        }
        // 4. A bot challenge ends the scan; it is never attempted.
        const challenge = challengeOf(await pageFacts(page));
        if (challenge) return await fail("blocked_challenge", challenge);

        // 5. One consent click, then the widget.
        const consent = await acceptConsentOnce(page);
        const widget: Widget | null = await discoverWidget(page);
        if (!widget) return await fail("widget_not_found", "No chat input was found on the page, with or without its launcher.");
        if (!pageReported) {
          await send({
            kind: "page", final_url: page.url(), title: (await page.title().catch(() => "")).slice(0, 300) || null,
            widget: { vendor: widget.vendor, selector_path: widget.selectorPath.slice(0, 500), frame_origin: widget.frameOrigin },
            consent_clicked: consent,
          });
          pageReported = true;
        }

        // 6. Login or payment in the widget: stop before anything is typed.
        const before = loginOrPaymentOf(await scopeFacts(widget));
        if (before) return await fail(before.kind, before.detail);

        // 7. Wait until the server's pacing allows the next prompt, then type it exactly.
        const wait = nextAllowedAt - Date.now();
        if (wait > 0) await sleep(wait);
        if (opts.stopping()) return await fail("worker_error", "The worker was stopped before the scan finished.");
        const baseline = await widgetText(widget);
        const typedAt = new Date();
        try {
          await sendPrompt(page, widget, scenario.input);
        } catch (e) {
          return await fail("worker_error", (e instanceof Error ? e.message : "The prompt could not be sent.").slice(0, 300));
        }

        // 8. Wait for the reply to stop changing.
        let text = "";
        let changedAt = Date.now();
        let settled = false;
        const deadline = Date.now() + scan.reply_timeout_ms;
        while (Date.now() < deadline) {
          await sleep(pollMs);
          const delta = extractDelta(baseline, await widgetText(widget), scenario.input);
          if (delta.text !== text) { text = delta.text; changedAt = Date.now(); continue; }
          if (text && !delta.typing && Date.now() - changedAt >= stableMs) { settled = true; break; }
        }
        const fitted = fitBytes(text, REPLY_LIMIT_BYTES - 1024);
        const capture: ObservationCapture = {
          method: "dom_delta",
          selector_path: widget.selectorPath.slice(0, 500),
          frame_origin: widget.frameOrigin,
          typed_at: typedAt.toISOString(),
          captured_at: text ? new Date(changedAt).toISOString() : null,
          stabilised_ms: text ? Date.now() - changedAt : null,
          nav_ms: navMs,
          partial: Boolean(text) && (!settled || fitted.cut),
        };
        const answer = await send({ kind: "turn", scenario_id: scenario.id, prompt_text: scenario.input, response_text: text ? fitted.text : null, capture });
        log(`scan ${scan.id}: ${scenario.id} (${n + 1}/${scan.scenarios.length}) ${text ? (capture.partial ? "partial reply" : "reply") : "no reply"} → ${answer.ok ? "recorded" : `refused: ${answer.error}`}`);
        if (!answer.ok) {
          if (answer.stop) return "stopped";
          return await fail("worker_error", `The server did not record ${scenario.id}: ${answer.error}`);
        }
        nextAllowedAt = Date.now() + answer.wait_ms;

        // 9. A login or payment field that appeared with the reply ends the scan here.
        const after = loginOrPaymentOf(await scopeFacts(widget));
        if (after && answer.next) return await fail(after.kind, `${after.detail} It appeared after scenario ${scenario.id}.`);
        if (!answer.next) return "graded";
      } finally {
        await context.close().catch(() => undefined);
      }
    }
    return "graded";
  } catch (e) {
    return await fail("worker_error", (e instanceof Error ? `${e.name}: ${e.message.split("\n")[0]}` : "The worker failed.").slice(0, 300));
  } finally {
    clearInterval(heartbeat);
  }
}
