import { describe, it, expect } from "vitest";
import {
  parseArtefactRows,
  parseArtefactTable,
  serializeArtefactTable,
  pick,
  pickHeader,
} from "./artefact-rows";

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

describe("pickHeader", () => {
  it("returns the matching header in its original casing", () => {
    expect(pickHeader(["Epic Name", "Story", "Points"], "epic name", "epic")).toBe("Epic Name");
    expect(pickHeader(["Status", "Owner"], "state", "status")).toBe("Status");
  });

  it("ignores underscores + whitespace when matching", () => {
    expect(pickHeader(["story_points"], "Story Points")).toBe("story_points");
  });

  it("falls back to the first candidate when nothing matches", () => {
    expect(pickHeader(["Foo", "Bar"], "Epic", "Theme")).toBe("Epic");
  });
});

describe("parseArtefactTable + serializeArtefactTable round-trip", () => {
  it("round-trips a CSV table", () => {
    const src = "Epic,Feature,Story\nA,F1,S1\nA,F1,S2";
    const t = parseArtefactTable(src)!;
    expect(t.format).toBe("csv");
    expect(t.headers).toEqual(["Epic", "Feature", "Story"]);
    expect(t.rows).toHaveLength(2);
    const out = serializeArtefactTable(t);
    expect(out).toBe(src);
  });

  it("round-trips a markdown pipe table", () => {
    const src = "| Epic | Feature | Story |\n| --- | --- | --- |\n| A | F1 | S1 |\n| A | F1 | S2 |";
    const t = parseArtefactTable(src)!;
    expect(t.format).toBe("markdown");
    expect(t.headers).toEqual(["Epic", "Feature", "Story"]);
    expect(t.rows).toHaveLength(2);
    const out = serializeArtefactTable(t);
    // Round-trip uses 3-dash separators, not whatever width the input had.
    expect(out).toContain("| --- | --- | --- |");
    expect(out).toContain("| A | F1 | S1 |");
  });

  it("preserves header order when a row is missing keys", () => {
    const t = parseArtefactTable("A,B,C\n1,2,3")!;
    t.rows.push({ A: "x", C: "z" }); // B missing
    const out = serializeArtefactTable(t);
    expect(out.split("\n")[2]).toBe("x,,z");
  });

  it("quotes CSV cells with commas, quotes or newlines", () => {
    const t = parseArtefactTable("Name,Note\nA,B")!;
    t.rows[0] = { Name: 'Smith, J', Note: 'he said "hi"' };
    const out = serializeArtefactTable(t);
    expect(out).toContain('"Smith, J"');
    expect(out).toContain('"he said ""hi"""');
  });

  it("escapes pipe characters in markdown cells", () => {
    const t = parseArtefactTable("| A | B |\n| --- | --- |\n| x | y |")!;
    t.rows[0] = { A: "a|b", B: "c" };
    const out = serializeArtefactTable(t);
    expect(out).toContain("a\\|b");
  });

  it("returns null when content has no parseable table", () => {
    expect(parseArtefactTable("")).toBeNull();
    expect(parseArtefactTable(null)).toBeNull();
    expect(parseArtefactTable("just one line of prose")).toBeNull();
  });

  it("parseArtefactRows still works on top of parseArtefactTable", () => {
    expect(parseArtefactRows("A,B\n1,2")).toEqual([{ A: "1", B: "2" }]);
  });
});
