import { describe, it, expect } from "vitest";
import {
  classifyTBCTopic,
  isTopicAppropriateForArtefact,
  filterTBCItemsByArtefactPurpose,
} from "./tbc-topic-filter";

describe("classifyTBCTopic", () => {
  it("classes person-hint topics as person", () => {
    expect(classifyTBCTopic("compliance lead")).toBe("person");
    expect(classifyTBCTopic("devops lead")).toBe("person");
    expect(classifyTBCTopic("project sponsor")).toBe("person");
    expect(classifyTBCTopic("risk owner")).toBe("person");
  });

  it("classes date-hint topics as date", () => {
    expect(classifyTBCTopic("kickoff date")).toBe("date");
    expect(classifyTBCTopic("go-live date")).toBe("date");
    expect(classifyTBCTopic("phase deadline")).toBe("date");
  });

  it("classes money / quantity topics as amount", () => {
    expect(classifyTBCTopic("training budget")).toBe("amount");
    expect(classifyTBCTopic("team size")).toBe("amount");
    expect(classifyTBCTopic("headcount")).toBe("amount");
  });

  it("classes vendor topics as vendor", () => {
    expect(classifyTBCTopic("hotel name")).toBe("vendor");
    expect(classifyTBCTopic("supplier")).toBe("vendor");
    expect(classifyTBCTopic("training provider")).toBe("vendor");
  });

  it("classes criteria / threshold topics as criteria", () => {
    expect(classifyTBCTopic("acceptance criteria")).toBe("criteria");
    expect(classifyTBCTopic("test coverage threshold")).toBe("amount"); // threshold + coverage — amount wins
    expect(classifyTBCTopic("sla")).toBe("criteria");
  });

  it("classes yes/no topics as yesno", () => {
    expect(classifyTBCTopic("visa booked")).toBe("yesno");
    expect(classifyTBCTopic("contract signed")).toBe("yesno");
  });

  it("falls through to 'other' for unrecognised topics", () => {
    expect(classifyTBCTopic("training topic")).toBe("other");
    expect(classifyTBCTopic("scenario name")).toBe("person"); // 'name' is a person hint
  });
});

describe("isTopicAppropriateForArtefact — Definition of Done", () => {
  it("DROPS person TBCs in DoD (the screenshot bug)", () => {
    expect(isTopicAppropriateForArtefact("Definition of Done", "compliance lead")).toBe(false);
    expect(isTopicAppropriateForArtefact("Definition of Done", "devops lead")).toBe(false);
    expect(isTopicAppropriateForArtefact("Definition of Done", "risk owner")).toBe(false);
  });

  it("KEEPS criteria TBCs in DoD", () => {
    expect(isTopicAppropriateForArtefact("Definition of Done", "acceptance criteria")).toBe(true);
    expect(isTopicAppropriateForArtefact("Definition of Done", "test coverage threshold")).toBe(true);
  });

  it("DROPS date TBCs in DoD (DoD is a checklist, not a schedule)", () => {
    expect(isTopicAppropriateForArtefact("Definition of Done", "kickoff date")).toBe(false);
  });

  it("KEEPS amount TBCs in DoD (thresholds like '80% test coverage')", () => {
    expect(isTopicAppropriateForArtefact("Definition of Done", "code coverage threshold")).toBe(true);
  });
});

describe("isTopicAppropriateForArtefact — Product Backlog", () => {
  it("DROPS every TBC class — backlog is populated incrementally", () => {
    expect(isTopicAppropriateForArtefact("Product Backlog", "sponsor")).toBe(false);
    expect(isTopicAppropriateForArtefact("Initial Product Backlog", "go-live date")).toBe(false);
    expect(isTopicAppropriateForArtefact("Sprint Backlog", "team size")).toBe(false);
  });
});

describe("isTopicAppropriateForArtefact — Stakeholder Register", () => {
  it("KEEPS person TBCs (the artefact is literally about people)", () => {
    expect(isTopicAppropriateForArtefact("Stakeholder Register", "compliance lead")).toBe(true);
    expect(isTopicAppropriateForArtefact("Initial Stakeholder Register", "sponsor")).toBe(true);
  });

  it("DROPS amount TBCs (e.g. 'team size' doesn't belong in stakeholder register)", () => {
    expect(isTopicAppropriateForArtefact("Stakeholder Register", "team size")).toBe(false);
  });
});

describe("isTopicAppropriateForArtefact — Project Charter / broad plans", () => {
  it("KEEPS most TBC classes (broad scope)", () => {
    expect(isTopicAppropriateForArtefact("Project Charter", "sponsor")).toBe(true);
    expect(isTopicAppropriateForArtefact("Project Charter", "kickoff date")).toBe(true);
    expect(isTopicAppropriateForArtefact("Project Charter", "training budget")).toBe(true);
    expect(isTopicAppropriateForArtefact("Outline Business Case", "supplier")).toBe(true);
  });
});

describe("isTopicAppropriateForArtefact — unrecognised artefact", () => {
  it("KEEPS everything (default-allow when no rule matches)", () => {
    expect(isTopicAppropriateForArtefact("Some Custom Artefact", "anything goes")).toBe(true);
    expect(isTopicAppropriateForArtefact("Some Custom Artefact", "compliance lead")).toBe(true);
  });
});

describe("filterTBCItemsByArtefactPurpose — batch filter", () => {
  it("separates kept from dropped with reasons", () => {
    const items = [
      { artefactName: "Definition of Done", item: "compliance lead" },   // drop (person)
      { artefactName: "Definition of Done", item: "test coverage threshold" }, // keep
      { artefactName: "Stakeholder Register", item: "sponsor" },          // keep
      { artefactName: "Stakeholder Register", item: "team size" },        // drop (amount)
      { artefactName: "Project Charter", item: "kickoff date" },          // keep
    ];
    const { kept, dropped } = filterTBCItemsByArtefactPurpose(items);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(2);
    expect(dropped[0].topicClass).toBe("person");
    expect(dropped[1].topicClass).toBe("amount");
  });

  it("returns empty kept when every TBC is misplaced", () => {
    const items = [
      { artefactName: "Definition of Done", item: "compliance lead" },
      { artefactName: "Definition of Done", item: "kickoff date" },
    ];
    const { kept, dropped } = filterTBCItemsByArtefactPurpose(items);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(2);
  });
});
