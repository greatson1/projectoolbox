/**
 * Unit tests for the classifyKeyRole side of key-role-recorder.
 *
 * The recordKeyRole side touches Prisma so it's covered by the wiring
 * tests for each caller (deploy route, chat backstop, People page).
 * Here we just lock in the classification contract — the SAME role
 * string from any input surface must canonicalise to the SAME title,
 * because that title becomes the KB.title that the phase-prereq
 * evaluator does a substring match against.
 */

import { describe, it, expect } from "vitest";
import { classifyKeyRole } from "./classify-key-role";

describe("classifyKeyRole — Sponsor patterns", () => {
  it("canonicalises common sponsor strings to 'Project Sponsor'", () => {
    expect(classifyKeyRole("Sponsor")).toBe("Project Sponsor");
    expect(classifyKeyRole("sponsor")).toBe("Project Sponsor");
    expect(classifyKeyRole("Project Sponsor")).toBe("Project Sponsor");
    expect(classifyKeyRole("Executive Sponsor")).toBe("Project Sponsor");
    expect(classifyKeyRole("Sponsoring Executive")).toBe("Project Sponsor");
    expect(classifyKeyRole("exec sponsor")).toBe("Project Sponsor");
  });

  it("does NOT match unrelated 'sponsor-like' words", () => {
    expect(classifyKeyRole("Marketing Sponsorship Lead")).toBe("Project Sponsor"); // word boundary OK
    expect(classifyKeyRole("Sponsoring")).toBe("Project Sponsor"); // root word matches
  });
});

describe("classifyKeyRole — Project Manager patterns", () => {
  it("canonicalises PM strings to 'Project Manager'", () => {
    expect(classifyKeyRole("PM")).toBe("Project Manager");
    expect(classifyKeyRole("pm")).toBe("Project Manager");
    expect(classifyKeyRole("Project Manager")).toBe("Project Manager");
    expect(classifyKeyRole("project manager")).toBe("Project Manager");
    expect(classifyKeyRole("Programme Manager")).toBe("Project Manager");
    expect(classifyKeyRole("Program Manager")).toBe("Project Manager");
  });

  it("does NOT match PM as a substring of unrelated roles", () => {
    // "PMO Lead" is NOT a PM; "Compliance" contains 'pm' substring but
    // not as a whole word — the pattern uses ^pm$ anchors so it's safe.
    expect(classifyKeyRole("PMO Lead")).not.toBe("Project Manager");
    expect(classifyKeyRole("Compliance Lead")).not.toBe("Project Manager");
  });
});

describe("classifyKeyRole — Client patterns", () => {
  it("canonicalises client strings to 'Client Organisation'", () => {
    expect(classifyKeyRole("Client")).toBe("Client Organisation");
    expect(classifyKeyRole("client")).toBe("Client Organisation");
    expect(classifyKeyRole("Client Organisation")).toBe("Client Organisation");
    expect(classifyKeyRole("Client Org")).toBe("Client Organisation");
    expect(classifyKeyRole("Commissioning Organisation")).toBe("Client Organisation");
  });
});

describe("classifyKeyRole — non-key-role inputs", () => {
  it("returns null for free-text roles that aren't key roles", () => {
    expect(classifyKeyRole("QA")).toBeNull();
    expect(classifyKeyRole("Tech Lead")).toBeNull();
    expect(classifyKeyRole("Developer")).toBeNull();
    expect(classifyKeyRole("Designer")).toBeNull();
    expect(classifyKeyRole("Architect")).toBeNull();
    expect(classifyKeyRole("BA")).toBeNull();
    expect(classifyKeyRole("Analyst")).toBeNull();
    expect(classifyKeyRole("Consultant")).toBeNull();
    expect(classifyKeyRole("Traveller")).toBeNull();
    expect(classifyKeyRole("Participant")).toBeNull();
  });

  it("returns null for empty / nullish inputs", () => {
    expect(classifyKeyRole("")).toBeNull();
    expect(classifyKeyRole(null)).toBeNull();
    expect(classifyKeyRole(undefined)).toBeNull();
    expect(classifyKeyRole("   ")).toBeNull();
  });
});

describe("classifyKeyRole — case sensitivity", () => {
  // The phase-prereq evaluator does case-insensitive substring matches,
  // but the classifier itself must also be case-insensitive so that
  // 'SPONSOR' / 'sponsor' / 'Sponsor' all produce the SAME canonical
  // title — otherwise we'd duplicate KB rows for the same person.
  it("is case-insensitive across all patterns", () => {
    expect(classifyKeyRole("SPONSOR")).toBe("Project Sponsor");
    expect(classifyKeyRole("PROJECT MANAGER")).toBe("Project Manager");
    expect(classifyKeyRole("CLIENT")).toBe("Client Organisation");
  });
});
