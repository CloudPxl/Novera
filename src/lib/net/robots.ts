/**
 * A small robots.txt reader (RFC 9309): user-agent groups, Allow and Disallow by longest match
 * with Allow winning a tie, `*` and `$` in patterns, and Crawl-delay. Enough to answer the one
 * question the insight worker asks — may this bot open this path — on both sides of the wire.
 * No dependency: the file is small and the rules are few.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

export interface Robots {
  groups: RobotsGroup[];
}

export function parseRobots(text: string): Robots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      if (field === "disallow" && value === "") continue; // "Disallow:" with nothing means allow all
      if (value === "") continue;
      current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = n;
    }
  }
  return { groups };
}

/** The group for this bot: the most specific user-agent token match, else `*`, else none. */
export function groupFor(robots: Robots, botToken: string): RobotsGroup | null {
  const token = botToken.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLength = -1;
  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent !== "*" && token.startsWith(agent) && agent.length > bestLength) {
        best = group;
        bestLength = agent.length;
      }
    }
  }
  if (best) return best;
  return robots.groups.find((g) => g.agents.includes("*")) ?? null;
}

function patternMatches(pattern: string, path: string): boolean {
  // `*` matches any run of characters; a trailing `$` anchors the end. Everything else is literal.
  let anchored = false;
  let p = pattern;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const parts = p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const source = `^${parts.join(".*")}${anchored ? "$" : ""}`;
  try {
    return new RegExp(source).test(path);
  } catch {
    return false;
  }
}

export interface RobotsDecision {
  allowed: boolean;
  /** The rule that decided, when one matched. */
  rule: RobotsRule | null;
  crawlDelayMs: number | null;
}

/** Whether this bot may open `path` (pathname plus search). No group or no matching rule means allowed. */
export function robotsAllows(robots: Robots, botToken: string, path: string): RobotsDecision {
  const group = groupFor(robots, botToken);
  const crawlDelayMs = group?.crawlDelaySeconds != null ? Math.round(group.crawlDelaySeconds * 1000) : null;
  if (!group) return { allowed: true, rule: null, crawlDelayMs };
  let winner: RobotsRule | null = null;
  let winnerLength = -1;
  for (const rule of group.rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (length > winnerLength || (length === winnerLength && rule.allow && winner && !winner.allow)) {
      winner = rule;
      winnerLength = length;
    }
  }
  return { allowed: winner ? winner.allow : true, rule: winner, crawlDelayMs };
}

/**
 * The decision for a fetched robots.txt by status: no file (404, or any other 4xx) allows
 * everything; a server error (5xx) or no answer is read as disallowed, the conservative reading.
 */
export function robotsFromResponse(status: number | null, body: string | null, botToken: string, path: string): RobotsDecision & { reason: string } {
  if (status === null) return { allowed: false, rule: null, crawlDelayMs: null, reason: "robots.txt could not be fetched" };
  if (status >= 500) return { allowed: false, rule: null, crawlDelayMs: null, reason: `robots.txt answered HTTP ${status}` };
  if (status >= 400) return { allowed: true, rule: null, crawlDelayMs: null, reason: `no robots.txt (HTTP ${status})` };
  if (status >= 300) return { allowed: false, rule: null, crawlDelayMs: null, reason: `robots.txt redirected (HTTP ${status}); redirects are not followed` };
  if (body === null) return { allowed: true, rule: null, crawlDelayMs: null, reason: `robots.txt was empty (HTTP ${status})` };
  const decision = robotsAllows(parseRobots(body), botToken, path);
  return { ...decision, reason: decision.rule ? `${decision.rule.allow ? "Allow" : "Disallow"}: ${decision.rule.pattern}` : "no rule matched" };
}
