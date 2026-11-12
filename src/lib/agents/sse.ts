import { replyText } from "./template.ts";

/**
 * Reading a reply that arrives as a stream of server-sent events.
 *
 * Many agent platforms answer `text/event-stream` — some only that way — and send the reply in
 * pieces, one JSON object per event. Novera reads the whole stream (under the same deadline and
 * size limit as any reply) and puts the pieces back together in the order they arrived: that is
 * the text a customer's chat window would have shown when the stream ended.
 *
 * Pure. Nothing is guessed per run: the paths tried are the agent's stored ones.
 *
 * Two events change what the customer ends up seeing, and are honoured wherever an event names
 * itself that way (`event` in the JSON, or the SSE `event:` line):
 *  - `message_replace`: the platform withdrew what it had streamed and substituted this text
 *    (an output moderation filter). The reply is the substitute, not both.
 *  - `error`: the stream ended in an error. There is no reply; the error is reported as one.
 */
export interface StreamEvent {
  /** The SSE `event:` line, when the block has one. */
  name: string | null;
  /** The parsed `data:` JSON; null when the data is not JSON. */
  data: unknown;
}

export interface AssembledStream {
  /** The reply as it stood when the stream ended; null when no event carried text. */
  text: string | null;
  events: StreamEvent[];
  /** How many events carried a piece of the reply. */
  pieces: number;
  /** The path that matched, so a person can see where the text was read. */
  matchedPath: string | null;
  /** Set when the stream reported an error of its own. */
  error: string | null;
}

/** Whether a body is an event stream, by its content type or by how it begins. */
export function looksLikeEventStream(contentType: string | null, body: string): boolean {
  if (contentType && /^text\/event-stream\b/i.test(contentType.trim())) return true;
  return /^(?:﻿)?(?::[^\n]*\r?\n)*(?:event|data):/.test(body);
}

export function parseEventStream(body: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const block of body.replace(/^﻿/, "").split(/\r?\n\r?\n/)) {
    let name: string | null = null;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") name = value;
      else if (field === "data") data.push(value);
    }
    if (!data.length) continue;
    const text = data.join("\n");
    // The end marker chat-completion streams send; it carries nothing.
    if (text.trim() === "[DONE]") continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    events.push({ name, data: parsed });
  }
  return events;
}

function eventKind(event: StreamEvent): string | null {
  const own = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? (event.data as Record<string, unknown>).event
    : null;
  return typeof own === "string" ? own : event.name;
}

function errorText(data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const message = typeof d.message === "string" ? d.message : typeof d.error === "string" ? d.error : null;
  const code = typeof d.code === "string" || typeof d.code === "number" ? String(d.code) : null;
  const said = [code, message].filter(Boolean).join(": ").replace(/\s+/g, " ").slice(0, 300);
  return said ? `The agent's stream ended with an error (${said}).` : "The agent's stream ended with an error.";
}

/**
 * The paths a piece of the reply may sit at inside one event, in the order tried: the agent's
 * stream path if it has one, its reply path, and the streaming spelling of a chat-completion
 * path (`choices.0.message.content` arrives as `choices.0.delta.content`).
 */
export function streamPaths(responsePath: string, streamPath?: string | null): string[] {
  const out = [streamPath ?? "", responsePath, responsePath.replace(/(^|\.)message\./, "$1delta.")];
  return [...new Set(out.filter((p) => p && p !== "$text"))];
}

export function assembleEventStream(body: string, paths: readonly string[]): AssembledStream {
  const events = parseEventStream(body);
  let text = "";
  let pieces = 0;
  let matchedPath: string | null = null;
  for (const event of events) {
    const kind = eventKind(event);
    if (kind === "error") return { text: null, events, pieces, matchedPath, error: errorText(event.data) };
    if (event.data === null || typeof event.data !== "object") continue;
    let piece: string | undefined;
    let at: string | null = null;
    for (const path of paths) {
      piece = replyText(event.data, path);
      if (piece !== undefined) { at = path; break; }
    }
    if (piece === undefined) continue;
    if (kind === "message_replace") text = piece;
    else text += piece;
    pieces++;
    matchedPath = matchedPath ?? at;
  }
  return { text: pieces ? text : null, events, pieces, matchedPath, error: null };
}

/** The first value at a path in any event, in order: a conversation id, say. */
export function firstInStream(events: readonly StreamEvent[], path: string): unknown {
  for (const event of events) {
    const value = event.data && typeof event.data === "object" ? replyText(event.data, path) : undefined;
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}
