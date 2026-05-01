import { describe, it, expect } from "vitest";
import {
  hasStatusClaimSuffix,
  stripStatusClaimSuffix,
  tokenise,
  fuzzyMatchScaffolded,
} from "./task-similarity";

describe("hasStatusClaimSuffix", () => {
  it("matches '- approved'", () => {
    expect(hasStatusClaimSuffix("Stakeholder communication - Project initiation approved")).toBe(true);
  });

  it("matches '- complete' and '- completed'", () => {
    expect(hasStatusClaimSuffix("Risk register - complete")).toBe(true);
    expect(hasStatusClaimSuffix("Risk register - completed")).toBe(true);
  });

  it("matches em-dash and en-dash variants", () => {
    expect(hasStatusClaimSuffix("Phase gate — done")).toBe(true);
    expect(hasStatusClaimSuffix("Phase gate – done")).toBe(true);
  });

  it("matches 'signed off' and 'signed-off'", () => {
    expect(hasStatusClaimSuffix("Charter - signed off")).toBe(true);
    expect(hasStatusClaimSuffix("Charter - signed-off")).toBe(true);
  });

  it("matches 'resolved' and 'ticked' and 'finished'", () => {
    expect(hasStatusClaimSuffix("Issue 42 - resolved")).toBe(true);
    expect(hasStatusClaimSuffix("Stakeholder comms - ticked")).toBe(true);
    expect(hasStatusClaimSuffix("WBS draft - finished")).toBe(true);
  });

  it("does not match titles without a status suffix", () => {
    expect(hasStatusClaimSuffix("Stakeholder communication and updates")).toBe(false);
    expect(hasStatusClaimSuffix("Generate Project Brief")).toBe(false);
    expect(hasStatusClaimSuffix("Complete the WBS by Friday")).toBe(false);
  });

  it("does not match a status word in the middle of a title", () => {
    expect(hasStatusClaimSuffix("Approved vendor list update")).toBe(false);
    expect(hasStatusClaimSuffix("Done deal review")).toBe(false);
  });
});

describe("stripStatusClaimSuffix", () => {
  it("strips the suffix", () => {
    expect(stripStatusClaimSuffix("Stakeholder communication - Project initiation approved"))
      .toBe("Stakeholder communication - Project initiation");
  });

  it("returns the title unchanged when no suffix", () => {
    expect(stripStatusClaimSuffix("Generate Project Brief")).toBe("Generate Project Brief");
  });
});

describe("tokenise", () => {
  it("filters short tokens and stop words", () => {
    const toks = tokenise("the quick brown fox");
    expect(toks.has("quick")).toBe(true);
    expect(toks.has("brown")).toBe(true);
    expect(toks.has("the")).toBe(false);
    expect(toks.has("fox")).toBe(false); // <4 chars
  });

  it("strips punctuation", () => {
    const toks = tokenise("Generate: Project Brief!");
    expect(toks.has("generate")).toBe(true);
    expect(toks.has("project")).toBe(true);
    expect(toks.has("brief")).toBe(true);
  });

  it("excludes status-claim words", () => {
    const toks = tokenise("Stakeholder approved completed done");
    expect(toks.has("stakeholder")).toBe(true);
    expect(toks.has("approved")).toBe(false);
    expect(toks.has("completed")).toBe(false);
    expect(toks.has("done")).toBe(false);
  });
});

describe("fuzzyMatchScaffolded", () => {
  const candidates = [
    { id: "t1", title: "Stakeholder communication and updates", status: "TODO" },
    { id: "t2", title: "Review and update Risk Register", status: "TODO" },
    { id: "t3", title: "Generate Project Brief", status: "DONE" },
    { id: "t4", title: "Submit Phase Gate approval", status: "TODO" },
  ];

  it("matches the Nova bug pattern: 'Stakeholder communication - Project initiation approved' → real Stakeholder task", () => {
    const m = fuzzyMatchScaffolded(
      "Stakeholder communication - Project initiation approved",
      candidates,
    );
    expect(m).not.toBeNull();
    expect(m!.id).toBe("t1");
    expect(m!.title).toBe("Stakeholder communication and updates");
  });

  it("matches 'Risk register review needed' → 'Review and update Risk Register'", () => {
    const m = fuzzyMatchScaffolded("Risk register review needed", candidates);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("t2");
  });

  it("returns null when fewer than 2 significant tokens overlap", () => {
    const m = fuzzyMatchScaffolded("Update marketing landing page", candidates);
    expect(m).toBeNull();
  });

  it("returns null for an empty / fully-stop-word title", () => {
    expect(fuzzyMatchScaffolded("the and for", candidates)).toBeNull();
  });

  it("strips status suffix before matching", () => {
    // "Project Brief generation - done" → strip "- done" → "Project Brief generation"
    // Should still match "Generate Project Brief" via project + brief overlap.
    const m = fuzzyMatchScaffolded("Project Brief generation - done", candidates);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("t3");
  });

  it("returns the highest-overlap match when several would qualify", () => {
    const richer = [
      ...candidates,
      { id: "t5", title: "Stakeholder register update communication", status: "TODO" },
    ];
    const m = fuzzyMatchScaffolded("Stakeholder communication update", richer);
    expect(m).not.toBeNull();
    // t5 shares stakeholder + communication + update (3); t1 shares stakeholder + communication (2)
    expect(m!.id).toBe("t5");
  });
});
