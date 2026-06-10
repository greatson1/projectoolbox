import { describe, it, expect } from "vitest";
import { looksLikeRandomName } from "./waitlist-validators";

describe("looksLikeRandomName — bot signature detection", () => {
  it("flags the live bot strings that prompted the guard", () => {
    expect(looksLikeRandomName("ccBLBPrVViYauVjkl")).toBe(true);
    expect(looksLikeRandomName("aPahulVDDWRyOuiW")).toBe(true);
    expect(looksLikeRandomName("fCIUZyVRixYcTNpmRJRD")).toBe(true);
  });

  it("flags long no-space mixed-case strings", () => {
    expect(looksLikeRandomName("AbCdEfGhIjKlMn")).toBe(true);
    expect(looksLikeRandomName("XxXxXxXxXxXxXx")).toBe(true);
  });

  it("flags strings with long consonant runs", () => {
    expect(looksLikeRandomName("xkcdfrtgvbnhujk")).toBe(true);
    expect(looksLikeRandomName("MNBVCXZQWERTY")).toBe(true);
  });
});

describe("looksLikeRandomName — legitimate names pass", () => {
  it("allows names with whitespace (First Last)", () => {
    expect(looksLikeRandomName("Amaan Khan")).toBe(false);
    expect(looksLikeRandomName("Sakshi Goud")).toBe(false);
    expect(looksLikeRandomName("Ty Bee")).toBe(false);
    expect(looksLikeRandomName("Jean-Luc Picard")).toBe(false);
    expect(looksLikeRandomName("Mary O'Brien")).toBe(false);
  });

  it("allows short single-word names", () => {
    expect(looksLikeRandomName("Madonna")).toBe(false);
    expect(looksLikeRandomName("Bono")).toBe(false);
    expect(looksLikeRandomName("Cher")).toBe(false);
    expect(looksLikeRandomName("Prince")).toBe(false);
    expect(looksLikeRandomName("JoAnne")).toBe(false);
  });

  it("allows longer real surnames with intra-name case (Mac/Mc prefixes)", () => {
    expect(looksLikeRandomName("MacDonald")).toBe(false);
    expect(looksLikeRandomName("McGregor")).toBe(false);
    expect(looksLikeRandomName("MacIntosh")).toBe(false);
    expect(looksLikeRandomName("DiAngelo")).toBe(false);
    expect(looksLikeRandomName("DeShawn")).toBe(false);
  });

  it("allows long all-lowercase or all-uppercase single words", () => {
    expect(looksLikeRandomName("christopherson")).toBe(false);
    expect(looksLikeRandomName("CHRISTOPHERSON")).toBe(false);
  });
});

describe("looksLikeRandomName — edge cases", () => {
  it("treats empty / null / undefined as not-random (caller filters first)", () => {
    expect(looksLikeRandomName("")).toBe(false);
    expect(looksLikeRandomName(null)).toBe(false);
    expect(looksLikeRandomName(undefined)).toBe(false);
    expect(looksLikeRandomName("   ")).toBe(false);
  });

  it("trims whitespace before testing", () => {
    expect(looksLikeRandomName("  Madonna  ")).toBe(false);
    expect(looksLikeRandomName("  ccBLBPrVViYauVjkl  ")).toBe(true);
  });
});
