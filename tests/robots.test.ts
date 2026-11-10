import { test } from "node:test";
import assert from "node:assert/strict";
import { groupFor, parseRobots, robotsAllows, robotsFromResponse } from "../src/lib/net/robots.ts";

const BOT = "NoveraInsightBot";

test("groups: the bot's own group wins over *, and a missing group allows", () => {
  const robots = parseRobots(`
    # comment
    User-agent: *
    Disallow: /private/

    User-agent: noverainsightbot
    Disallow: /demo/
    Crawl-delay: 20
  `);
  assert.equal(robots.groups.length, 2);
  assert.deepEqual(groupFor(robots, BOT)?.agents, ["noverainsightbot"]);
  assert.equal(robotsAllows(robots, BOT, "/demo/chat").allowed, false);
  assert.equal(robotsAllows(robots, BOT, "/private/x").allowed, true, "the * group does not apply once the bot has its own");
  assert.equal(robotsAllows(robots, BOT, "/demo/chat").crawlDelayMs, 20_000);
  assert.equal(robotsAllows(parseRobots("User-agent: other\nDisallow: /"), BOT, "/").allowed, true);
  assert.equal(robotsAllows(parseRobots(""), BOT, "/anything").allowed, true);
});

test("rules: longest match decides, Allow wins a tie, * and $ work, an empty Disallow allows", () => {
  const robots = parseRobots(`
    User-agent: *
    Disallow: /chat
    Allow: /chat/public
    Disallow: /*.pdf$
    Disallow:
  `);
  assert.equal(robotsAllows(robots, BOT, "/chat").allowed, false);
  assert.equal(robotsAllows(robots, BOT, "/chat/public/demo").allowed, true);
  assert.equal(robotsAllows(robots, BOT, "/files/a.pdf").allowed, false);
  assert.equal(robotsAllows(robots, BOT, "/files/a.pdfx").allowed, true);
  assert.equal(robotsAllows(robots, BOT, "/").allowed, true);
  const tie = parseRobots("User-agent: *\nDisallow: /demo\nAllow: /demo");
  assert.equal(robotsAllows(tie, BOT, "/demo").allowed, true);
  const root = parseRobots("User-agent: *\nDisallow: /");
  assert.equal(robotsAllows(root, BOT, "/demo?x=1").allowed, false);
});

test("several user-agent lines share one group; a bad pattern never throws", () => {
  const robots = parseRobots("User-agent: a\nUser-agent: noverainsightbot\nDisallow: /x\nUser-agent: b\nAllow: /");
  assert.equal(robots.groups.length, 2);
  assert.equal(robotsAllows(robots, BOT, "/x/y").allowed, false);
  assert.doesNotThrow(() => robotsAllows(parseRobots("User-agent: *\nDisallow: /(["), BOT, "/(["));
});

test("by response: 4xx allows, 5xx and no answer disallow, a redirect is not followed", () => {
  assert.equal(robotsFromResponse(404, null, BOT, "/").allowed, true);
  assert.equal(robotsFromResponse(403, "", BOT, "/").allowed, true);
  assert.equal(robotsFromResponse(503, null, BOT, "/").allowed, false);
  assert.equal(robotsFromResponse(null, null, BOT, "/").allowed, false);
  assert.equal(robotsFromResponse(301, null, BOT, "/").allowed, false);
  const ok = robotsFromResponse(200, "User-agent: *\nDisallow: /demo", BOT, "/demo");
  assert.equal(ok.allowed, false);
  assert.match(ok.reason, /Disallow: \/demo/);
  assert.equal(robotsFromResponse(200, "User-agent: *\nDisallow: /demo", BOT, "/").allowed, true);
});
