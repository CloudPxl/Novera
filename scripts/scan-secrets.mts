/**
 * Looks for credentials in the files git tracks. Run by CI on every push and pull request,
 * and runnable locally before a commit:
 *
 *   node scripts/scan-secrets.mts            every tracked file
 *   node scripts/scan-secrets.mts a.ts b.md  only these files
 *
 * The patterns are the shapes Novera's own configuration and products use — model provider
 * keys, Novera's API keys and webhook secrets, Stripe, Resend, Supabase service keys,
 * private keys, database URLs with a password — at the length a real one has. Test fixtures
 * use short or obviously fake values (`sk-live-abcdef1234567890`, `AKIAABCDEFGHIJKLMNOP`),
 * which these lengths and OBVIOUSLY_FAKE pass; a fixture that has to look real carries
 * `secret-scan: allow` on its line.
 *
 * A finding prints the file, line, rule and a masked excerpt — never the value itself, so
 * the CI log does not become the second place the key leaked.
 *
 * Exit: 0 nothing found; 1 something found.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Rule { name: string; pattern: RegExp }

export const RULES: Rule[] = [
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  // OpenAI (sk-…, sk-proj-…) and Anthropic (sk-ant-…) keys are long; a fixture is not.
  { name: "OpenAI / Anthropic key", pattern: /\bsk-(?:proj-|ant-[a-z0-9]+-|svcacct-)?[A-Za-z0-9_-]{32,}/ },
  { name: "Groq key", pattern: /\bgsk_[A-Za-z0-9]{40,}/ },
  { name: "Google API key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { name: "Novera API key", pattern: /\bnvk_[A-Za-z0-9_-]{43}\b/ },
  { name: "webhook signing secret", pattern: /\bwhsec_[A-Za-z0-9_+/=-]{32,}/ },
  { name: "Stripe secret or restricted key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/ },
  { name: "Resend key", pattern: /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}/ },
  { name: "Supabase secret key", pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{20,}/ },
  // A connection string with a password that is not a placeholder.
  { name: "database URL with password", pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:(?!\[|<|\$\{|\*|postgres@|password@|PASSWORD|YOUR)[^\s@/]{8,}@(?!127\.0\.0\.1|localhost)/ },
];

/** A JWT whose payload says it is a service role: anything holding it bypasses RLS. */
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{20,}/g;

/** Supabase's local-development keys, signed with the published demo secret. Not secrets. */
function isLocalDemoJwt(payload: Record<string, unknown>): boolean {
  return payload.iss === "supabase-demo";
}

export interface Finding { file: string; line: number; rule: string; excerpt: string }

const ALLOW = "secret-scan: allow";

/**
 * A value that says it is fake, or that contains a run no random generator produces: an
 * alphabet or digit sequence. Every fixture in the repository is one of these; a real
 * key containing "abcdefghij" in order is a one-in-10^17 event.
 */
const OBVIOUSLY_FAKE = /not-a-real|canary|fake|dummy|example|placeholder|abcdefghij|ABCDEFGHIJ|0123456789|x{8,}|X{8,}/;

function mask(value: string): string {
  return value.length <= 8 ? "****" : `${value.slice(0, 6)}…(${value.length} chars)`;
}

export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  lines.forEach((content, index) => {
    if (content.includes(ALLOW)) return;
    for (const rule of RULES) {
      const match = content.match(rule.pattern);
      if (match && !OBVIOUSLY_FAKE.test(match[0])) findings.push({ file, line: index + 1, rule: rule.name, excerpt: mask(match[0]) });
    }
    for (const match of content.matchAll(JWT)) {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { continue; }
      if (payload.role === "service_role" && !isLocalDemoJwt(payload)) {
        findings.push({ file, line: index + 1, rule: "Supabase service_role JWT", excerpt: mask(match[0]) });
      }
    }
  });
  return findings;
}

/** Lockfiles carry integrity hashes; images and fonts are not text. */
const SKIP = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz)$/i;

function isMain(): boolean {
  return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMain()) {
  const explicit = process.argv.slice(2);
  const files = explicit.length
    ? explicit
    : execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

  const findings: Finding[] = [];
  let scanned = 0;
  for (const file of files) {
    if (SKIP.test(file)) continue;
    let size = 0;
    try { size = statSync(file).size; } catch { continue; }
    if (size > 2_000_000) continue;
    findings.push(...scanText(file, readFileSync(file, "utf8")));
    scanned++;
  }

  if (findings.length) {
    for (const f of findings) console.error(` FAIL  ${f.file}:${f.line}  ${f.rule}  ${f.excerpt}`);
    console.error(`\n${findings.length} possible credential(s) in ${scanned} files. Remove and rotate any real one; a fixture that must look real carries "${ALLOW}" on its line.\n`);
    process.exit(1);
  }
  console.log(`No credential shapes found in ${scanned} tracked files.`);
}
