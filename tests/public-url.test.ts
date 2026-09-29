import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl, isPublicAddress, PrivateAddressError } from "../src/lib/net/public-url.ts";

test("private, loopback, link-local and reserved IPv4 are not public", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "192.0.0.8", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.0.1", "76.76.21.21"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test("IPv6 loopback, unique-local, link-local and v4-embedding forms are judged correctly", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "::127.0.0.1"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  assert.equal(isPublicAddress("not-an-ip"), false);
});

const resolvesTo = (...ips: string[]) => async () => ips;

test("a hostname is judged by what it resolves to — every address of it", async () => {
  await assert.doesNotReject(() => assertPublicUrl("https://agent.example/chat", { resolver: resolvesTo("93.184.216.34"), allowLoopback: false }));
  await assert.rejects(() => assertPublicUrl("https://sneaky.example/chat", { resolver: resolvesTo("93.184.216.34", "10.0.0.5"), allowLoopback: false }),
    (e: Error) => e instanceof PrivateAddressError && /private or internal address \(10\.0\.0\.5\)/.test(e.message));
  await assert.rejects(() => assertPublicUrl("http://metadata.example/", { resolver: resolvesTo("169.254.169.254"), allowLoopback: false }), PrivateAddressError);
  await assert.rejects(() => assertPublicUrl("https://nowhere.example/", { resolver: async () => { throw new Error("ENOTFOUND"); }, allowLoopback: false }),
    /could not be resolved/);
});

test("literal addresses, schemes, and loopback outside production", async () => {
  await assert.rejects(() => assertPublicUrl("http://127.0.0.1:9001/2018-06-01/runtime/invocation/next", { allowLoopback: false }), PrivateAddressError);
  await assert.rejects(() => assertPublicUrl("http://[::1]:3000/", { allowLoopback: false }), PrivateAddressError);
  await assert.rejects(() => assertPublicUrl("file:///etc/passwd"), /Only http and https/);
  await assert.rejects(() => assertPublicUrl("not a url"), /not a valid URL/);
  // Development runs the scripted test agent on localhost; private ranges stay closed.
  await assert.doesNotReject(() => assertPublicUrl("http://127.0.0.1:3000/api/test-agent", { allowLoopback: true }));
  await assert.rejects(() => assertPublicUrl("http://10.0.0.1/", { allowLoopback: true }), PrivateAddressError);
});
