import { describe, it, expect } from "vitest";
import { parseCidr, ipInRange, ipMatchesAllowlist, isValidCidrOrIp } from "./ip-allowlist";

describe("parseCidr", () => {
  it("parses bare IPv4 as /32", () => {
    const r = parseCidr("203.0.113.42");
    expect(r).not.toBeNull();
    expect(r!.bits).toBe(32);
  });

  it("parses standard CIDR notation", () => {
    const r = parseCidr("203.0.113.0/24");
    expect(r!.bits).toBe(24);
  });

  it("canonicalises host bits inside the masked range", () => {
    // 10.0.0.5/24 → base should be 10.0.0.0 (host bits zeroed)
    const a = parseCidr("10.0.0.5/24");
    const b = parseCidr("10.0.0.0/24");
    expect(a!.base).toBe(b!.base);
  });

  it("returns null on malformed input", () => {
    expect(parseCidr("not an ip")).toBeNull();
    expect(parseCidr("999.999.999.999")).toBeNull();
    expect(parseCidr("10.0.0.1/33")).toBeNull();
    expect(parseCidr("10.0.0.1/-1")).toBeNull();
    expect(parseCidr("10.0.0.1/abc")).toBeNull();
    expect(parseCidr("10.0.0/24")).toBeNull(); // too few octets
    expect(parseCidr("")).toBeNull();
  });
});

describe("ipInRange", () => {
  it("matches an IP inside a /24", () => {
    const r = parseCidr("203.0.113.0/24")!;
    expect(ipInRange("203.0.113.0", r)).toBe(true);
    expect(ipInRange("203.0.113.42", r)).toBe(true);
    expect(ipInRange("203.0.113.255", r)).toBe(true);
  });

  it("rejects an IP outside the /24", () => {
    const r = parseCidr("203.0.113.0/24")!;
    expect(ipInRange("203.0.114.0", r)).toBe(false);
    expect(ipInRange("203.0.112.255", r)).toBe(false);
  });

  it("0.0.0.0/0 matches any IPv4", () => {
    const r = parseCidr("0.0.0.0/0")!;
    expect(ipInRange("1.2.3.4", r)).toBe(true);
    expect(ipInRange("255.255.255.255", r)).toBe(true);
    expect(ipInRange("0.0.0.0", r)).toBe(true);
  });

  it("/32 matches only the exact IP", () => {
    const r = parseCidr("10.0.0.5")!;
    expect(ipInRange("10.0.0.5", r)).toBe(true);
    expect(ipInRange("10.0.0.6", r)).toBe(false);
  });

  it("malformed input IP returns false", () => {
    const r = parseCidr("10.0.0.0/24")!;
    expect(ipInRange("nonsense", r)).toBe(false);
    expect(ipInRange("", r)).toBe(false);
  });
});

describe("ipMatchesAllowlist", () => {
  it("empty allowlist = no restriction (returns true)", () => {
    expect(ipMatchesAllowlist("1.2.3.4", [])).toBe(true);
  });

  it("matches when at least one entry covers the IP", () => {
    expect(ipMatchesAllowlist("203.0.113.42", ["203.0.113.0/24", "10.0.0.0/8"])).toBe(true);
    expect(ipMatchesAllowlist("10.5.5.5", ["203.0.113.0/24", "10.0.0.0/8"])).toBe(true);
  });

  it("rejects when no entry covers the IP", () => {
    expect(ipMatchesAllowlist("192.0.2.1", ["203.0.113.0/24", "10.0.0.0/8"])).toBe(false);
  });

  it("missing/empty IP returns false when there IS a list (fail closed)", () => {
    expect(ipMatchesAllowlist(null, ["10.0.0.0/8"])).toBe(false);
    expect(ipMatchesAllowlist(undefined, ["10.0.0.0/8"])).toBe(false);
    expect(ipMatchesAllowlist("", ["10.0.0.0/8"])).toBe(false);
  });

  it("skips malformed entries rather than treating them as catch-all", () => {
    // The bad entry "nonsense" must not match — only the good one decides.
    expect(ipMatchesAllowlist("1.2.3.4", ["nonsense", "10.0.0.0/8"])).toBe(false);
    expect(ipMatchesAllowlist("10.0.0.1", ["nonsense", "10.0.0.0/8"])).toBe(true);
  });
});

describe("isValidCidrOrIp", () => {
  it("accepts well-formed entries", () => {
    expect(isValidCidrOrIp("10.0.0.0/8")).toBe(true);
    expect(isValidCidrOrIp("203.0.113.42")).toBe(true);
    expect(isValidCidrOrIp("0.0.0.0/0")).toBe(true);
    expect(isValidCidrOrIp("255.255.255.255/32")).toBe(true);
  });

  it("rejects malformed entries", () => {
    expect(isValidCidrOrIp("not.an.ip")).toBe(false);
    expect(isValidCidrOrIp("10.0.0.0/33")).toBe(false);
    expect(isValidCidrOrIp("")).toBe(false);
  });
});
