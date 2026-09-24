import { test } from "node:test";
import assert from "node:assert/strict";
import { problemMessage, PROBLEMS } from "../src/app/auth/confirm/problems.ts";

/**
 * `/sign-in` used to render whatever arrived in `?problem=`. React escaped it, so
 * there was no markup injection — but a link reading
 * `/sign-in?problem=Your account is locked, call +44…` put a stranger's sentence
 * inside Novera's own alert box on the page that asks for a password.
 */

test("a stranger's link cannot say anything through us", () => {
  const attempts = [
    "Your account is locked. Call +44 20 0000 0000 to restore it.",
    "<b>urgent</b>",
    "https://novera-support.example/verify",
  ];
  for (const attempt of attempts) {
    const shown = problemMessage(attempt);
    assert.equal(shown, "That link did not work. Sign in, or ask for a new one.");
    assert.doesNotMatch(shown!, /\+44|urgent|example/);
  }
});

test("the codes the application defines resolve to its own words", () => {
  for (const [code, message] of Object.entries(PROBLEMS)) {
    assert.equal(problemMessage(code), message);
  }
});

test("no code shows nothing at all", () => {
  assert.equal(problemMessage(undefined), null);
  assert.equal(problemMessage(""), null);
});

test("an expired reset link points at the way to get another", () => {
  assert.match(PROBLEMS.reset_expired, /ask for a new one below/i);
});
