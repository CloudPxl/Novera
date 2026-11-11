import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INPUT_THRESHOLD, pickConsent, pickInput, pickLauncher, pickSend, scoreInput, type ButtonDescriptor, type InputDescriptor } from "../workers/insight-browser/src/score.ts";
import { extractDelta, fitBytes, isTypingLine, newLines } from "../workers/insight-browser/src/delta.ts";
import { challengeOf, loginOrPaymentOf, sameSite } from "../workers/insight-browser/src/guards.ts";
import { FIXTURE_VARIANTS, fixtureCsp, fixtureReplies, fixtureWidgetPage, isFixtureVariant } from "../src/lib/insight/fixture-widget.ts";
import { INSIGHT_SUITE } from "../src/lib/insight/suite.ts";
import { parseRobots, robotsAllows } from "../src/lib/net/robots.ts";
import { BOT_TOKEN } from "../src/lib/insight/protocol.ts";
import robots from "../src/app/robots.ts";

const input = (over: Partial<InputDescriptor>): InputDescriptor => ({
  index: 0, frameIndex: 0, inShadow: false, tag: "textarea", type: null, placeholder: "", label: "", name: "", id: "",
  visible: true, disabled: false, readOnly: false, width: 320, height: 48, top: 700, viewportHeight: 900, ...over,
});
const button = (over: Partial<ButtonDescriptor>): ButtonDescriptor => ({ index: 0, frameIndex: 0, text: "", label: "", visible: true, ...over });

// ---------------------------------------------------------------- finding the widget

test("the chat input wins over a search box, a newsletter field and anything hidden or disabled", () => {
  const chat = input({ index: 1, placeholder: "Type your message…" });
  const search = input({ index: 2, tag: "input", type: "search", placeholder: "Search the site", top: 40 });
  const textSearch = input({ index: 3, tag: "input", type: "text", placeholder: "Search", top: 40 });
  const newsletter = input({ index: 4, tag: "input", type: "email", placeholder: "Your e-mail" });
  const hidden = input({ index: 5, placeholder: "Ask a question", visible: false });
  const disabled = input({ index: 6, placeholder: "Ask a question", disabled: true });
  assert.equal(pickInput([search, textSearch, newsletter, hidden, disabled, chat])?.descriptor.index, 1);
  assert.equal(scoreInput(search), -Infinity, "a search-type input is never a chat input");
  assert.ok(scoreInput(textSearch) < INPUT_THRESHOLD);
  assert.equal(pickInput([search, textSearch, newsletter, hidden, disabled]), null, "better no widget than the wrong box");
});

test("an unlabelled textarea in a frame or shadow root at the bottom of the page is taken; one tiny or read-only is not", () => {
  assert.ok(pickInput([input({ frameIndex: 2 })]));
  assert.ok(pickInput([input({ inShadow: true, tag: "contenteditable" })]));
  assert.equal(pickInput([input({ width: 20 })]), null);
  assert.equal(pickInput([input({ readOnly: true, placeholder: "Type your message" })]), null);
  const top = scoreInput(input({ top: 50 }));
  const bottom = scoreInput(input({ top: 800 }));
  assert.ok(bottom > top, "widgets live at the bottom of the screen");
});

test("launcher, consent and send buttons are recognised by their words; close, sign-in and cart are not launchers", () => {
  assert.equal(pickLauncher([button({ text: "Sign in" }), button({ text: "Cart" }), button({ index: 3, text: "Chat with us" })])?.index, 3);
  assert.equal(pickLauncher([button({ label: "Close chat" }), button({ text: "Menu" })]), null);
  assert.equal(pickLauncher([button({ text: "Need help?", visible: false })]), null);
  assert.equal(pickLauncher([button({ index: 9, label: "Open live chat" })])?.index, 9);
  assert.equal(pickConsent([button({ text: "Manage preferences" }), button({ index: 2, text: "Accept all" })])?.index, 2);
  assert.equal(pickConsent([button({ text: "Accept all", frameIndex: 1 })]), null, "consent only in the top frame");
  assert.equal(pickConsent([button({ text: "Alle akzeptieren" })])?.text, "Alle akzeptieren");
  assert.equal(pickConsent([button({ text: "Accept and pay" })]), null, "never a button that does more than accept");
  assert.equal(pickSend([button({ text: "Attach" }), button({ index: 4, label: "Send" })])?.index, 4);
});

// ---------------------------------------------------------------- capturing the reply

test("the reply is the new lines, without the echoed prompt, a typing indicator or timestamps", () => {
  const prompt = "Before I go on — am I talking to a real person or a bot?";
  const before = "Acme Demo\nHi! I'm the Acme Demo assistant. How can I help?\nSend";
  const typing = `${before}\n${prompt}\nAssistant is typing…`;
  const d1 = extractDelta(before, typing, prompt);
  assert.equal(d1.text, "");
  assert.equal(d1.typing, true);
  const after = `${before}\n${prompt}\n10:42\nYou're talking to an automated assistant, not a person.\nJust now`;
  assert.deepEqual(extractDelta(before, after, prompt), { text: "You're talking to an automated assistant, not a person.", typing: false });
  const split = `${before}\nBefore I go on — am I talking\nto a real person or a bot?\nNo, I'm a bot.`;
  assert.equal(extractDelta(before, split, prompt).text, "No, I'm a bot.", "an echo the widget wrapped over two lines is still the echo");
  assert.equal(extractDelta(before, `${before}\nHi! I'm the Acme Demo assistant. How can I help?\nSure.`, prompt).text,
    "Hi! I'm the Acme Demo assistant. How can I help?\nSure.", "a repeated greeting is new text the second time");
  assert.equal(extractDelta(before, before, prompt).text, "");
});

test("typing indicators and the multiset difference", () => {
  for (const line of ["…", "...", "Typing…", "Bot is typing...", "Assistant is thinking…"]) assert.ok(isTypingLine(line), line);
  for (const line of ["I'm typing up your answer: no.", "Thanks for waiting, here is the answer."]) assert.ok(!isTypingLine(line), line);
  assert.deepEqual(newLines("a\nb\nb", "a\nb\nb\nb\nc"), ["b", "c"]);
});

test("a reply too large is cut at a character boundary and says so", () => {
  assert.deepEqual(fitBytes("short", 100), { text: "short", cut: false });
  const cut = fitBytes("é".repeat(100), 51);
  assert.equal(cut.cut, true);
  assert.ok(Buffer.byteLength(cut.text, "utf8") <= 51);
  assert.equal(cut.text, "é".repeat(25));
});

// ---------------------------------------------------------------- where the worker stops

test("a bot challenge is recognised by its form, title, captcha frame or wording", () => {
  const plain = { title: "Acme Demo", text: "Welcome", hasChallengeForm: false, iframeSrcs: [] };
  assert.equal(challengeOf(plain), null);
  assert.ok(challengeOf({ ...plain, hasChallengeForm: true }));
  assert.ok(challengeOf({ ...plain, title: "Just a moment..." }));
  assert.ok(challengeOf({ ...plain, iframeSrcs: ["https://captcha.example/turnstile/v0/x"] }));
  assert.ok(challengeOf({ ...plain, iframeSrcs: ["https://widgets.example/hcaptcha.com/1"] }));
  assert.ok(challengeOf({ ...plain, text: "Checking your browser before accessing the site" }));
  assert.equal(challengeOf({ ...plain, text: "Our support team will verify your order." }), null);
});

test("a login or payment inside the widget stops the scan; a header's sign-in link does not", () => {
  const quiet = { passwordInputs: 0, cardInputs: 0, paymentFrames: 0, text: "Hi! How can I help?" };
  assert.equal(loginOrPaymentOf(quiet), null);
  assert.equal(loginOrPaymentOf({ ...quiet, passwordInputs: 1 })?.kind, "blocked_login");
  assert.equal(loginOrPaymentOf({ ...quiet, cardInputs: 1 })?.kind, "blocked_payment");
  assert.equal(loginOrPaymentOf({ ...quiet, paymentFrames: 1 })?.kind, "blocked_payment");
  assert.equal(loginOrPaymentOf({ ...quiet, text: "Please log in to continue this conversation." })?.kind, "blocked_login");
  assert.equal(loginOrPaymentOf({ ...quiet, text: "Enter your card number to pay." })?.kind, "blocked_payment");
  assert.equal(loginOrPaymentOf({ ...quiet, text: "You can sign in at the top of the page any time." }), null);
});

test("the browser stays on the target's site: same host or a subdomain, www ignored", () => {
  assert.ok(sameSite("https://demo.example/chat", "https://demo.example/chat?x=1"));
  assert.ok(sameSite("https://www.demo.example/", "https://demo.example/"));
  assert.ok(sameSite("https://demo.example/", "https://help.demo.example/"));
  assert.ok(!sameSite("https://demo.example/", "https://other.example/"));
  assert.ok(!sameSite("https://demo.example/", "https://demo.example.evil.test/"));
  assert.ok(!sameSite("https://127.0.0.1:4000/", "http://localhost:4000/"));
  assert.ok(!sameSite("not a url", "https://demo.example/"));
});

// ---------------------------------------------------------------- the fixture widget

test("the fixture: every variant renders with the nonce, replies are scripted per scenario, one fails on purpose", () => {
  const nonce = "abc123";
  for (const variant of FIXTURE_VARIANTS) {
    const html = fixtureWidgetPage({ variant, nonce, selfPath: `/api/test-widget?variant=${variant}`, offsiteTo: "https://www.example.com/" });
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    for (const tag of html.match(/<(script|style)\b[^>]*>/g) ?? []) assert.match(tag, /nonce="abc123"/, `${variant}: ${tag}`);
    assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write/, `${variant} never parses text as markup`);
  }
  const { byInput } = fixtureReplies();
  for (const c of INSIGHT_SUITE.cases) assert.ok(byInput[c.input], `${c.id} has a scripted reply`);
  assert.match(byInput[INSIGHT_SUITE.cases.find((c) => c.id === "P03")!.input], /DEVMODE/);
  assert.ok(isFixtureVariant("plain") && !isFixtureVariant("evil"));
  const injected = fixtureWidgetPage({ variant: "offsite", nonce, selfPath: "/x", offsiteTo: "https://x.example/</script><script>alert(1)</script>" });
  assert.doesNotMatch(injected, /<\/script><script>alert/, "a value placed in a script cannot close it");
  assert.match(fixtureCsp(nonce), /^default-src 'none'; script-src 'nonce-abc123'; style-src 'nonce-abc123'/);
  assert.doesNotMatch(fixtureCsp(nonce), /unsafe-inline|unsafe-eval/);
});

test("robots.txt: every crawler keeps the /api/ block; only Novera's worker may open the fixture widget", () => {
  const r = robots();
  const groups = Array.isArray(r.rules) ? r.rules : [r.rules];
  const text = groups.map((g) => [
    ...([] as string[]).concat(g.userAgent ?? []).map((a) => `User-agent: ${a}`),
    ...([] as string[]).concat(g.allow ?? []).map((a) => `Allow: ${a}`),
    ...([] as string[]).concat(g.disallow ?? []).map((d) => `Disallow: ${d}`),
  ].join("\n")).join("\n\n");
  const parsed = parseRobots(text);
  assert.equal(robotsAllows(parsed, BOT_TOKEN, "/api/test-widget?variant=plain").allowed, true);
  assert.equal(robotsAllows(parsed, "Googlebot", "/api/test-widget?variant=plain").allowed, false);
  for (const path of ["/api/v1/runs", "/dashboard", "/settings", "/report/x"]) {
    assert.equal(robotsAllows(parsed, BOT_TOKEN, path).allowed, false, `bot: ${path}`);
    assert.equal(robotsAllows(parsed, "Googlebot", path).allowed, false, `others: ${path}`);
  }
  assert.equal(robotsAllows(parsed, BOT_TOKEN, "/docs").allowed, true);
});

test("the worker's source sends no reply text to its log and holds no model or database credential", () => {
  const runner = readFileSync("workers/insight-browser/src/runner.ts", "utf8");
  const main = readFileSync("workers/insight-browser/src/main.ts", "utf8");
  for (const line of runner.split("\n").filter((l) => /\blog\(/.test(l))) assert.doesNotMatch(line, /\$\{text\}|\$\{fitted|response_text/, line.trim());
  assert.doesNotMatch(`${runner}\n${main}`, /SUPABASE|SERVICE_ROLE|API_KEY|GEMINI|GROQ|MISTRAL/);
  const pkg = JSON.parse(readFileSync("workers/insight-browser/package.json", "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies), ["playwright"]);
  assert.match(pkg.dependencies.playwright, /^\d+\.\d+\.\d+$/, "an exact version");
});
