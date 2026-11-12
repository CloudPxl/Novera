import { looksLikeCredentialHeader } from "./connection.ts";
import { CUSTOM_PRESET, detectPreset, presetFormValues } from "./presets.ts";

/**
 * Reading a `curl` command from a platform's API documentation into a connection.
 *
 * Every platform shows one, and it already says everything the connect form asks: the address,
 * the headers, and the JSON the endpoint expects. This reads it — it never runs it — and says
 * what it found, so a person checks a filled form instead of translating documentation.
 *
 * Pure and browser-safe, on purpose: the pasted command carries a credential, and it is parsed
 * in the page and never sent anywhere. The credential goes into the form's password field, which
 * is stored encrypted like one typed there.
 */
export interface ParsedCurl {
  method: string;
  url: string;
  headers: Array<[name: string, value: string]>;
  body: string | null;
}

/** Splits a shell command into words: quotes, `$'…'`, backslashes and line continuations. */
export function shellWords(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  const words: string[] = [];
  let word = "";
  let has = false;
  let i = 0;
  const push = () => { if (has) words.push(word); word = ""; has = false; };
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { push(); i++; continue; }
    if (ch === "'" || (ch === "$" && text[i + 1] === "'")) {
      const ansi = ch === "$";
      i += ansi ? 2 : 1;
      has = true;
      while (i < text.length && text[i] !== "'") {
        if (ansi && text[i] === "\\" && i + 1 < text.length) {
          const next = text[i + 1];
          word += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
          i += 2;
        } else {
          word += text[i++];
        }
      }
      i++;
      continue;
    }
    if (ch === '"') {
      i++;
      has = true;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length && /["\\$`\n]/.test(text[i + 1])) { word += text[i + 1]; i += 2; }
        else word += text[i++];
      }
      i++;
      continue;
    }
    if (ch === "\\" && i + 1 < text.length) { word += text[i + 1]; has = true; i += 2; continue; }
    word += ch;
    has = true;
    i++;
  }
  push();
  return words;
}

const DATA_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--json"]);
/** Flags that take a value Novera has no use for; the value is skipped with the flag. */
const VALUE_FLAGS = new Set([
  "-A", "--user-agent", "-e", "--referer", "-o", "--output", "-m", "--max-time", "--connect-timeout", "--retry",
  "-x", "--proxy", "--cacert", "--cert", "--key", "-w", "--write-out", "-b", "--cookie", "-c", "--cookie-jar", "--compressed-ssh",
]);

export function parseCurl(command: string): ParsedCurl | { error: string } {
  const words = shellWords(command.trim());
  const start = words.findIndex((w) => /(^|\/)curl(\.exe)?$/i.test(w));
  if (start < 0) return { error: "That does not look like a curl command. Paste the whole command, starting with curl." };
  let method = "";
  let url = "";
  const headers: Array<[string, string]> = [];
  const data: string[] = [];
  for (let i = start + 1; i < words.length; i++) {
    const w = words[i];
    const next = () => words[++i] ?? "";
    if (w === "-X" || w === "--request") method = next().toUpperCase();
    else if (w.startsWith("-X") && w.length > 2) method = w.slice(2).toUpperCase();
    else if (w === "-H" || w === "--header") {
      const line = next();
      const colon = line.indexOf(":");
      if (colon > 0) headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
    } else if (DATA_FLAGS.has(w)) {
      data.push(next());
      if (w === "--json" && !headers.some(([n]) => n.toLowerCase() === "content-type")) headers.push(["content-type", "application/json"]);
    } else if (w === "-u" || w === "--user") {
      const pair = next();
      headers.push(["authorization", `Basic ${typeof btoa === "function" ? btoa(pair) : Buffer.from(pair, "utf8").toString("base64")}`]);
    } else if (w === "--url") url = next();
    else if (VALUE_FLAGS.has(w)) next();
    else if (w.startsWith("-")) continue;
    else if (!url) url = w;
  }
  if (!url) return { error: "The command has no address. Paste the whole command, including the URL." };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const body = data.length ? data.join("&") : null;
  return { method: method || (body !== null ? "POST" : "GET"), url, headers, body };
}

/** Keys that carry the customer's message, most specific first. */
const MESSAGE_KEYS = ["query", "question", "chatInput", "input_value", "message", "prompt", "input", "text", "payload", "content"];
const CONVERSATION_KEYS = ["conversation_id", "conversationId", "session_id", "sessionId", "thread_id", "threadId", "chat_id", "chatId"];

function isChatList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((m) => m && typeof m === "object" && !Array.isArray(m)
    && typeof (m as Record<string, unknown>).role === "string" && "content" in (m as Record<string, unknown>));
}

/**
 * The request body as a template: the list of chat messages becomes `{{messages}}`, or the one
 * field that carries the message becomes `{{input}}`, and a conversation or session id becomes
 * `{{conversation_id}}`. Everything else is kept as the documentation wrote it.
 */
export function templateFromBody(body: unknown): { template: Record<string, unknown>; message: string | null; conversation: string | null } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  let message: string | null = null;
  let conversation: string | null = null;

  const chat = (node: unknown, path: string): unknown => {
    if (message || !node || typeof node !== "object" || Array.isArray(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!message && key === "messages" && isChatList(value)) { out[key] = "{{messages}}"; message = `${path}${key}`; }
      else out[key] = chat(value, `${path}${key}.`);
    }
    return out;
  };
  let template = chat(body, "") as Record<string, unknown>;

  if (!message) {
    // Breadth first, so a top-level "query" wins over a "text" nested in some option.
    const queue: Array<{ node: Record<string, unknown>; path: string }> = [{ node: template, path: "" }];
    search: while (queue.length) {
      const { node, path } = queue.shift() as { node: Record<string, unknown>; path: string };
      for (const key of MESSAGE_KEYS) {
        if (typeof node[key] === "string") { node[key] = "{{input}}"; message = `${path}${key}`; break search; }
      }
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === "object" && !Array.isArray(value)) queue.push({ node: value as Record<string, unknown>, path: `${path}${key}.` });
      }
    }
  }

  const walk = (node: Record<string, unknown>, path: string) => {
    for (const [key, value] of Object.entries(node)) {
      if (!conversation && CONVERSATION_KEYS.includes(key) && (typeof value === "string" || value === null)) {
        node[key] = "{{conversation_id}}";
        conversation = `${path}${key}`;
      } else if (value && typeof value === "object" && !Array.isArray(value)) walk(value as Record<string, unknown>, `${path}${key}.`);
    }
  };
  template = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
  walk(template, "");
  return { template, message, conversation };
}

export interface CurlImport {
  /** Field values for the connect form. Only the ones the command settled. */
  values: Partial<Record<"url" | "bodyTemplate" | "responsePath" | "toolActivityPath" | "streamPath" | "conversationIdPath" | "authHeaderName" | "authValue" | "headers" | "preset", string>>;
  /** What was read, in sentences. Never a credential's value. */
  found: string[];
  /** What a person still has to do or check. */
  todo: string[];
}

export function importCurl(command: string): CurlImport | { error: string } {
  const parsed = parseCurl(command);
  if ("error" in parsed) return parsed;
  const values: CurlImport["values"] = { url: parsed.url };
  const found: string[] = [`Address: ${parsed.method} ${parsed.url.split("?")[0]}`];
  const todo: string[] = [];
  if (parsed.method !== "POST") todo.push(`The command uses ${parsed.method}. Novera sends each scenario as a POST with a JSON body; check that the endpoint accepts that.`);

  const preset = detectPreset(parsed.url);
  if (preset && preset.key !== CUSTOM_PRESET) {
    const filled = presetFormValues(preset);
    values.preset = filled.preset;
    values.responsePath = filled.responsePath;
    if (filled.toolActivityPath) values.toolActivityPath = filled.toolActivityPath;
    if (filled.streamPath) values.streamPath = filled.streamPath;
    found.push(`Platform: looks like ${preset.label}, so the reply is read at ${preset.responsePath}.`);
  }

  const others: string[] = [];
  let credentialSet = false;
  for (const [name, value] of parsed.headers) {
    const lower = name.toLowerCase();
    if (["content-type", "content-length", "host", "connection", "transfer-encoding", "accept", "accept-encoding", "user-agent"].includes(lower)) continue;
    if (looksLikeCredentialHeader(name)) {
      if (credentialSet) {
        todo.push(`The command sends a second credential header (${name}). Novera stores one credential per agent; it was left out.`);
        continue;
      }
      values.authHeaderName = lower;
      values.authValue = value;
      credentialSet = true;
      found.push(`Credential: the ${name} header. It was put in the credential field, which is stored encrypted and never shown again.`);
      if (/<[^>]*>|\{[^}]*\}|your[_-]?(api[_-]?)?key|xxx/i.test(value)) todo.push("The credential in the command looks like a placeholder from the documentation. Replace it with your real key.");
    } else {
      others.push(`${name}: ${value}`);
    }
  }
  if (others.length) {
    values.headers = others.join("\n");
    found.push(`Other headers: ${others.map((h) => h.split(":")[0]).join(", ")}.`);
  }

  if (parsed.body !== null) {
    let json: unknown = null;
    try {
      json = JSON.parse(parsed.body);
    } catch {
      json = null;
    }
    const made = templateFromBody(json);
    if (!made) {
      todo.push("The command's body is not a JSON object, so the request body was left as it is. Write it as JSON with {{input}} where the message goes.");
    } else {
      values.bodyTemplate = JSON.stringify(made.template, null, 2);
      if (made.message) {
        found.push(made.template && JSON.stringify(made.template).includes("{{messages}}")
          ? `Message: the chat list at ${made.message} becomes {{messages}} — the conversation so far, ending with the scenario's message.`
          : `Message: the field ${made.message} becomes {{input}}, where each scenario's text goes.`);
      } else {
        todo.push("No field in the body looked like the customer's message. Put {{input}} where the message goes.");
      }
      if (made.conversation) {
        found.push(`Conversation: the field ${made.conversation} becomes {{conversation_id}}.`);
        if (preset?.conversationIdPath) values.conversationIdPath = preset.conversationIdPath;
      } else if (preset?.conversationIdPath && JSON.stringify(preset.bodyTemplate).includes("{{conversation_id}}")) {
        todo.push(`The command carries no conversation id. Add "conversation_id": "{{conversation_id}}" to the request body so conversation scenarios can run.`);
      }
    }
  } else {
    todo.push("The command has no body. Write the request body as JSON with {{input}} where the message goes.");
  }
  return { values, found, todo };
}
