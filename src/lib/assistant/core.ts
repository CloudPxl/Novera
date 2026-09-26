/**
 * The in-app assistant: prompt, and the validation that makes its output safe to show.
 *
 * It can explain, find and take you somewhere. It can propose exactly one action with a
 * cost — starting a run — and that only becomes real when the person presses a button
 * that submits the same `createRun` action the agent page uses, with every entitlement
 * check intact. It can never attest that an agent may be tested: that statement is the
 * authorisation every report rests on, and a model cannot make it for anyone.
 *
 * Everything the model returns is treated as untrusted. A link must be one of a fixed
 * set of paths built from this workspace's own rows; an agent id must be one of its own
 * agents; a citation must be a published page. Anything else is dropped, so a prompt
 * injected through an agent's name or a document can at most produce a link we allow.
 */

export interface AssistantSnapshot {
  workspace: string;
  funding: string;
  canRun: boolean;
  blockedReason: string | null;
  agents: Array<{ id: string; name: string; host: string; policyVersion: number | null; lastProbe: "ok" | "failed" | "never" }>;
  runs: Array<{ id: string; agent: string; status: string; date: string; passed: number; failed: number; noResult: number }>;
  reports: number;
}

export interface AssistantDoc {
  slug: string;
  title: string;
  body: string;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export type AssistantAction =
  | { type: "navigate"; href: string; label: string }
  | { type: "start_run"; agentId: string; label: string };

export interface AssistantReply {
  reply: string;
  citations: string[];
  actions: AssistantAction[];
}

export const MESSAGE_MAX = 1000;
export const HISTORY_TURNS = 6;
const REPLY_MAX = 2000;
const LABEL_MAX = 60;

export const ASSISTANT_SYSTEM = `You are the assistant inside Novera, a product that tests an AI support agent the customer is authorised to test against a versioned suite of scenarios, grades every reply against the customer's written policy, and seals a dated report with pass, fail, and "no result" counted separately.

You help the signed-in person use Novera. You know three things and nothing else:
1. WORKSPACE — a snapshot of their agents, runs and funding. Use its numbers exactly; never estimate or invent one.
2. DOCS — published documentation pages. Cite a page by its slug when you rely on it.
3. The conversation so far.

Rules:
- If the answer is not in WORKSPACE or DOCS, say so plainly and suggest the support page. Do not guess.
- Novera is evidence of testing, not certification. Never say an agent is certified, compliant, safe or guaranteed.
- You cannot change settings, keys, policies or verdicts, and you cannot declare that an agent may be tested — the person does that themselves on the connect page. Say so when asked.
- You may offer actions, which appear as buttons the person presses:
  - {"type":"navigate","href":"<path>","label":"<short label>"} — only paths from ALLOWED_PATHS.
  - {"type":"start_run","agentId":"<id>"} — only for an agent in WORKSPACE that has a policy, and only when WORKSPACE says a run can start. It uses one run of their allowance; say so.
- Be brief: at most three short paragraphs, plain text, no markdown headings.

Reply with one JSON object and nothing else:
{"reply":"...","citations":["slug"],"actions":[...]}`;

/**
 * The pages worth sending, by plain word overlap with the question. The whole corpus is
 * ~5k tokens and a free-tier Groq key allows 8k a minute; three relevant pages are
 * enough to ground an answer and leave room for the next question.
 */
export function pickDocs(question: string, docs: AssistantDoc[], count = 3): AssistantDoc[] {
  const words = new Set(
    question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
  );
  const scored = docs.map((d) => {
    const text = `${d.title} ${d.body}`.toLowerCase();
    let score = 0;
    for (const w of words) if (text.includes(w)) score += d.title.toLowerCase().includes(w) ? 3 : 1;
    return { d, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, count).map((s) => s.d);
}

export function allowedPaths(snapshot: AssistantSnapshot, docs: AssistantDoc[]): string[] {
  return [
    "/dashboard", "/agents/new", "/scenarios", "/settings", "/guide", "/docs", "/support",
    ...snapshot.agents.map((a) => `/agents/${a.id}`),
    ...snapshot.runs.map((r) => `/runs/${r.id}`),
    ...docs.map((d) => `/docs/${d.slug}`),
  ];
}

export function buildMessages(args: {
  snapshot: AssistantSnapshot;
  docs: AssistantDoc[];
  allDocs: AssistantDoc[];
  history: AssistantTurn[];
  message: string;
}): AssistantTurn[] {
  const { snapshot, docs, allDocs, history, message } = args;
  const context = [
    `WORKSPACE:\n${JSON.stringify(snapshot)}`,
    `ALLOWED_PATHS: ${allowedPaths(snapshot, allDocs).join(", ")}`,
    `DOCS:\n${docs.map((d) => `--- slug: ${d.slug}\ntitle: ${d.title}\n\n${d.body}`).join("\n\n")}`,
  ].join("\n\n");

  const recent = history.slice(-HISTORY_TURNS).map((t) => ({
    role: t.role,
    content: t.content.slice(0, REPLY_MAX),
  }));
  return [
    { role: "user", content: `${context}\n\n(Context above. The conversation follows.)` },
    { role: "assistant", content: "Understood." },
    ...recent,
    { role: "user", content: message.slice(0, MESSAGE_MAX) },
  ];
}

/** The model's JSON, reduced to what may be shown. Null when nothing usable came back. */
export function parseReply(
  raw: Record<string, unknown> | null,
  snapshot: AssistantSnapshot,
  allDocs: AssistantDoc[],
): AssistantReply | null {
  if (!raw) return null;
  // Rendered as plain text, so markdown emphasis would show as literal asterisks. Only
  // paired asterisks at word boundaries are removed — underscores are left alone, since
  // a snake_case id is exactly what a reply may quote.
  const reply = typeof raw.reply === "string"
    ? raw.reply.replace(/(?<![\w*])(\*\*|\*)(?=\S)([^*\n]+?)(?<=\S)\1(?![\w*])/g, "$2").replace(/^#{1,6}\s+/gm, "").trim().slice(0, REPLY_MAX)
    : "";
  if (!reply) return null;

  const slugs = new Set(allDocs.map((d) => d.slug));
  const citations = Array.isArray(raw.citations)
    ? [...new Set(raw.citations.filter((c): c is string => typeof c === "string" && slugs.has(c)))]
    : [];

  const paths = new Set(allowedPaths(snapshot, allDocs));
  const actions: AssistantAction[] = [];
  for (const a of Array.isArray(raw.actions) ? raw.actions.slice(0, 4) : []) {
    if (!a || typeof a !== "object") continue;
    const action = a as Record<string, unknown>;
    if (action.type === "navigate" && typeof action.href === "string" && paths.has(action.href)) {
      const label = typeof action.label === "string" && action.label.trim()
        ? action.label.trim().slice(0, LABEL_MAX)
        : "Open";
      actions.push({ type: "navigate", href: action.href, label });
    }
    if (action.type === "start_run" && typeof action.agentId === "string" && snapshot.canRun) {
      const agent = snapshot.agents.find((x) => x.id === action.agentId && x.policyVersion !== null);
      // The label is ours, not the model's: a button that spends a run says exactly that.
      if (agent) actions.push({ type: "start_run", agentId: agent.id, label: `Run the suite on ${agent.name}` });
    }
  }
  return { reply, citations, actions };
}

/**
 * Key-shaped text in a question. Looser than the report's guard on purpose: a question
 * goes to a third-party model, and the panel promises keys are never sent — so anything
 * that looks like one is refused before a request is made, with a pointer to Settings.
 */
const SECRET_SHAPES: RegExp[] = [
  /\b(?:sk|gsk|pk|rk)[-_][A-Za-z0-9_-]{6,}/i,
  /\bsk-or-[A-Za-z0-9_-]{6,}/i,
  /\bAIza[A-Za-z0-9_-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_SHAPES.some((re) => re.test(text));
}

export const SECRET_REFUSAL =
  "That looks like an API key, so it was not sent anywhere. Keys belong in Settings, where they are encrypted and never shown again — not in a chat.";
