/**
 * Asks each configured provider which models the key can actually use.
 *
 * Model line-ups change faster than code does, so the routing table is built from
 * what the providers report today rather than from names recalled at write time.
 * Prints ids only — no key is ever echoed.
 *
 * Run: npm run discover:models
 */
type Row = { provider: string; id: string; note?: string };

const rows: Row[] = [];
const problems: string[] = [];

async function google(key: string) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": key },
  });
  if (!res.ok) {
    problems.push(`google: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    return;
  }
  const body = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
  for (const m of body.models ?? []) {
    if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
    rows.push({ provider: "google", id: m.name.replace(/^models\//, "") });
  }
}

async function openAiCompatible(provider: string, base: string, key: string, filter?: (id: string) => boolean) {
  const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) {
    problems.push(`${provider}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    return;
  }
  const body = (await res.json()) as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
  for (const m of body.data ?? []) {
    if (filter && !filter(m.id)) continue;
    const free = m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;
    rows.push({ provider, id: m.id, note: free ? "free tier" : undefined });
  }
}

const g = process.env.JUDGE_FREE_API_KEY;
const groq = process.env.GROQ_API_KEY;
const or = process.env.OPENROUTER_API_KEY;

await Promise.all([
  g ? google(g) : Promise.resolve(problems.push("google: no key")),
  groq ? openAiCompatible("groq", "https://api.groq.com/openai/v1", groq) : Promise.resolve(problems.push("groq: no key")),
  or
    ? openAiCompatible("openrouter", "https://openrouter.ai/api/v1", or, (id) => id.endsWith(":free"))
    : Promise.resolve(problems.push("openrouter: no key")),
]);

for (const provider of ["google", "groq", "openrouter"]) {
  const own = rows.filter((r) => r.provider === provider);
  console.log(`\n${provider} — ${own.length} usable model(s)`);
  for (const r of own.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${r.id}${r.note ? `  [${r.note}]` : ""}`);
  }
}

if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log(`  ${p}`);
}
console.log();
