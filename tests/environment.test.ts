import { test } from "node:test";
import assert from "node:assert/strict";
import { isNoveraFixture, reportEnvironment, FIXTURE_ENVIRONMENT, CUSTOMER_ENVIRONMENT } from "../src/lib/agents/environment.ts";

const http = (url: string) => ({ kind: "http" as const, url, bodyTemplate: {}, responsePath: "reply" });

test("a run against Novera's own fixture is named as one in the report", () => {
  for (const url of ["http://localhost:3000/api/test-agent", "https://www.nover.space/api/test-agent/", "http://127.0.0.1:3000/api/test-agent"]) {
    assert.ok(isNoveraFixture(http(url) as never), url);
    assert.equal(reportEnvironment(http(url) as never), FIXTURE_ENVIRONMENT);
  }
  assert.ok(isNoveraFixture(http("https://staging.example/api/test-agent") as never, "https://staging.example"));
  // The report page labels an environment as test data when it mentions a fixture.
  assert.match(FIXTURE_ENVIRONMENT, /fixture/i);
});

test("a customer's agent is not mistaken for the fixture", () => {
  for (const url of ["https://bot.acme.test/api/test-agent", "https://www.nover.space/api/support-agent", "not a url"]) {
    assert.equal(reportEnvironment(http(url) as never), CUSTOMER_ENVIRONMENT, url);
  }
  assert.doesNotMatch(CUSTOMER_ENVIRONMENT, /fixture/i);
});
