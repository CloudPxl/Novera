import type { HttpAgentConfig } from "./types.ts";

/**
 * Reading and checking an HTTP agent's connection as a person typed it — on connecting
 * and on editing — so the two forms cannot accept different things.
 *
 * Pure: no network, no database. The address check (`assertPublicUrl`) and the probe
 * happen in the server action, after this has said the form makes sense.
 */

/** The placeholders `httpAgent` fills. Anything else would be sent to the agent literally. */
export const BODY_PLACEHOLDERS = ["input", "policy", "context", "history", "conversation_id"] as const;

export const DEFAULT_BODY_TEMPLATE = '{"message":"{{input}}"}';

/** A request template is a few lines of JSON; past this it is a pasted file. */
export const MAX_BODY_TEMPLATE_CHARS = 10_000;
export const MAX_AGENT_NAME = 120;
export const MAX_PATH_CHARS = 200;
/** Below this a message is not sent at all (`MIN_AGENT_WAIT_MS` in http.ts). */
export const MIN_TIMEOUT_SECONDS = 2;
/** `AGENT_TIMEOUT_MAX_MS` in http.ts, in seconds; not imported, so a client form can read it. tests/agent-connection.test.ts holds the two equal. */
export const MAX_TIMEOUT_SECONDS = 30;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A request body template: a JSON object carrying `{{input}}`, and no placeholder Novera
 * does not fill. A misspelt `{{message}}` used to be sent to the agent as those eleven
 * characters, on every scenario of every run.
 */
export function parseBodyTemplate(raw: string): Parsed<Record<string, unknown>> {
  const text = raw.trim();
  if (text.length > MAX_BODY_TEMPLATE_CHARS) {
    return { ok: false, error: `The request body is longer than ${MAX_BODY_TEMPLATE_CHARS.toLocaleString("en-GB")} characters. It is a template, not a payload.` };
  }
  let template: unknown;
  try {
    template = JSON.parse(text);
  } catch {
    template = null;
  }
  if (typeof template !== "object" || template === null || Array.isArray(template)) {
    return { ok: false, error: "The request body must be a JSON object, for example {\"message\": \"{{input}}\"}." };
  }
  const serialised = JSON.stringify(template);
  if (!serialised.includes("{{input}}")) {
    return { ok: false, error: "The request body needs {{input}} somewhere, so we know where to put the scenario." };
  }
  const unknown = [...new Set([...serialised.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))]
    .filter((name) => !(BODY_PLACEHOLDERS as readonly string[]).includes(name));
  if (unknown.length) {
    return {
      ok: false,
      error: `Novera does not fill ${unknown.map((n) => `{{${n}}}`).join(", ")}, so it would be sent to your agent as written. `
        + `The placeholders are ${BODY_PLACEHOLDERS.map((n) => `{{${n}}}`).join(", ")}.`,
    };
  }
  return { ok: true, value: template as Record<string, unknown> };
}

/** A dot path into the agent's JSON reply: "reply", "choices.0.message.content". */
function validPath(path: string): boolean {
  return path.length <= MAX_PATH_CHARS && /^[\w-]+(\.[\w-]+)*$/.test(path);
}

/** An HTTP header name (RFC 9110 token). The credential travels in it. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;
/** Headers the request sets itself; a credential there would replace or break them. */
const RESERVED_HEADERS = new Set(["content-type", "content-length", "host", "connection", "transfer-encoding"]);

export type CredentialChange = "keep" | "replace" | "remove";

export interface ConnectionEdit {
  name: string;
  url: string;
  bodyTemplate: Record<string, unknown>;
  responsePath: string;
  toolActivityPath: string | null;
  /** Seconds; null is the default (the longest Novera waits). */
  timeoutSeconds: number | null;
  authHeaderName: string | null;
  credential: CredentialChange;
  /** Present only when `credential` is "replace". Never echoed anywhere. */
  newCredential?: string;
}

/** The fields that say how Novera reaches an agent, as both forms and the API carry them. */
export interface EndpointFields {
  url: string;
  bodyTemplate: Record<string, unknown>;
  responsePath: string;
  toolActivityPath: string | null;
  /** Seconds; null is the default (the longest Novera waits). */
  timeoutSeconds: number | null;
  authHeaderName: string | null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Address, request and reply format, timeout and header name, read and checked. Shared by
 * connecting, editing and testing a connection, so none of them can accept what another
 * refuses. Pure: the address's resolution is checked by the caller (`assertPublicUrl`).
 */
/** The longest endpoint URL an agent or a connection test accepts. */
export const MAX_ENDPOINT_URL = 2048;

export function parseEndpointFields(fields: {
  url: unknown; bodyTemplate: unknown; responsePath: unknown; toolActivityPath: unknown;
  timeoutSeconds?: unknown; authHeaderName: unknown;
}): Parsed<EndpointFields> {
  const url = str(fields.url).trim();
  const responsePath = str(fields.responsePath).trim();
  const toolActivityPath = str(fields.toolActivityPath).trim();
  const timeoutRaw = str(fields.timeoutSeconds).trim();
  const authHeaderName = str(fields.authHeaderName).trim();

  if (!url) return { ok: false, error: "Enter the agent's endpoint URL." };
  // Far above any real endpoint; an address this long is a mistake or a probe, and it is stored,
  // shown and sent on every request.
  if (url.length > MAX_ENDPOINT_URL) return { ok: false, error: `The endpoint URL is longer than ${MAX_ENDPOINT_URL} characters.` };
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: "That endpoint URL is not valid." };
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { ok: false, error: "The endpoint must be an http or https address." };
  }
  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: "Put a credential in the auth header, not in the address: the address's host is quoted on reports." };
  }

  const body = parseBodyTemplate(str(fields.bodyTemplate) || DEFAULT_BODY_TEMPLATE);
  if (!body.ok) return body;

  if (!responsePath) return { ok: false, error: "Tell us where the reply text sits in the response." };
  if (!validPath(responsePath)) return { ok: false, error: "The reply path is a dot path such as reply or choices.0.message.content." };
  if (toolActivityPath && !validPath(toolActivityPath)) {
    return { ok: false, error: "The tool activity path is a dot path such as tool_calls or data.actions." };
  }

  let timeoutSeconds: number | null = null;
  if (timeoutRaw) {
    const n = Number(timeoutRaw);
    if (!Number.isInteger(n) || n < MIN_TIMEOUT_SECONDS || n > MAX_TIMEOUT_SECONDS) {
      return { ok: false, error: `The timeout is a whole number of seconds from ${MIN_TIMEOUT_SECONDS} to ${MAX_TIMEOUT_SECONDS}. A run works in slices, so Novera never waits longer.` };
    }
    timeoutSeconds = n;
  }

  if (authHeaderName && (!HEADER_NAME.test(authHeaderName) || RESERVED_HEADERS.has(authHeaderName.toLowerCase()))) {
    return { ok: false, error: "That is not a header Novera can put a credential in. Use a name such as authorization or x-api-key." };
  }

  return {
    ok: true,
    value: {
      url, bodyTemplate: body.value, responsePath, toolActivityPath: toolActivityPath || null,
      timeoutSeconds, authHeaderName: authHeaderName || null,
    },
  };
}

/**
 * A credential as pasted: one line, and not the length of a file. It travels in an HTTP header,
 * so it is plain ASCII: a control character or a typographic dash cannot be sent at all, and
 * was accepted here only to fail every request afterwards as "could not reach the endpoint"
 * (audit 2026-10-17).
 */
export function credentialProblem(credential: string): string | null {
  if (credential.length > 4_000 || /[\r\n]/.test(credential)) return "A credential is one line, and not this long — check what was pasted.";
  if (/[^\t\x20-\x7e]/.test(credential)) {
    return "A credential is sent in an HTTP header, so it can hold only plain ASCII characters — check for a pasted control character, accent or typographic dash.";
  }
  return null;
}

/** A new agent's configuration from checked fields. */
export function newHttpConfig(fields: EndpointFields): HttpAgentConfig {
  return {
    kind: "http",
    url: fields.url,
    bodyTemplate: fields.bodyTemplate,
    responsePath: fields.responsePath,
    ...(fields.toolActivityPath ? { toolActivityPath: fields.toolActivityPath } : {}),
    ...(fields.timeoutSeconds !== null ? { timeoutMs: fields.timeoutSeconds * 1000 } : {}),
    ...(fields.authHeaderName ? { authHeaderName: fields.authHeaderName } : {}),
  };
}

/**
 * The edit form, read and checked. `hasStoredCredential` decides whether a header name
 * may be left with nothing to send, or a credential with nowhere to go.
 */
export function parseConnectionEdit(fields: {
  name: unknown; url: unknown; bodyTemplate: unknown; responsePath: unknown; toolActivityPath: unknown;
  timeoutSeconds: unknown; authHeaderName: unknown; credential: unknown; removeCredential: unknown;
}, hasStoredCredential: boolean, currentUrl?: string): Parsed<ConnectionEdit> {
  const name = str(fields.name).trim();
  const credential = str(fields.credential);
  const remove = fields.removeCredential === "on";

  if (!name) return { ok: false, error: "Give the agent a name." };
  if (name.length > MAX_AGENT_NAME || /[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: `The name must be at most ${MAX_AGENT_NAME} printable characters.` };
  }
  const endpoint = parseEndpointFields(fields);
  if (!endpoint.ok) return endpoint;
  const { url, authHeaderName } = endpoint.value;
  const parsedUrl = new URL(url);

  if (remove && credential) return { ok: false, error: "Either paste a new credential or remove the stored one, not both." };
  const change: CredentialChange = remove ? "remove" : credential ? "replace" : "keep";
  if (change === "replace") {
    if (!authHeaderName) return { ok: false, error: "Name the header the credential goes in." };
    const problem = credentialProblem(credential);
    if (problem) return { ok: false, error: problem };
  }
  // A stored credential was given for one host. Moving the address to another would send it
  // there on the next check, by whoever may edit agents, though nobody can read it back
  // (security audit, 2026-10-11): a new host needs the credential pasted again, or removed.
  if (change === "keep" && hasStoredCredential && currentUrl && originOf(currentUrl) !== parsedUrl.origin) {
    return { ok: false, error: "The address moves to a different host, and the stored credential was given for the old one. Paste the credential for the new host, or tick “Remove the stored credential”." };
  }
  if (change === "keep" && hasStoredCredential && !authHeaderName) {
    return { ok: false, error: "A credential is stored, so it needs a header name. Name the header, or tick “Remove the stored credential”." };
  }

  return {
    ok: true,
    value: {
      name, ...endpoint.value, credential: change,
      ...(change === "replace" ? { newCredential: credential } : {}),
    },
  };
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The agent's next configuration. Starts from the stored one, so a field this form does
 * not show — a method, fixed headers — is kept rather than dropped.
 */
export function nextHttpConfig(current: HttpAgentConfig, edit: ConnectionEdit): HttpAgentConfig {
  const next: HttpAgentConfig = {
    ...current,
    kind: "http",
    url: edit.url,
    bodyTemplate: edit.bodyTemplate,
    responsePath: edit.responsePath,
  };
  if (edit.toolActivityPath) next.toolActivityPath = edit.toolActivityPath;
  else delete next.toolActivityPath;
  if (edit.timeoutSeconds !== null) next.timeoutMs = edit.timeoutSeconds * 1000;
  else delete next.timeoutMs;
  if (edit.authHeaderName && edit.credential !== "remove") next.authHeaderName = edit.authHeaderName;
  else delete next.authHeaderName;
  return next;
}

/** Field names, as an audit line names them. Never a value. */
export type ChangedField =
  | "name" | "url" | "bodyTemplate" | "responsePath" | "toolActivityPath" | "timeout" | "authHeaderName" | "credential";

/** Order-insensitive JSON equality, enough for a template a person edits. */
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/**
 * What an edit changed, by name only. The audit trail is read by auditors and kept as
 * long as the workspace: an address, a template or a credential has no place in it.
 */
export function changedConnectionFields(
  before: { name: string; config: HttpAgentConfig },
  after: { name: string; config: HttpAgentConfig },
  credential: CredentialChange,
): ChangedField[] {
  const out: ChangedField[] = [];
  const b = before.config;
  const a = after.config;
  if (before.name !== after.name) out.push("name");
  if (b.url !== a.url) out.push("url");
  if (!sameJson(b.bodyTemplate, a.bodyTemplate)) out.push("bodyTemplate");
  if (b.responsePath !== a.responsePath) out.push("responsePath");
  if ((b.toolActivityPath ?? null) !== (a.toolActivityPath ?? null)) out.push("toolActivityPath");
  if ((b.timeoutMs ?? null) !== (a.timeoutMs ?? null)) out.push("timeout");
  if ((b.authHeaderName ?? null) !== (a.authHeaderName ?? null)) out.push("authHeaderName");
  if (credential !== "keep") out.push("credential");
  return out;
}

/** Whether a change reaches the agent: anything but the name. */
export function touchesConnection(fields: readonly ChangedField[]): boolean {
  return fields.some((f) => f !== "name");
}

/** What the archive form must be given: the agent's name, exactly, ignoring surrounding space. */
export function archiveConfirmed(agentName: string, typed: unknown): boolean {
  return typeof typed === "string" && typed.trim() === agentName.trim() && agentName.trim() !== "";
}
