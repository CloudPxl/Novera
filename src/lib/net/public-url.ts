import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Every request Novera makes to an address a customer typed — their agent, their
 * read-back endpoint — goes only to the public internet.
 *
 * Without this, "connect an agent" is a way to make our servers call themselves or
 * their neighbours: on a serverless host the runtime's own API listens on loopback, and
 * the probe stores whatever answered. The address is checked after DNS resolution,
 * because a hostname is only a name for whatever it resolves to, and again at call time,
 * because that answer can change after the agent was connected. Redirects are not
 * followed by the callers, so a public host cannot hand the request on to a private one.
 *
 * Loopback is allowed outside production only, where the scripted test agent runs.
 */

export class PrivateAddressError extends Error {}

function v4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) ? parts : null;
}

function isPublicV4(ip: string): boolean {
  const p = v4Parts(ip);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return false;            // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false;              // carrier-grade NAT
  if (a === 169 && b === 254) return false;                        // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;               // private
  if (a === 192 && b === 168) return false;                        // private
  if (a === 192 && b === 0 && p[2] === 0) return false;            // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return false;           // benchmarking
  if (a >= 224) return false;                                      // multicast, reserved, broadcast
  return true;
}

function expandV6(ip: string): number[] | null {
  // Handle an embedded dotted IPv4 tail (::ffff:10.0.0.1).
  let text = ip.toLowerCase().split("%")[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const p = v4Parts(tail[1]);
    if (!p) return null;
    text = text.slice(0, -tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array(missing).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPublicV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false;                                   // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false;         // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return false;                                // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false;                                // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return false;                                // multicast
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible) and 64:ff9b::a.b.c.d (NAT64) all
  // reach an IPv4 address, so they are judged as that address.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicV4(embeddedV4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(embeddedV4(g[6], g[7]));
  return true;
}

/** Whether a literal IP address is on the public internet. Anything unparseable is not. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip.split("%")[0]);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

const isLoopback = (ip: string) => ip === "::1" || ip.startsWith("127.") || ip === "::ffff:127.0.0.1";

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
let defaultResolver: Resolver = systemResolver;

/**
 * Tests only: replaces DNS for every check that does not pass its own resolver, so a
 * test can use reserved `.example` hosts, which never resolve. `null` restores DNS.
 */
export function setResolverForTests(resolver: Resolver | null): void {
  defaultResolver = resolver ?? systemResolver;
}

/**
 * The URL, parsed, if it is http(s) and every address its host resolves to is public.
 * Throws `PrivateAddressError` with a sentence a person can act on otherwise.
 */
export async function assertPublicUrl(
  raw: string,
  options: { resolver?: Resolver; allowLoopback?: boolean } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PrivateAddressError("That is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PrivateAddressError("Only http and https addresses can be called.");
  }

  const allowLoopback = options.allowLoopback ?? process.env.NODE_ENV !== "production";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await (options.resolver ?? defaultResolver)(host);
    } catch {
      throw new PrivateAddressError(`${host} could not be resolved.`);
    }
    if (!addresses.length) throw new PrivateAddressError(`${host} could not be resolved.`);
  }

  for (const address of addresses) {
    if (isPublicAddress(address)) continue;
    if (allowLoopback && isLoopback(address)) continue;
    throw new PrivateAddressError(
      `${host} points to a private or internal address (${address}). Novera calls only addresses on the public internet.`,
    );
  }
  return url;
}
