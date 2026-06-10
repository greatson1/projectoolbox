import { describe, it, expect } from "vitest";
import { evaluatePaywall, computeTrialEnd, isBlocked, isBypassed, TRIAL_DAYS } from "./paywall";

const day = (n: number) => n * 86_400_000;
const now = new Date("2026-06-15T12:00:00Z");

describe("evaluatePaywall — trial windows", () => {
  it("returns trial_active for a 1-day-old FREE org", () => {
    const status = evaluatePaywall({ plan: "FREE", createdAt: new Date(now.getTime() - day(1)) }, now);
    expect(status.kind).toBe("trial_active");
    if (status.kind === "trial_active") {
      expect(status.daysRemaining).toBe(TRIAL_DAYS - 1);
    }
  });

  it("returns trial_active on the last hour of day 14", () => {
    // 13 days 23 hours ago = 1 hour of trial remaining
    const createdAt = new Date(now.getTime() - (day(14) - 3600_000));
    const status = evaluatePaywall({ plan: "FREE", createdAt }, now);
    expect(status.kind).toBe("trial_active");
  });

  it("returns trial_expired exactly at the boundary + 1ms", () => {
    const createdAt = new Date(now.getTime() - day(14) - 1);
    const status = evaluatePaywall({ plan: "FREE", createdAt }, now);
    expect(status.kind).toBe("trial_expired");
  });

  it("returns trial_expired for orgs older than 14 days on FREE", () => {
    const createdAt = new Date(now.getTime() - day(30));
    const status = evaluatePaywall({ plan: "FREE", createdAt }, now);
    expect(status.kind).toBe("trial_expired");
  });
});

describe("evaluatePaywall — paid bypasses trial logic", () => {
  it.each(["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"])("plan %s = paid even after trial window", (plan) => {
    const status = evaluatePaywall({ plan, createdAt: new Date(now.getTime() - day(365)) }, now);
    expect(status.kind).toBe("paid");
    if (status.kind === "paid") expect(status.plan).toBe(plan);
  });

  it("uppercases lowercase plan values", () => {
    const status = evaluatePaywall({ plan: "professional", createdAt: new Date(now.getTime() - day(1)) }, now);
    expect(status.kind).toBe("paid");
    if (status.kind === "paid") expect(status.plan).toBe("PROFESSIONAL");
  });
});

describe("evaluatePaywall — no_org", () => {
  it("returns no_org when both plan and createdAt are missing", () => {
    const status = evaluatePaywall({ plan: null, createdAt: null }, now);
    expect(status.kind).toBe("no_org");
  });
});

describe("computeTrialEnd — override semantics", () => {
  it("uses 14-day default when no override", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = computeTrialEnd(start, null);
    expect(end.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("respects an extended trial override (sales-led pilot)", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const ext = new Date("2026-03-01T00:00:00Z");
    expect(computeTrialEnd(start, ext)).toEqual(ext);
  });
});

describe("isBlocked", () => {
  it("blocks only trial_expired and no_org", () => {
    expect(isBlocked({ kind: "trial_expired", trialEndedAt: now, plan: "FREE" })).toBe(true);
    expect(isBlocked({ kind: "no_org", reason: "User has not yet created or joined an organisation." })).toBe(true);
    expect(isBlocked({ kind: "trial_active", daysRemaining: 5, trialEndsAt: now })).toBe(false);
    expect(isBlocked({ kind: "paid", plan: "PROFESSIONAL" })).toBe(false);
  });
});

describe("isBypassed — paywall escape paths", () => {
  it("bypasses /billing and subpaths", () => {
    expect(isBypassed("/billing")).toBe(true);
    expect(isBypassed("/billing/credits")).toBe(true);
  });

  it("bypasses auth + signup flows so users can't get locked out", () => {
    expect(isBypassed("/login")).toBe(true);
    expect(isBypassed("/signup")).toBe(true);
    expect(isBypassed("/forgot-password")).toBe(true);
    expect(isBypassed("/api/auth/register")).toBe(true);
  });

  it("bypasses webhooks so Stripe can still deliver events", () => {
    expect(isBypassed("/api/webhooks/stripe")).toBe(true);
  });

  it("bypasses /admin so the operator can still see who's signed up", () => {
    expect(isBypassed("/admin/users")).toBe(true);
    expect(isBypassed("/admin/waitlist")).toBe(true);
  });

  it("does NOT bypass core product routes", () => {
    expect(isBypassed("/dashboard")).toBe(false);
    expect(isBypassed("/projects/123/artefacts")).toBe(false);
    expect(isBypassed("/agents/chat")).toBe(false);
    expect(isBypassed("/api/projects/123/tasks")).toBe(false);
  });

  it("doesn't false-match on a path that merely contains a bypass prefix", () => {
    // "/billing-history" shouldn't bypass just because "/billing" is a prefix.
    expect(isBypassed("/billing-history")).toBe(false);
    expect(isBypassed("/loginish")).toBe(false);
  });
});
