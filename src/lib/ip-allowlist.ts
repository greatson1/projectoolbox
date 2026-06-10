/**
 * Pure IP allowlist matching. The orgs table stores a string[] of CIDR
 * ranges or single IPs; this module decides whether a given client IP
 * is inside one of them.
 *
 * IPv4-only by design — the SaaS isn't dual-stack today, and CIDR
 * arithmetic on v6 inside the edge runtime is enough hassle to defer
 * until a customer asks. v6 client IPs are treated as not-in-range so
 * the middleware safely 403s rather than silently letting them through.
 */

export interface ParsedRange {
  base: number;
  bits: number;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255 || /[^0-9]/.test(p)) return null;
    result = (result << 8) + n;
  }
  // Force to unsigned 32-bit so left-shifts in higher octets don't go
  // negative.
  return result >>> 0;
}

/**
 * Parse a CIDR string ("203.0.113.0/24") or a bare IP ("203.0.113.42").
 * A bare IP is treated as /32. Returns null on any parse failure so the
 * caller can decide whether to ignore the bad entry or treat it as a
 * hard error.
 */
export function parseCidr(entry: string): ParsedRange | null {
  const [ipPart, maskPart] = entry.trim().split("/");
  const ipInt = ipv4ToInt(ipPart);
  if (ipInt === null) return null;
  let bits = 32;
  if (maskPart !== undefined) {
    const m = Number(maskPart);
    if (!Number.isInteger(m) || m < 0 || m > 32) return null;
    bits = m;
  }
  // Zero out host bits so two CIDRs with the same base+mask but
  // different host bits ("10.0.0.5/24" vs "10.0.0.6/24") collapse to
  // the same canonical range.
  const hostBits = 32 - bits;
  // Special-case bits=0 because a 32-bit shift is UB in JS (returns 0
  // for the operand width but >>> wraps to the same input). Anything
  // ANDed with bits=0 mask should pass — that's a 0.0.0.0/0 = anywhere.
  const mask = bits === 0 ? 0 : (~((1 << hostBits) - 1)) >>> 0;
  return { base: (ipInt & mask) >>> 0, bits };
}

/** True if ip falls inside the parsed CIDR range. */
export function ipInRange(ip: string, range: ParsedRange): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  if (range.bits === 0) return true; // 0.0.0.0/0 — anywhere
  const hostBits = 32 - range.bits;
  const mask = (~((1 << hostBits) - 1)) >>> 0;
  return ((ipInt & mask) >>> 0) === range.base;
}

/**
 * Does the IP match at least one entry in the allowlist?
 *
 * Empty allowlist → returns true (no restriction; the caller is
 * responsible for deciding when to enforce). Unparseable entries are
 * skipped, not treated as catch-all — fail closed.
 */
export function ipMatchesAllowlist(ip: string | null | undefined, allowlist: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  if (!ip) return false;
  for (const entry of allowlist) {
    const range = parseCidr(entry);
    if (!range) continue;
    if (ipInRange(ip, range)) return true;
  }
  return false;
}

/**
 * True if the entry is a syntactically valid IPv4 CIDR or bare IP.
 * Used by the org settings PATCH to refuse bad input before it lands
 * in the column. Doesn't enforce that the value be public / not
 * loopback — operators sometimes pilot from 10.x or 127.0.0.1.
 */
export function isValidCidrOrIp(entry: string): boolean {
  return parseCidr(entry) !== null;
}
