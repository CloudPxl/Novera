import { replyText } from "./template.ts";
import { WHOLE_BODY_PATH } from "./delivery.ts";
import { isLimitSignal, platformSaid, readUpstreamError, upstreamQuote, type UpstreamError } from "./upstream-error.ts";

/**
 * Reading a reply that arrives in pieces: server-sent events, JSON lines, or a text stream.
 *
 * Many agent platforms answer `text/event-stream` — some only that way — and send the reply in
 * pieces, one JSON object per event. Novera reads the whole stream (under the same deadline and
 * size limit as any reply) and puts the pieces back together in the order they arrived: that is
 * the text a customer's chat window would have shown when the stream ended.
 *
 * Pure. Nothing is guessed per run: the paths tried are the agent's stored ones, and how pieces
 * combine is the connection's stored `streamMode`. The one fixed list here is where a platform's
 * own *final* event carries the whole answer (`workflow_finished.data.outputs.answer`,
 * `response.completed`'s output text); it is read only when no piece arrived, so a reply is never
 * counted twice.
 *
 * Events that change what the customer ends up seeing are honoured wherever an event names
 * itself that way (`event` or `type` in the JSON, or the SSE `event:` line):
 *  - `message_replace`: the platform withdrew what it had streamed and substituted this text
 *    (an output moderation filter). The reply is the substitute, not both.
 *  - `error`, `response.failed`, a failed `workflow_finished`, or an event that is only an
 *    `{error: {…}}` object: the stream ended in an error. There is no reply, even if pieces came
 *    before it — a reply cut off by an error is not what the agent would have said — and what the
 *    platform said is quoted in the error.
 *  - `message_end`, `workflow_finished`, `response.completed`, `message_stop`: the stream finished
 *    normally. A finished stream with no text is an empty reply (the agent said nothing), which is
 *    a different fact from a stream whose text is somewhere the connection does not read.
 */
export interface StreamEvent {
  /** The SSE `event:` line, when the block has one. */
  name: string | null;
  /** The parsed `data:` JSON; null when the data is not JSON. */
  data: unknown;
  /** The `data:` text as sent, for a stream that carries plain text. */
  raw: string;
}

export interface AssembledStream {
  /** The reply as it stood when the stream ended; null when no event carried text. */
  text: string | null;
  events: StreamEvent[];
  /** How many events carried a piece of the reply. */
  pieces: number;
  /** The path that matched, so a person can see where the text was read. */
  matchedPath: string | null;
  /** Set when the stream reported an error of its own: the sentence stored with the case. */
  error: string | null;
  /** What the platform said in its error event, when it said anything. */
  upstream: UpstreamError | null;
  /** The error is a limit on how much or how fast (rate, quota, concurrency). */
  limit: boolean;
  /** The stream said it was done. */
  finished: boolean;
  /** Every piece began with the whole text before it: the platform sends the text so far. */
  cumulative: boolean;
  /** How many events of each kind arrived, for the connection check. */
  eventKinds: Record<string, number>;
  /** A step the platform reported as failed without ending the stream, quoted when no text came. */
  failedStep: string | null;
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
    events.push({ name, data: parsed, raw: text });
  }
  return events;
}

/** JSON lines (`application/x-ndjson`, `application/jsonl`): one JSON value per line, read as events. */
export function looksLikeJsonLines(contentType: string | null, body: string): boolean {
  if (contentType && /\b(x-ndjson|jsonl|json-seq|x-jsonlines)\b/i.test(contentType)) return true;
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.every((l) => {
    if (!l.startsWith("{")) return false;
    try {
      JSON.parse(l);
      return true;
    } catch {
      return false;
    }
  });
}

export function parseJsonLines(body: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of body.replace(/\u001e/g, "\n").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    let data: unknown = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    events.push({ name: null, data, raw });
  }
  return events;
}

/**
 * The text stream of the AI SDK's older data protocol: one `<code>:<json>` line per part, where
 * `0:` is a piece of text, `3:` an error, `d:`/`e:` the end. Recognised by its header, or by every
 * line having that shape with at least one text part — never inferred from a single line.
 */
export function looksLikeTextStreamProtocol(contentType: string | null, body: string, header?: string | null): boolean {
  if (header && /^v1$/i.test(header.trim())) return true;
  if (contentType && !/^text\/plain\b/i.test(contentType)) return false;
  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  return lines.length > 0 && lines.every((l) => /^[0-9a-z]:/.test(l)) && lines.some((l) => /^0:"/.test(l));
}

export function parseTextStreamProtocol(body: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^([0-9a-z]):(.*)$/.exec(line);
    if (!m) continue;
    let data: unknown = null;
    try {
      data = JSON.parse(m[2]);
    } catch {
      data = null;
    }
    const name = m[1] === "0" ? "text" : m[1] === "3" ? "error" : m[1] === "d" || m[1] === "e" ? "finish" : `part_${m[1]}`;
    // A text part is a bare JSON string; an error part a string message.
    events.push({ name, data: name === "error" && typeof data === "string" ? { message: data } : data, raw: m[2] });
  }
  return events;
}

/** Where the paths for a text-stream part live: the part itself. */
export const TEXT_PART_PATH = "$part";

function eventKind(event: StreamEvent): string | null {
  const d = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? (event.data as Record<string, unknown>) : null;
  const own = d ? (typeof d.event === "string" ? d.event : typeof d.type === "string" ? d.type : null) : null;
  return own ?? event.name;
}

const ERROR_KINDS = new Set(["error", "response.failed", "response.error"]);
const FINISH_KINDS = new Set(["message_end", "workflow_finished", "response.completed", "message_stop", "finish", "done", "end", "completed"]);

/** Where a platform's final event carries the whole answer. Read only when no piece arrived. */
const FINAL_PATHS = [
  "data.outputs.answer", "data.outputs.text", "data.outputs.output", "data.outputs.result",
  "response.output_text", "response.output.*.content.*.text",
];

/**
 * The paths a piece of the reply may sit at inside one event, in the order tried: the agent's
 * stream path if it has one, its reply path, and the streaming spelling of a chat-completion
 * path (`choices.0.message.content` arrives as `choices.0.delta.content`).
 */
export function streamPaths(responsePath: string, streamPath?: string | null): string[] {
  const out = [streamPath ?? "", responsePath, responsePath.replace(/(^|\.)message\./, "$1delta.")];
  return [...new Set(out.filter((p) => p && p !== WHOLE_BODY_PATH))];
}

function pieceOf(event: StreamEvent, paths: readonly string[], plain: boolean): { piece: string; at: string } | null {
  if (event.name === "text" && typeof event.data === "string") return { piece: event.data, at: TEXT_PART_PATH };
  if (plain) {
    if (typeof event.data === "string") return { piece: event.data, at: WHOLE_BODY_PATH };
    if (event.data === null) return { piece: event.raw, at: WHOLE_BODY_PATH };
  }
  if (event.data === null || typeof event.data !== "object") return null;
  for (const path of paths) {
    const piece = replyText(event.data, path);
    if (piece !== undefined) return { piece, at: path };
  }
  return null;
}

/** Field names that hold words in the platforms Novera reads; ids, kinds and titles do not count. */
const TEXT_FIELDS = /^(answer|text|content|message|output|outputs|reply|delta|result|response)$/i;

/** Whether an event carries non-empty words in a text-named field, a few levels deep. */
function carriesText(value: unknown, depth: number): boolean {
  if (depth > 5 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => carriesText(v, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([k, v]) =>
    (TEXT_FIELDS.test(k) && typeof v === "string" && v.trim() !== "") || carriesText(v, depth + 1));
}

/** Whether the pieces are the whole text so far each time, rather than the next part of it. */
export function isCumulative(pieces: readonly string[]): boolean {
  const real = pieces.filter((p) => p !== "");
  if (real.length < 2) return false;
  for (let i = 1; i < real.length; i++) {
    if (!(real[i].length > real[i - 1].length && real[i].startsWith(real[i - 1]))) return false;
  }
  // Two short pieces can line up by chance ("I", "I'm"); three, or a first piece of a sentence's
  // length repeated at the start of the next, cannot in a stream of next-parts.
  return real.length >= 3 || real[0].length >= 8;
}

export function assembleEvents(
  events: StreamEvent[],
  paths: readonly string[],
  options: { whole?: boolean; plain?: boolean } = {},
): AssembledStream {
  const eventKinds: Record<string, number> = {};
  const pieces: string[] = [];
  let text = "";
  let matchedPath: string | null = null;
  let finished = false;
  let finalText: string | null = null;
  let failedStep: string | null = null;
  const result = (over: Partial<AssembledStream>): AssembledStream => ({
    text: null, events, pieces: pieces.length, matchedPath, error: null, upstream: null, limit: false,
    finished, cumulative: false, eventKinds, failedStep, ...over,
  });

  for (const event of events) {
    const kind = eventKind(event) ?? "message";
    eventKinds[kind] = (eventKinds[kind] ?? 0) + 1;
    const d = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? (event.data as Record<string, unknown>) : null;

    const stated = readUpstreamError(event.data);
    const failedWorkflow = kind === "workflow_finished" && stated !== null;
    const bareError = !kind.includes(".") && d !== null && Object.keys(d).every((k) => k === "error" || k === "type") && stated !== null;
    if (ERROR_KINDS.has(kind) || failedWorkflow || bareError) {
      const upstream = stated ?? (d && typeof d.message === "string" ? { code: null, message: d.message, status: null } : null);
      return result({
        error: `The agent's stream ended with an error before a reply.${platformSaid(upstreamQuote(upstream))}`,
        upstream, limit: isLimitSignal(upstream),
      });
    }
    // A step that failed without ending the stream: remembered, in case nothing is said after it.
    if (kind === "node_finished" && stated) failedStep = upstreamQuote(stated);

    if (FINISH_KINDS.has(kind)) {
      finished = true;
      if (d && finalText === null) {
        for (const path of [...paths, ...FINAL_PATHS]) {
          const at = replyText(d, path);
          if (at !== undefined) { finalText = at; matchedPath = matchedPath ?? path; break; }
        }
      }
      continue;
    }

    const found = pieceOf(event, paths, options.plain === true);
    if (!found) continue;
    pieces.push(found.piece);
    matchedPath = matchedPath ?? found.at;
    if (kind === "message_replace") text = found.piece;
    // The whole text so far each time: the last one that says anything is the reply.
    else if (options.whole) text = found.piece === "" ? text : found.piece;
    else text += found.piece;
  }

  if (!pieces.length) {
    if (finalText !== null) return result({ text: finalText });
    // Finished with nothing at the paths read: an empty reply only when no event carried text
    // anywhere else either. Text elsewhere means the connection reads the wrong field, which is
    // a different fact with a different owner, so it is not called "the agent said nothing".
    return result({ text: finished && !events.some((e) => carriesText(e.data, 0)) ? "" : null });
  }
  if (!options.whole && isCumulative(pieces)) return result({ text: null, cumulative: true });
  return result({ text });
}

export function assembleEventStream(body: string, paths: readonly string[], options: { whole?: boolean; plain?: boolean } = {}): AssembledStream {
  return assembleEvents(parseEventStream(body), paths, options);
}

/** The first value at a path in any event, in order: a conversation id, say. */
export function firstInStream(events: readonly StreamEvent[], path: string): unknown {
  for (const event of events) {
    const value = event.data && typeof event.data === "object" ? replyText(event.data, path) : undefined;
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}
