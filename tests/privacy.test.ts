import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilingFor, classify, allows, higher } from "../src/lib/privacy/data-class.ts";
import { createRoutedChat } from "../src/lib/router/execute.ts";
import type { RouteTable } from "../src/lib/router/routes.ts";
import type { Connection } from "../src/lib/providers/registry.ts";
import type { ChatRequest } from "../src/lib/providers/types.ts";
import { gradingNote } from "../src/app/(app)/runs/[id]/grading-note.ts";

const texts = (req: Omit<ChatRequest, "model">) => [req.system ?? "", ...req.messages.map((m) => m.content)];

test("detection raises a class; redaction lowers only what detection raised", () => {
  const plain = classify({ floor: "synthetic", texts: ["What is your refund window?"], rebuild: (t) => t });
  assert.equal(plain.original, "synthetic");
  assert.equal(plain.redacted, null);

  const leak = classify({ floor: "redacted_customer", texts: ["Sure, it is marta.lindqvist@northwind.example"], rebuild: (t) => t });
  assert.equal(leak.original, "identifiable_customer");
  assert.equal(leak.redacted?.dataClass, "redacted_customer");
  assert.deepEqual(leak.redacted?.request, ["Sure, it is [EMAIL_1]"]);

  // A support message is a real person's words: no pattern removal makes it anonymous.
  const support = classify({ floor: "identifiable_customer", texts: ["Hi, I'm Jan, my email is jan@example.com"], rebuild: (t) => t });
  assert.equal(support.original, "identifiable_customer");
  assert.equal(support.redacted, null);

  // Already-redacted text from a production failure stays where it was.
  const stored = classify({ floor: "redacted_customer", texts: ["Please refund [EMAIL_1]"], rebuild: (t) => t });
  assert.equal(stored.original, "redacted_customer");
});

test("ceilings follow the provider's terms; a customer's own key is the customer's choice", () => {
  assert.equal(ceilingFor({ name: "groq" }), "identifiable_customer");
  // Raised 2026-09-29 once the account owner switched off training in Mistral's console.
  assert.equal(ceilingFor({ name: "mistral" }), "identifiable_customer");
  assert.equal(ceilingFor({ name: "groq", ceiling: "redacted_customer" }), "redacted_customer");
  assert.equal(ceilingFor({ name: "google" }), "synthetic");
  assert.equal(ceilingFor({ name: "openrouter" }), "synthetic");
  assert.equal(ceilingFor({ name: "someone-new" }), "public");
  assert.equal(ceilingFor({ name: "google", owner: "customer" }), "special_category");
  assert.equal(allows("redacted_customer", "synthetic"), true);
  assert.equal(allows("synthetic", "redacted_customer"), false);
  assert.equal(higher("synthetic", "identifiable_customer"), "identifiable_customer");
});

function recorder(name: string, seen: Map<string, string[]>, owner?: "customer", ceiling?: "redacted_customer"): Connection {
  return {
    name, apiKey: "k", ...(owner ? { owner } : {}), ...(ceiling ? { ceiling } : {}),
    provider: {
      id: "openai-compatible", label: name,
      async chat(request) {
        seen.set(name, texts(request));
        return { text: `from ${name}`, model: request.model, usage: {}, raw: {} };
      },
    },
  };
}

const chain: RouteTable = {
  judge: [
    { connection: "google", model: "g" },
    { connection: "cautious", model: "m" },
    { connection: "groq", model: "q" },
  ],
  judge_critical: [], diagnose: [], draft: [],
};

test("a reply that leaks personal data skips a synthetic-only provider and reaches the next one redacted", async () => {
  const seen = new Map<string, string[]>();
  const chat = createRoutedChat({
    connections: new Map(["google", "cautious", "groq"].map((n) => [n, recorder(n, seen, undefined, n === "cautious" ? "redacted_customer" : undefined)])),
    routes: chain,
  });
  const res = await chat("judge", {
    system: "Grade this.",
    messages: [{ role: "user", content: "Agent said: call Marta on +46 70 555 0134 or marta@northwind.example" }],
  }, { data: "redacted_customer" });

  assert.equal(res.servedBy.connection, "cautious");
  assert.equal(seen.has("google"), false, "google must never receive it");
  const sent = seen.get("cautious")!.join(" ");
  assert.ok(!sent.includes("marta@northwind.example") && !sent.includes("555 0134"), sent);
  assert.match(sent, /\[EMAIL_1\]/);
  assert.equal(res.attempts[0].refused, true);
  assert.match(res.attempts[0].error ?? "", /identifiable customer data exceeds/);
  assert.equal(res.attempts[1].redacted, true);
});

test("a support message goes only to a provider approved for identifiable data, unaltered", async () => {
  const seen = new Map<string, string[]>();
  const chat = createRoutedChat({
    connections: new Map(["google", "cautious", "groq"].map((n) => [n, recorder(n, seen, undefined, n === "cautious" ? "redacted_customer" : undefined)])),
    routes: chain,
  });
  const message = "Hi, I'm Jan Novak, jan@example.com — please delete my account";
  const res = await chat("judge", { messages: [{ role: "user", content: message }] }, { data: "identifiable_customer" });
  assert.equal(res.servedBy.connection, "groq");
  assert.deepEqual([...seen.keys()], ["groq"]);
  assert.equal(seen.get("groq")![1], message);
  assert.deepEqual(res.attempts.map((a) => a.refused ?? false), [true, true, false]);
});

test("a call site that declares nothing is treated as sending identifiable data", async () => {
  const seen = new Map<string, string[]>();
  const chat = createRoutedChat({
    connections: new Map(["google", "cautious", "groq"].map((n) => [n, recorder(n, seen, undefined, n === "cautious" ? "redacted_customer" : undefined)])),
    routes: chain,
  });
  const res = await chat("judge", { messages: [{ role: "user", content: "nothing personal here" }] });
  assert.equal(res.servedBy.connection, "groq");
});

test("synthetic content may go anywhere, and a customer's own key receives what the customer sends", async () => {
  const seen = new Map<string, string[]>();
  const ours = createRoutedChat({ connections: new Map([["google", recorder("google", seen)]]), routes: chain });
  assert.equal((await ours("judge", { messages: [{ role: "user", content: "a scenario" }] }, { data: "synthetic" })).servedBy.connection, "google");

  const theirs = createRoutedChat({ connections: new Map([["google", recorder("google", seen, "customer")]]), routes: chain });
  const res = await theirs("judge", { messages: [{ role: "user", content: "jan@example.com" }] }, { data: "identifiable_customer" });
  assert.equal(res.servedBy.connection, "google");
  assert.equal(seen.get("google")![1], "jan@example.com");
});

test("when no provider may receive it, the route is exhausted and every refusal is kept", async () => {
  const chat = createRoutedChat({ connections: new Map([["google", recorder("google", new Map())]]), routes: chain });
  await assert.rejects(
    chat("judge", { messages: [{ role: "user", content: "jan@example.com" }] }, { data: "identifiable_customer" }),
    (e: Error & { attempts?: Array<{ refused?: boolean }> }) => e.attempts?.some((a) => a.refused) === true,
  );
});

test("the case says which grader read placeholders instead of the reply", () => {
  const note = gradingNote("groq/openai/gpt-oss-20b", "agreed", [
    { model: "groq/openai/gpt-oss-20b", status: "fail" },
    { model: "mistral/ministral-8b-latest", status: "fail", redacted: true },
  ]);
  assert.match(note, /mistral\/ministral-8b-latest read the reply with personal data replaced by placeholders$/);
  assert.doesNotMatch(gradingNote("m", "agreed", [{ model: "m", status: "pass" }]), /placeholders/);
});

test("with training switched off, Mistral receives identifiable data as written", async () => {
  const seen = new Map<string, string[]>();
  const chat = createRoutedChat({
    connections: new Map(["google", "mistral"].map((n) => [n, recorder(n, seen)])),
    routes: { judge: [{ connection: "google", model: "g" }, { connection: "mistral", model: "m" }], judge_critical: [], diagnose: [], draft: [] },
  });
  const message = "Hi, I'm Jan Novak, jan@example.com";
  const res = await chat("judge", { messages: [{ role: "user", content: message }] }, { data: "identifiable_customer" });
  assert.equal(res.servedBy.connection, "mistral");
  assert.equal(seen.get("mistral")![1], message);
  assert.equal(res.attempts[1].redacted, undefined);
});
