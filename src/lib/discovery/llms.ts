import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = "https://www.nover.space";

interface DocEntry {
  slug: string;
  title: string;
}

/** Every published page in `data/docs`: the slug is the filename, the title is the front matter's. */
export function listDocs(dir = join(process.cwd(), "data/docs")): DocEntry[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .flatMap((f) => {
      const source = readFileSync(join(dir, f), "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? "";
      if (/^published:\s*false\s*$/m.test(front)) return [];
      const title = /^title:\s*(.+?)\s*$/m.exec(front)?.[1]?.replace(/^["']|["']$/g, "");
      const slug = f.replace(/\.md$/, "");
      return [{ slug, title: title || slug }];
    });
}

/** The plain-text index for language models and crawlers (llms.txt convention). */
export function renderLlmsTxt(docs: DocEntry[] = listDocs()): string {
  const lines = [
    "# Novera",
    "",
    "> Novera runs a versioned scenario suite against a customer's live AI support agent and produces a dated, hash-sealed report: per-case evidence mapped to the EU AI Act and GDPR duties the customer already has to document. It is testing evidence, not a certification.",
    "",
    "Scores and counts are computed from stored run rows. Cases that errored or never ran are counted separately and never as passes. Every report states its scope and limitations. Novera tests only agents the customer owns or is authorised to test.",
    "",
    "## Solutions",
    "",
    `- [EU AI Act evidence](${ORIGIN}/solutions/eu-ai-act): what a sealed report can and cannot show for the duties an AI support agent's operator documents`,
    `- [Black-box testing](${ORIGIN}/solutions/black-box-testing): testing an agent through its public interface, without access to its internals`,
    `- [For agencies](${ORIGIN}/solutions/agency): running and delivering reports for several client agents`,
    "",
    "## Documentation",
    "",
    ...docs.map((d) => `- [${d.title}](${ORIGIN}/docs/${d.slug})`),
    "",
    "## API and CI",
    "",
    `- [OpenAPI 3.1 description](${ORIGIN}/api/v1/openapi.json): the public machine-readable description of /api/v1; calls need a workspace API key`,
    `- [The Novera API](${ORIGIN}/docs/api): keys, scopes, endpoints, idempotency, webhooks and MCP`,
    `- [Reports in CI](${ORIGIN}/docs/cli-and-ci): exit codes 0 pass, 1 fail, 2 incomplete, 3 configuration, 4 infrastructure. The novera command line exists but is not yet published as an installable package`,
    "",
    "## Verify a report",
    "",
    `- [Verify a report](${ORIGIN}/verify): check a sealed report's SHA-256 content hash`,
    "",
    "## Limitations",
    "",
    `- [Limitations](${ORIGIN}/docs/limitations): what a report does not establish`,
    "- Novera provides testing evidence, not a certification, a conformity assessment or legal advice.",
    "",
  ];
  return lines.join("\n");
}

