import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText } from "../scripts/scan-secrets.mts";
import { checkMigrations } from "../scripts/check-migrations.mts";

// Built at run time so this file does not itself carry a key shape for the scanner to find.
const rnd = (n: number, alphabet = "Zq7Hk2Lm9Rt4Vw8Xy3Bn6Cd5Fg1Jp0Ps") => Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");
const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${rnd(43)}`;

test("the secret scan finds real-length keys of every shape Novera handles", () => {
  const text = [
    `OPENAI=sk-proj-${rnd(48)}`,
    `GROQ=gsk_${rnd(52)}`,
    `NOVERA=nvk_${rnd(43)}`,
    `HOOK=whsec_${rnd(43)}`,
    `STRIPE=sk_live_${rnd(30)}`,
    `SERVICE=${jwt({ iss: "supabase", role: "service_role" })}`,
    `DB=postgresql://postgres.abc:${rnd(20)}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  ].join("\n");
  const rules = scanText("x.env", text).map((f) => f.rule);
  assert.deepEqual(rules, [
    "OpenAI / Anthropic key", "Groq key", "Novera API key", "webhook signing secret",
    "Stripe secret or restricted key", "Supabase service_role JWT", "database URL with password",
  ]);
});

test("a finding never prints the value it found", () => {
  const key = `gsk_${rnd(52)}`;
  const [finding] = scanText("x", `k=${key}`);
  assert.ok(!finding.excerpt.includes(key.slice(8)));
});

test("fixtures, the local demo keys, anon keys and the allow marker pass", () => {
  const text = [
    "my key is sk-live-abcdef1234567890",
    "AKIAABCDEFGHIJKLMNOP",
    `plaintext: "sk-not-a-real-key-only-used-to-prove-resolution"`,
    jwt({ iss: "supabase-demo", role: "service_role" }),
    jwt({ iss: "supabase", role: "anon" }),
    `gsk_${rnd(52)} // secret-scan: allow`,
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "postgresql://postgres.[ref]:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  ].join("\n");
  assert.deepEqual(scanText("t", text), []);
});

test("migration names must be numbered, unique and snake_case", () => {
  const { errors } = checkMigrations(["0001_init.sql", "0002_a.sql", "0002_b.sql", "3_bad.sql", "0004_Bad-Name.sql", "notes.md"]);
  assert.equal(errors.length, 4);
  assert.ok(errors.some((e) => /0002 is used by/.test(e)));
});

test("a gap is a warning, not a failure: parallel branches reserve numbers", () => {
  const { errors, warnings } = checkMigrations(["0001_a.sql", "0002_b.sql", "0005_e.sql"]);
  assert.deepEqual(errors, []);
  assert.match(warnings[0], /skips 0003–0004/);
});

test("a migration that exists at the base cannot be modified, renamed or deleted", () => {
  const base = { files: ["0001_a.sql", "0002_b.sql", "0003_c.sql"], changed: [
    { status: "M", file: "supabase/migrations/0001_a.sql" },
    { status: "D", file: "supabase/migrations/0002_b.sql" },
    { status: "A", file: "supabase/migrations/0004_d.sql" },
  ] };
  const { errors } = checkMigrations(["0001_a.sql", "0003_c.sql", "0004_d.sql"], base);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /0001_a\.sql: modified/);
  assert.match(errors[1], /0002_b\.sql: deleted/);
});

test("a new migration numbered below the base's highest is flagged as out of order", () => {
  const base = { files: ["0001_a.sql", "0003_c.sql"], changed: [{ status: "A", file: "supabase/migrations/0002_b.sql" }] };
  const { errors, warnings } = checkMigrations(["0001_a.sql", "0002_b.sql", "0003_c.sql"], base);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /0002_b\.sql is new but numbered below 0003/.test(w)));
});
