/**
 * Rate limiting via Upstash Redis sliding windows.
 *
 * Why distributed: Vercel runs N concurrent lambdas; an in-memory limiter on
 * one instance never sees the requests hitting another. Upstash is the
 * standard correctness-preserving option.
 *
 * Graceful no-op: if UPSTASH_REDIS_REST_URL / TOKEN aren't configured (local
 * dev without Upstash), `checkRateLimit` returns `{ ok: true }` immediately.
 * This means rate limiting is OPT-IN by env var — set the two vars to turn it
 * on, leave them blank to turn it off. Production should always have them set.
 *
 * Buckets are tuned for the 2000-user target:
 *   - chatStream — 30 req/min per (user or IP). Each turn fires 2× Anthropic +
 *     ~12 DB queries, so 30/min/user already pushes ~1 cmps backend load.
 *   - ingest    — 10 req/min per user. Whisper + extraction is heavy.
 *   - waitlist  — 5 req per 10 min per IP. Unauthed; brute-force protection.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let cachedRedis: Redis | null = null;
let redisInitFailed = false;

function getRedis(): Redis | null {
  if (cachedRedis) return cachedRedis;
  if (redisInitFailed) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Not configured — silent in dev, expected behaviour.
    redisInitFailed = true;
    return null;
  }
  try {
    cachedRedis = new Redis({ url, token });
    return cachedRedis;
  } catch (e) {
    console.warn("[rate-limit] Upstash init failed; falling back to no-op", e);
    redisInitFailed = true;
    return null;
  }
}

// Bucket → factory that builds a Ratelimit instance from a Redis client.
// Factories rather than pre-instantiated objects so getRedis() can return
// null without breaking module load.
const bucketConfig = {
  chatStream: { tokens: 30, window: "1 m" as const, prefix: "rl:chat" },
  ingest:     { tokens: 10, window: "1 m" as const, prefix: "rl:ingest" },
  waitlist:   { tokens: 5,  window: "10 m" as const, prefix: "rl:waitlist" },
};
export type RateLimitBucket = keyof typeof bucketConfig;

const limiterCache = new Map<RateLimitBucket, Ratelimit>();
function getLimiter(bucket: RateLimitBucket): Ratelimit | null {
  if (limiterCache.has(bucket)) return limiterCache.get(bucket)!;
  const r = getRedis();
  if (!r) return null;
  const cfg = bucketConfig[bucket];
  const lim = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(cfg.tokens, cfg.window),
    prefix: cfg.prefix,
    analytics: true,
  });
  limiterCache.set(bucket, lim);
  return lim;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reset: number; remaining: number; limit: number };

/**
 * Check a single rate-limit bucket for an identifier.
 *
 * @param bucket     Which bucket to charge (chatStream | ingest | waitlist).
 * @param identifier Stable per-actor key. Prefer userId/orgId where the
 *                   request is authenticated; fall back to IP for public
 *                   endpoints. Combine ("org:abc:agent:xyz") when scoping.
 */
export async function checkRateLimit(
  bucket: RateLimitBucket,
  identifier: string,
): Promise<RateLimitResult> {
  const lim = getLimiter(bucket);
  if (!lim) return { ok: true }; // graceful fallback
  const res = await lim.limit(identifier);
  if (res.success) return { ok: true };
  return { ok: false, reset: res.reset, remaining: res.remaining, limit: res.limit };
}

/** Extract the requester IP from forwarding headers; falls back to "anon". */
export function extractClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const first = fwd.split(",")[0].trim();
  if (first) return first;
  return req.headers.get("x-real-ip") || "anon";
}

/** Standard 429 response with Retry-After + X-RateLimit-* headers. */
export function rateLimitedResponse(detail: {
  reset: number;
  remaining: number;
  limit: number;
}): Response {
  const retryAfter = Math.max(1, Math.ceil((detail.reset - Date.now()) / 1000));
  return new Response(
    JSON.stringify({
      error: "Rate limited. Please slow down and try again shortly.",
      retryAfter,
      limit: detail.limit,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(detail.limit),
        "X-RateLimit-Remaining": String(detail.remaining),
        "X-RateLimit-Reset": String(detail.reset),
      },
    },
  );
}
