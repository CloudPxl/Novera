import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { redact } from "../redact/pii.ts";

/**
 * Turning what a customer gives the Suite Builder — pasted text, a file, one fetched page,
 * a tool schema — into the text drafts may quote.
 *
 * Three rules. What is stored is the parsed text with detectable personal data already
 * replaced, so what a model is later sent is exactly what is stored and quoted; the
 * original bytes are kept only as a SHA-256. Every limit is checked before work is done
 * on the bytes, and a parse that would exceed one fails with the reason rather than
 * truncating — a suite built from half a document would look like coverage of all of it.
 * And nothing in a document is ever an instruction: it is text to quote.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 300_000;
/** A DOCX is a zip; this caps what its document part may expand to. */
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;
const MAX_PARSE_MS = 5_000;

export type SourceFormat = "text" | "markdown" | "html" | "docx" | "json";

export interface ParsedSource {
  ok: true;
  text: string;
  textSha256: string;
  originalSha256: string;
  byteSize: number;
  mediaType: string;
  redaction: Record<string, number>;
}

export type ParseOutcome = ParsedSource | { ok: false; error: string; originalSha256: string; byteSize: number };

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function formatFromName(name: string, mediaType = ""): SourceFormat | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt" || ext === "text") return "text";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "docx") return "docx";
  if (ext === "json" || ext === "yaml" || ext === "yml") return "json";
  if (mediaType.startsWith("text/html")) return "html";
  if (mediaType.startsWith("text/")) return "text";
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** One paragraph per line, no runs of blank lines, no trailing spaces. */
export function tidy(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/[ \t ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Readable text from an HTML page: what a person would read, not the markup around it. */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|tr|table|h[1-6]|blockquote|pre|dd|dt|header|main)\s*>/gi, "\n")
    .replace(/<h([1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return tidy(decodeEntities(body).split("\n").map((l) => l.trim()).join("\n"));
}

/** The text of a DOCX's main document part, with paragraph breaks. No dependency: a zip
 *  reader for the one entry, and an inflate capped so a small file cannot expand to fill memory. */
export function docxToText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This is not a readable .docx file.");
  const entries = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name !== "word/document.xml") continue;

    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("This .docx file is damaged.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    let xml: string;
    if (method === 0) xml = data.toString("utf8");
    else if (method === 8) {
      try {
        xml = inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES }).toString("utf8");
      } catch {
        throw new Error(`This .docx expands past ${MAX_INFLATED_BYTES / (1024 * 1024)} MB of text, or is damaged. Save the relevant section as its own file.`);
      }
    } else throw new Error("This .docx uses a compression method that cannot be read.");

    const text = xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "");
    return tidy(decodeEntities(text));
  }
  throw new Error("This .docx file has no document text.");
}

/**
 * A tool list or OpenAPI document as lines a draft can quote: one line per tool or
 * operation, naming it and its arguments. Declared by the customer, so labelled declared.
 */
export function toolSchemaToText(raw: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("The tool schema is not valid JSON. Paste a JSON list of tools or an OpenAPI document."); }
  const lines: string[] = [];
  const argsOf = (schema: unknown): string => {
    const props = (schema as { properties?: Record<string, unknown> } | null)?.properties;
    return props && typeof props === "object" ? Object.keys(props).slice(0, 12).join(", ") : "";
  };
  const add = (name: unknown, description: unknown, args: string) => {
    if (typeof name !== "string" || !/^[\w.\-/{} ]{1,120}$/.test(name)) return;
    const d = typeof description === "string" ? ` — ${description.replace(/\s+/g, " ").slice(0, 200)}` : "";
    lines.push(`Declared tool \`${name}\`${args ? ` (arguments: ${args})` : ""}${d}`);
  };

  const root = parsed as Record<string, unknown>;
  if (root && typeof root === "object" && !Array.isArray(root) && root.paths && typeof root.paths === "object") {
    for (const [path, ops] of Object.entries(root.paths as Record<string, Record<string, Record<string, unknown>>>)) {
      for (const [method, op] of Object.entries(ops ?? {})) {
        if (!/^(get|post|put|patch|delete)$/i.test(method) || !op || typeof op !== "object") continue;
        const body = (op.requestBody as { content?: Record<string, { schema?: unknown }> } | undefined)?.content?.["application/json"]?.schema;
        add(typeof op.operationId === "string" ? op.operationId : `${method.toUpperCase()} ${path}`, op.summary ?? op.description, argsOf(body));
      }
    }
  } else {
    const list = Array.isArray(parsed) ? parsed : Array.isArray(root?.tools) ? root.tools as unknown[] : [];
    for (const t of list) {
      const item = t as Record<string, unknown>;
      const fn = (item?.function ?? item) as Record<string, unknown>;
      add(fn?.name, fn?.description, argsOf(fn?.parameters ?? fn?.input_schema ?? fn?.inputSchema));
    }
  }
  if (!lines.length) throw new Error("No tools were found. Paste a JSON list of tools ({name, description, parameters}) or an OpenAPI document.");
  return lines.slice(0, 200).join("\n");
}

/** Parses, checks the limits, and redacts. The original is hashed before anything else. */
export function parseSource(input: { bytes: Uint8Array; format: SourceFormat; mediaType?: string }): ParseOutcome {
  const originalSha256 = sha256(input.bytes);
  const byteSize = input.bytes.byteLength;
  const fail = (error: string): ParseOutcome => ({ ok: false, error, originalSha256, byteSize });
  if (byteSize === 0) return fail("The source is empty.");
  if (byteSize > MAX_UPLOAD_BYTES) return fail(`The source is ${(byteSize / (1024 * 1024)).toFixed(1)} MB; the limit is 2 MB. Use the relevant section.`);

  const started = Date.now();
  let text: string;
  try {
    const raw = new TextDecoder().decode(input.bytes);
    text = input.format === "docx" ? docxToText(input.bytes)
      : input.format === "html" ? htmlToText(raw)
      : input.format === "json" ? toolSchemaToText(raw)
      : tidy(raw);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The source could not be read.");
  }
  if (Date.now() - started > MAX_PARSE_MS) return fail("Reading this source took too long. Use a smaller section.");
  if (!text) return fail("No readable text was found in the source.");
  if (text.length > MAX_SOURCE_CHARS) {
    return fail(`The text is ${text.length.toLocaleString("en")} characters; the limit is ${MAX_SOURCE_CHARS.toLocaleString("en")}. Use the section that describes what the agent may do.`);
  }

  const redacted = redact(text);
  return {
    ok: true,
    text: redacted.text,
    textSha256: sha256(redacted.text),
    originalSha256,
    byteSize,
    mediaType: input.mediaType ?? (input.format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : input.format === "html" ? "text/html" : input.format === "json" ? "application/json" : input.format === "markdown" ? "text/markdown" : "text/plain"),
    redaction: redacted.counts as Record<string, number>,
  };
}

/**
 * The text split into parts a model can read in one call, at paragraph boundaries. Parts
 * are extracted front to back; `extracted_parts` on the source records how far.
 */
export const PART_CHARS = 8_000;

export function partsOf(text: string, size = PART_CHARS): string[] {
  const parts: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    if (current && current.length + para.length + 2 > size) { parts.push(current); current = ""; }
    if (para.length > size) {
      for (let i = 0; i < para.length; i += size) parts.push(para.slice(i, i + size));
      continue;
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) parts.push(current);
  return parts;
}
