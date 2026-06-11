import { describe, it, expect } from "vitest";
import { evaluatePaywall, isBlocked, isBypassed } from "./paywall";

describe("evaluatePaywall — hybrid (post-2026-06-11)", () => {
  it("active for FREE — FREE is a real always-free tier, not a trial", () => {
    expect(evaluatePaywall({ plan: "FREE" })).toEqual({ kind: "active", plan: "FREE" });
    // No createdAt needed and no createdAt-based expiry behaviour.
    const oldCreatedAt = new Date("2025-01-01T00:00:00Z");
    expect(evaluatePaywall({ plan: "FREE", createdAt: oldCreatedAt })).toEqual({ kind: "active", plan: "FREE" });
  });

  it.each(["STARTER", "PROFESSIONAL", "BUSINESS", "ENTERPRISE"])(
    "active for paid tier %s regardless of org age",
    (plan) => {
      expect(evaluatePaywall({ plan })).toEqual({ kind: "active", plan });
    },
  );

  it("uppercases lowercase plan", () => {
    expect(evaluatePaywall({ plan: "professional" })).toEqual({ kind: "active", plan: "PROFESSIONAL" });
  });

  it("returns no_org when plan is missing", () => {
    expect(evaluatePaywall({ plan: null })).toEqual({
      kind: "no_org",
      reason: "User has not yet created or joined an organisation.",
    });
    expect(evaluatePaywall({ plan: null, createdAt: new Date() })).toEqual({
      kind: "no_org",
      reason: "User has not yet created or joined an organisation.",
    });
  });
});

describe("isBlocked", () => {
  it("blocks only no_org", () => {
    expect(isBlocked({ kind: "no_org", reason: "User has not yet created or joined an organisation." })).toBe(true);
    expect(isBlocked({ kind: "active", plan: "FREE" })).toBe(false);
    expect(isBlocked({ kind: "active", plan: "PROFESSIONAL" })).toBe(false);
    expect(isBlocked({ kind: "active", plan: "ENTERPRISE" })).toBe(false);
  });
});

describe("isBypassed — paywall escape paths", () => {
  it("bypasses /billing and subpaths", () => {
    expect(isBypassed("/billing")).toBe(true);
    expect(isBypassed("/billing/credits")).toBe(true);
    expect(isBypassed("/billing/history")).toBe(true);
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

  it("does NOT bypass core product routes (those need active orgs)", () => {
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
