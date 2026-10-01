import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { gzipSync } from "node:zlib";
import { BodyTooLarge, readJsonLimited, readTextLimited } from "../src/lib/net/read-body.ts";
import { MAX_PROVIDER_BYTES, ProviderError, readProviderJson } from "../src/lib/providers/types.ts";

// A raw socket server, so a response can lie about its length, never end, or stall —
// things a well-behaved HTTP library refuses to send.
type Script = (socket: Socket) => void;
const scripts = new Map<string, Script>();
const sockets = new Set<Socket>();
const server = createServer((socket) => {
  sockets.add(socket);
  socket.on("error", () => {}); // the reader hanging up early is the point of most tests
  socket.on("close", () => sockets.delete(socket));
  socket.once("data", (chunk) => {
    const path = chunk.toString().split(" ")[1];
    scripts.get(path)?.(socket);
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => { for (const s of sockets) s.destroy(); server.close(); });

const head = (extra: string) => `HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-type: text/plain\r\n${extra}\r\n`;
const LIMIT = 64 * 1024;

test("a body within the limit is read whole", async () => {
  scripts.set("/small", (s) => s.end(head("content-length: 5\r\n") + "hello"));
  assert.equal(await readTextLimited(await fetch(`${base}/small`), LIMIT), "hello");
});

test("a declared length above the limit is refused before a byte is read", async () => {
  let written = false;
  scripts.set("/declared", (s) => { s.write(head(`content-length: ${LIMIT * 100}\r\n`)); setTimeout(() => { written = !s.destroyed; s.destroy(); }, 200); });
  await assert.rejects(readTextLimited(await fetch(`${base}/declared`), LIMIT), BodyTooLarge);
  assert.equal(written, false, "the reader let go before the server wrote a body");
});

test("a body that never ends stops at the limit", async () => {
  scripts.set("/endless", (s) => {
    s.write(head("transfer-encoding: chunked\r\n"));
    const chunk = "x".repeat(16 * 1024);
    const timer = setInterval(() => { if (s.destroyed) return clearInterval(timer); s.write(`${chunk.length.toString(16)}\r\n${chunk}\r\n`); }, 1);
    s.on("close", () => clearInterval(timer));
  });
  await assert.rejects(readTextLimited(await fetch(`${base}/endless`), LIMIT), BodyTooLarge);
});

test("a Content-Length that lies smaller never lets more than it declared through", async () => {
  scripts.set("/liar", (s) => s.end(head("content-length: 10\r\n") + "y".repeat(LIMIT * 4)));
  // fetch reads only the declared ten bytes; the rest is never ours.
  const text = await readTextLimited(await fetch(`${base}/liar`), LIMIT).catch((e: Error) => e);
  assert.ok(text instanceof Error || text.length <= 10, typeof text === "string" ? `${text.length} bytes` : text.message);
});

test("a small compressed body that expands is counted at its expanded size", async () => {
  const bomb = gzipSync(Buffer.alloc(LIMIT * 64, 0x61));
  assert.ok(bomb.length < LIMIT, `compressed ${bomb.length} bytes`);
  scripts.set("/bomb", (s) => { s.write(head(`content-encoding: gzip\r\ncontent-length: ${bomb.length}\r\n`)); s.end(bomb); });
  await assert.rejects(readTextLimited(await fetch(`${base}/bomb`), LIMIT), BodyTooLarge);
});

test("bytes that are not UTF-8 become replacement characters, never an error", async () => {
  const bytes = Buffer.from([0x6f, 0x6b, 0xff, 0xfe, 0x21]);
  scripts.set("/latin", (s) => { s.write(head(`content-length: ${bytes.length}\r\n`)); s.end(bytes); });
  assert.equal(await readTextLimited(await fetch(`${base}/latin`), LIMIT), "ok��!");
});

test("a body that stalls after the headers ends in the request's own timeout", async () => {
  scripts.set("/stall", (s) => s.write(head("content-length: 100\r\n") + "partial"));
  const started = Date.now();
  const response = await fetch(`${base}/stall`, { signal: AbortSignal.timeout(300) });
  await assert.rejects(readTextLimited(response, LIMIT), (e: Error) => e.name === "TimeoutError" || e.name === "AbortError");
  assert.ok(Date.now() - started < 3_000);
});

test("JSON that is not JSON is null; JSON that is too large still refuses", async () => {
  scripts.set("/html", (s) => s.end(head("content-length: 13\r\n") + "<html></html>"));
  assert.equal(await readJsonLimited(await fetch(`${base}/html`), LIMIT), null);
  const big = JSON.stringify({ a: "z".repeat(LIMIT * 2) });
  scripts.set("/bigjson", (s) => s.end(head(`content-length: ${big.length}\r\n`) + big));
  await assert.rejects(readJsonLimited(await fetch(`${base}/bigjson`), LIMIT), BodyTooLarge);
});

test("a provider's oversized or stalled answer is a provider failure of the matching kind", async () => {
  const big = JSON.stringify({ choices: [{ message: { content: "v".repeat(MAX_PROVIDER_BYTES) } }] });
  scripts.set("/provider-big", (s) => s.end(head(`content-length: ${big.length}\r\n`) + big));
  await assert.rejects(readProviderJson("test", await fetch(`${base}/provider-big`), 20_000),
    (e: unknown) => e instanceof ProviderError && !e.timedOut && /larger than 1 MB/.test(e.message));
  scripts.set("/provider-stall", (s) => s.write(head("content-length: 100\r\n") + "{\"choi"));
  const response = await fetch(`${base}/provider-stall`, { signal: AbortSignal.timeout(300) });
  await assert.rejects(readProviderJson("test", response, 300), (e: unknown) => e instanceof ProviderError && e.timedOut);
});
