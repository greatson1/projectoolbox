import { describe, it, expect } from "vitest";
import { classifyClassOfService, classOfServiceStyle } from "./kanban-cos";

describe("classifyClassOfService", () => {
  it("classifies canonical class names", () => {
    expect(classifyClassOfService("Expedite")).toBe("expedite");
    expect(classifyClassOfService("Standard")).toBe("standard");
    expect(classifyClassOfService("Fixed Date")).toBe("fixed");
    expect(classifyClassOfService("Intangible")).toBe("intangible");
  });

  it("is case-insensitive", () => {
    expect(classifyClassOfService("EXPEDITE")).toBe("expedite");
    expect(classifyClassOfService("fixed date")).toBe("fixed");
  });

  it("classifies common synonyms", () => {
    expect(classifyClassOfService("Urgent")).toBe("expedite");
    expect(classifyClassOfService("Blocker")).toBe("expedite");
    expect(classifyClassOfService("Deadline driven")).toBe("fixed");
    expect(classifyClassOfService("Tech Debt")).toBe("intangible");
    expect(classifyClassOfService("Improvement")).toBe("intangible");
    expect(classifyClassOfService("Normal")).toBe("standard");
    expect(classifyClassOfService("Default lane")).toBe("standard");
  });

  it("falls through to 'other' for unknown / null input", () => {
    expect(classifyClassOfService(null)).toBe("other");
    expect(classifyClassOfService(undefined)).toBe("other");
    expect(classifyClassOfService("")).toBe("other");
    expect(classifyClassOfService("Marketing-only swimlane")).toBe("other");
  });
});

describe("classOfServiceStyle", () => {
  it("orders Expedite first and Intangible last among canonical classes", () => {
    const exp = classOfServiceStyle("Expedite");
    const fix = classOfServiceStyle("Fixed Date");
    const std = classOfServiceStyle("Standard");
    const intang = classOfServiceStyle("Intangible");
    const other = classOfServiceStyle("Marketing");
    expect(exp.order).toBeLessThan(fix.order);
    expect(fix.order).toBeLessThan(std.order);
    expect(std.order).toBeLessThan(intang.order);
    expect(intang.order).toBeLessThan(other.order);
  });

  it("returns a colour + bucket per class", () => {
    const s = classOfServiceStyle("Expedite");
    expect(s.bucket).toBe("expedite");
    expect(s.color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(s.bg).toMatch(/^bg-/);
  });
});
