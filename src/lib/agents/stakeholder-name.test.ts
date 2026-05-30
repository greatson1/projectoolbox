import { describe, it, expect } from "vitest";
import { normaliseStakeholderName, stakeholderNameKey } from "./stakeholder-name";

describe("normaliseStakeholderName", () => {
  it("trims leading + trailing whitespace", () => {
    expect(normaliseStakeholderName("  Ty Beetseh  ")).toBe("Ty Beetseh");
  });

  it("collapses internal whitespace runs to single space (Griffin bug)", () => {
    // The exact pattern that produced three duplicate Ty Beetseh rows.
    expect(normaliseStakeholderName("Ty  Beetseh")).toBe("Ty Beetseh");
    expect(normaliseStakeholderName("Ty   Beetseh")).toBe("Ty Beetseh");
  });

  it("treats NBSP (U+00A0) and tabs as whitespace", () => {
    expect(normaliseStakeholderName("Ty Beetseh")).toBe("Ty Beetseh");
    expect(normaliseStakeholderName("Ty\tBeetseh")).toBe("Ty Beetseh");
  });

  it("preserves original case (DO NOT casefold here)", () => {
    expect(normaliseStakeholderName("TY BEETSEH")).toBe("TY BEETSEH");
    expect(normaliseStakeholderName("ty beetseh")).toBe("ty beetseh");
  });

  it("returns empty string for null / undefined / blank", () => {
    expect(normaliseStakeholderName(null)).toBe("");
    expect(normaliseStakeholderName(undefined)).toBe("");
    expect(normaliseStakeholderName("   ")).toBe("");
  });
});

describe("stakeholderNameKey — dedup key (case + whitespace insensitive)", () => {
  it("produces the same key for every variant in the Griffin bug", () => {
    const variants = ["Ty Beetseh", "Ty  Beetseh", "TY BEETSEH", "ty beetseh", "  Ty Beetseh  "];
    const keys = new Set(variants.map(stakeholderNameKey));
    expect(keys.size).toBe(1);
    expect(keys.has("ty beetseh")).toBe(true);
  });

  it("produces different keys for genuinely different people", () => {
    expect(stakeholderNameKey("Ty Beetseh")).not.toBe(stakeholderNameKey("Tina Beetseh"));
    expect(stakeholderNameKey("Sarah Chen")).not.toBe(stakeholderNameKey("Sarah Chan"));
  });

  it("returns empty key for blank input", () => {
    expect(stakeholderNameKey(null)).toBe("");
    expect(stakeholderNameKey("   ")).toBe("");
  });
});
