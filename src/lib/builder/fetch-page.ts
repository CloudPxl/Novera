import "server-only";
import { assertPublicUrl, publicOnlyDispatcher, PrivateAddressError, refusedAddress } from "../net/public-url.ts";
import { BodyTooLarge, discardBody, readTextLimited } from "../net/read-body.ts";
import { MAX_UPLOAD_BYTES } from "./sources.ts";

/**
 * Fetches one page a member named, once, after they confirmed they may have it fetched.
 *
 * Not a crawler: one address, no links followed. Every hop of a redirect is checked as
 * a new address (public internet only, http or https, no credentials in the URL), at
 * most three of them, and the connection itself goes through the same public-only
 * dispatcher as an agent call. robots.txt is read for each origin and a page it
 * disallows is not fetched — the person can paste the text instead, which is their call
 * to make about their own material.
 */

export const USER_AGENT = "NoveraSourceFetcher/1.0 (+https://www.nover.space/docs/suite-builder)";
const ROBOTS_TOKEN = "noverasourcefetcher";
const MAX_REDIRECTS = 3;
const PAGE_TIMEOUT_MS = 10_000;
const ROBOTS_TIMEOUT_MS = 4_000;
const MAX_ROBOTS_BYTES = 64 * 1024;

export interface FetchedPage {
  ok: true;
  body: Uint8Array;
  contentType: string;
  finalUrl: string;
  redirects: string[];
  robots: "allowed" | "no_robots_file";
  status: number;
}

export type FetchOutcome = FetchedPage | { ok: false; error: string; redirects: string[] };

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

/** Whether robots.txt lets a fetcher with this token read `path`. Longest match wins; Allow wins a tie. */
export function robotsAllows(robots: string, path: string, token = ROBOTS_TOKEN): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; prefix: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      lastWasAgent = false;
      if (field === "disallow" && value === "") continue;
      current.rules.push({ allow: field === "allow", prefix: value });
    } else {
      lastWasAgent = false;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a && a !== "*" && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    const pattern = new RegExp("^" + rule.prefix.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$"));
    if (!pattern.test(path)) continue;
    if (!best || rule.prefix.length > best.length || (rule.prefix.length === best.length && rule.allow)) {
      best = { allow: rule.allow, length: rule.prefix.length };
    }
  }
  return best ? best.allow : true;
}

async function guardedGet(url: string, timeoutMs: number, fetchImpl: FetchImpl): Promise<Response> {
  return fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": USER_AGENT, accept: "text/html, text/plain, text/markdown;q=0.9, */*;q=0.1" },
    signal: AbortSignal.timeout(timeoutMs),
    dispatcher: publicOnlyDispatcher(),
  } as RequestInit);
}

export async function fetchPublicPage(raw: string, options: { fetchImpl?: FetchImpl; allowLoopback?: boolean } = {}): Promise<FetchOutcome> {
  const fetchImpl = options.fetchImpl ?? ((u, i) => fetch(u, i));
  const redirects: string[] = [];
  const robotsChecked = new Set<string>();
  let robotsState: FetchedPage["robots"] = "allowed";
  let next = raw.trim();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = await assertPublicUrl(next, { allowLoopback: options.allowLoopback });
    } catch (error) {
      return { ok: false, error: error instanceof PrivateAddressError ? error.message : "That address could not be checked.", redirects };
    }
    if (url.username || url.password) return { ok: false, error: "Addresses with a username or password in them are not fetched.", redirects };

    if (!robotsChecked.has(url.origin)) {
      robotsChecked.add(url.origin);
      try {
        const r = await guardedGet(`${url.origin}/robots.txt`, ROBOTS_TIMEOUT_MS, fetchImpl);
        if (r.status >= 200 && r.status < 300) {
          const robots = await readTextLimited(r, MAX_ROBOTS_BYTES);
          if (!robotsAllows(robots, url.pathname + url.search)) {
            return { ok: false, error: `${url.origin}/robots.txt asks automated fetchers not to read this page, so Novera did not. Paste the text instead if it is yours to use.`, redirects };
          }
        } else {
          await discardBody(r);
          if (hop === 0) robotsState = "no_robots_file";
        }
      } catch {
        // An unreadable robots.txt is treated as none, as crawlers do; the page itself is
        // still fetched through the same guard.
        if (hop === 0) robotsState = "no_robots_file";
      }
    }

    let response: Response;
    try {
      response = await guardedGet(url.toString(), PAGE_TIMEOUT_MS, fetchImpl);
    } catch (error) {
      const refused = refusedAddress(error);
      if (refused) return { ok: false, error: refused, redirects };
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return { ok: false, error: `The page did not answer within ${PAGE_TIMEOUT_MS / 1000} s.`, redirects };
      }
      return { ok: false, error: "The page could not be reached.", redirects };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await discardBody(response);
      if (!location) return { ok: false, error: `The page answered ${response.status} with nowhere to go.`, redirects };
      next = new URL(location, url).toString();
      redirects.push(next);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      await discardBody(response);
      return { ok: false, error: `The page answered ${response.status}.`, redirects };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/^(text\/(html|plain|markdown)|application\/xhtml\+xml)/i.test(contentType)) {
      await discardBody(response);
      return { ok: false, error: `The page is ${contentType || "of an unknown type"}; only HTML and text pages are read. Upload the document instead.`, redirects };
    }
    try {
      const text = await readTextLimited(response, MAX_UPLOAD_BYTES);
      return { ok: true, body: new TextEncoder().encode(text), contentType, finalUrl: url.toString(), redirects, robots: robotsState, status: response.status };
    } catch (error) {
      if (error instanceof BodyTooLarge) return { ok: false, error: "The page is larger than 2 MB, so it was not read.", redirects };
      return { ok: false, error: "The page stopped answering while it was being read.", redirects };
    }
  }
  return { ok: false, error: `The page redirected more than ${MAX_REDIRECTS} times.`, redirects };
}
