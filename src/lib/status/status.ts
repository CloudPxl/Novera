import committed from "../../../data/status.json" with { type: "json" };

/**
 * The public status page's content: set by a person, never measured.
 *
 * The source is `data/status.json` (committed, so every change is in the history with its
 * author), or `NOVERA_STATUS_JSON` when set — the same shape, for changing the page with an
 * environment variable and a redeploy instead of a commit. Anything that does not parse into
 * exactly this shape is shown as "unknown", never as "operational": a broken status file must
 * not read as good news.
 */

export const STATES = ["operational", "degraded", "maintenance", "unknown"] as const;
export type ComponentState = (typeof STATES)[number];

export const COMPONENTS = [
  { id: "app", name: "Application", description: "Sign-in, the operator pages, shared reports, the API." },
  { id: "grading", name: "Grading providers", description: "The model providers that grade scenarios. A provider outage can stop or slow runs." },
  { id: "email", name: "Email", description: "Sign-up confirmation, password reset, invitations, support replies." },
  { id: "scheduled_jobs", name: "Scheduled jobs", description: "Scheduled runs, webhook retries, and the daily retention passes." },
] as const;
export type ComponentId = (typeof COMPONENTS)[number]["id"];

export interface ComponentStatus {
  id: ComponentId;
  name: string;
  description: string;
  state: ComponentState;
  note: string | null;
}

export interface StatusPage {
  updatedAt: string | null;
  notice: string | null;
  components: ComponentStatus[];
  /** Set when the source could not be read as a status file; every component is then unknown. */
  problem: string | null;
}

const NOTE_LIMIT = 280;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, NOTE_LIMIT) : null;
}

/** Pure: a status page from whatever the source held. */
export function parseStatus(raw: unknown): StatusPage {
  const unknownAll = (problem: string): StatusPage => ({
    updatedAt: null,
    notice: null,
    components: COMPONENTS.map((c) => ({ ...c, state: "unknown", note: null })),
    problem,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unknownAll("The status file is not an object.");
  const source = raw as Record<string, unknown>;
  const updated = typeof source.updated_at === "string" && !Number.isNaN(Date.parse(source.updated_at)) ? new Date(source.updated_at).toISOString() : null;
  if (!updated) return unknownAll("The status file has no valid updated_at.");
  const given = (source.components && typeof source.components === "object" ? source.components : {}) as Record<string, unknown>;

  return {
    updatedAt: updated,
    notice: text(source.notice),
    components: COMPONENTS.map((c) => {
      const entry = given[c.id] as Record<string, unknown> | undefined;
      const state = STATES.includes(entry?.state as ComponentState) ? (entry!.state as ComponentState) : "unknown";
      return { ...c, state, note: text(entry?.note) };
    }),
    problem: null,
  };
}

export function currentStatus(env: Record<string, string | undefined> = process.env): StatusPage {
  if (env.NOVERA_STATUS_JSON) {
    try {
      return parseStatus(JSON.parse(env.NOVERA_STATUS_JSON));
    } catch {
      return parseStatus(null);
    }
  }
  return parseStatus(committed);
}

/** The single sentence at the top: the worst state any component is in. */
export function overall(page: StatusPage): { state: ComponentState; sentence: string } {
  const states = page.components.map((c) => c.state);
  if (states.includes("degraded")) return { state: "degraded", sentence: "Some parts of Novera are degraded." };
  if (states.includes("maintenance")) return { state: "maintenance", sentence: "Some parts of Novera are under maintenance." };
  if (states.every((s) => s === "operational")) return { state: "operational", sentence: "Every component is marked operational." };
  return { state: "unknown", sentence: "The state of some components has not been set." };
}
