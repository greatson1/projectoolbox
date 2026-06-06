import { describe, it, expect } from "vitest";
import { parseArtefactRows, pick } from "./artefact-rows";

describe("parseArtefactRows", () => {
  it("parses simple CSV with header", () => {
    const rows = parseArtefactRows("Epic,Feature,Story\nA,F1,S1\nA,F1,S2");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Epic: "A", Feature: "F1", Story: "S1" });
    expect(rows[1].Story).toBe("S2");
  });

  it("strips code fences", () => {
    const rows = parseArtefactRows("```csv\nA,B\n1,2\n```");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ A: "1", B: "2" });
  });

  it("parses markdown pipe tables", () => {
    const md = `| Epic | Feature | Story |
|---|---|---|
| Onboarding | Sign up | Email verify |
| Onboarding | Sign up | Password reset |`;
    const rows = parseArtefactRows(md);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Epic: "Onboarding", Feature: "Sign up", Story: "Email verify" });
  });

  it("handles quoted CSV fields with embedded commas", () => {
    const rows = parseArtefactRows('Name,Note\n"Smith, J",Hello\nLi,"Hi, there"');
    expect(rows[0].Name).toBe("Smith, J");
    expect(rows[1].Note).toBe("Hi, there");
  });

  it("returns empty array for empty/null content", () => {
    expect(parseArtefactRows("")).toEqual([]);
    expect(parseArtefactRows(null)).toEqual([]);
    expect(parseArtefactRows(undefined)).toEqual([]);
  });

  it("ignores blank rows", () => {
    const rows = parseArtefactRows("A,B\n1,2\n\n3,4");
    expect(rows).toHaveLength(2);
  });
});

describe("pick", () => {
  it("finds value by exact column name", () => {
    expect(pick({ Epic: "Onboarding" }, "Epic")).toBe("Onboarding");
  });

  it("is case-insensitive", () => {
    expect(pick({ epic: "Onboarding" }, "Epic")).toBe("Onboarding");
    expect(pick({ EPIC: "X" }, "epic")).toBe("X");
  });

  it("ignores underscores and spaces in comparison", () => {
    expect(pick({ "Epic Name": "X" }, "epic_name")).toBe("X");
    expect(pick({ epic_name: "X" }, "Epic Name")).toBe("X");
  });

  it("falls through to subsequent candidates if first is empty/missing", () => {
    expect(pick({ Name: "Onboarding" }, "Epic", "Theme", "Name")).toBe("Onboarding");
    expect(pick({ Epic: "  ", Name: "X" }, "Epic", "Name")).toBe("X");
  });

  it("returns empty string when nothing matches", () => {
    expect(pick({ Foo: "bar" }, "Epic")).toBe("");
  });
});
