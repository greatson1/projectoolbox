import { describe, it, expect } from "vitest";
import { phraseTBCQuestionFallback, normalisePersonHintQuestion } from "./phrase-tbc-question";

/**
 * Locks in the deterministic fallback used when the Haiku phrasing pass
 * is unavailable. The fallback has to be good enough on its own — the
 * production flow loses the LLM call whenever the API key is missing or
 * the call fails, and we don't want users to ever see the old dumb
 * "What is the compliance lead?" regression.
 *
 * Each test names the original TBC item and the interrogative + widget
 * type we expect. New lexicon entries should be paired with a test here.
 */

describe("phraseTBCQuestionFallback — person/role topics", () => {
  it("compliance lead → Who + text", () => {
    const r = phraseTBCQuestionFallback("compliance lead");
    expect(r.question).toBe("Who is the compliance lead?");
    expect(r.type).toBe("text");
  });

  it("project sponsor → Who + text", () => {
    expect(phraseTBCQuestionFallback("project sponsor").question).toBe("Who is the project sponsor?");
  });

  it("risk owner → Who + text", () => {
    expect(phraseTBCQuestionFallback("risk owner").question).toBe("Who is the risk owner?");
  });

  it("delivery manager → Who + text", () => {
    expect(phraseTBCQuestionFallback("delivery manager").question).toBe("Who is the delivery manager?");
  });

  it("supplier name → Who + text (named-role variant)", () => {
    const r = phraseTBCQuestionFallback("supplier name");
    expect(r.question).toBe("Who is the supplier name?");
    expect(r.type).toBe("text");
  });

  it("strips leading 'the' so the question doesn't double up", () => {
    expect(phraseTBCQuestionFallback("the security lead").question).toBe("Who is the security lead?");
  });
});

describe("phraseTBCQuestionFallback — date topics", () => {
  it("kickoff date → When + date", () => {
    const r = phraseTBCQuestionFallback("kickoff date");
    expect(r.question).toBe("When is the kickoff date?");
    expect(r.type).toBe("date");
  });

  it("go-live → When + date", () => {
    expect(phraseTBCQuestionFallback("go-live").type).toBe("date");
  });

  it("phase 2 deadline → When + date", () => {
    expect(phraseTBCQuestionFallback("phase 2 deadline").type).toBe("date");
  });
});

describe("phraseTBCQuestionFallback — numeric topics", () => {
  it("team size → How many + number", () => {
    const r = phraseTBCQuestionFallback("team size");
    expect(r.question).toBe("How many team size?");
    expect(r.type).toBe("number");
  });

  it("training budget → What is the X + number (monetary variant)", () => {
    const r = phraseTBCQuestionFallback("training budget");
    expect(r.question).toBe("What is the training budget?");
    expect(r.type).toBe("number");
  });

  it("headcount → number", () => {
    expect(phraseTBCQuestionFallback("headcount").type).toBe("number");
  });
});

describe("phraseTBCQuestionFallback — yes/no topics", () => {
  it("visa required → yesno", () => {
    const r = phraseTBCQuestionFallback("visa required");
    expect(r.question).toBe("Has the visa required been confirmed?");
    expect(r.type).toBe("yesno");
  });

  it("flights booked → yesno", () => {
    expect(phraseTBCQuestionFallback("flights booked").type).toBe("yesno");
  });

  it("contract signed → yesno", () => {
    expect(phraseTBCQuestionFallback("contract signed").type).toBe("yesno");
  });
});

describe("phraseTBCQuestionFallback — fallback path", () => {
  it("an unknown topic gets the generic What is the X? form", () => {
    const r = phraseTBCQuestionFallback("venue address");
    expect(r.question).toBe("What is the venue address?");
    expect(r.type).toBe("text");
  });

  it("training topic → text", () => {
    expect(phraseTBCQuestionFallback("training topic").type).toBe("text");
  });
});

describe("normalisePersonHintQuestion — post-LLM correction", () => {
  it("rewrites 'What is the compliance lead?' → 'Who is the compliance lead?'", () => {
    const r = normalisePersonHintQuestion("What is the compliance lead?", "text");
    expect(r.question).toBe("Who is the compliance lead?");
    expect(r.type).toBe("text");
  });

  it("rewrites 'What is the devops lead?' (the screenshot bug)", () => {
    const r = normalisePersonHintQuestion("What is the devops lead?", "text");
    expect(r.question).toBe("Who is the devops lead?");
  });

  it("rewrites 'What is the project manager?'", () => {
    const r = normalisePersonHintQuestion("What is the project manager?", "text");
    expect(r.question).toBe("Who is the project manager?");
  });

  it("does NOT rewrite non-person 'What is the X' (budget, date, address)", () => {
    expect(normalisePersonHintQuestion("What is the training budget?", "number").question)
      .toBe("What is the training budget?");
    expect(normalisePersonHintQuestion("What is the launch date?", "date").question)
      .toBe("What is the launch date?");
    expect(normalisePersonHintQuestion("What is the venue address?", "text").question)
      .toBe("What is the venue address?");
  });

  it("does NOT rewrite questions that don't start with 'What is the'", () => {
    expect(normalisePersonHintQuestion("Who is the compliance lead?", "text").question)
      .toBe("Who is the compliance lead?");
    expect(normalisePersonHintQuestion("How many team members?", "number").question)
      .toBe("How many team members?");
  });

  it("forces type to 'text' when rewriting a person question", () => {
    // Even if Haiku misclassified the type.
    const r = normalisePersonHintQuestion("What is the risk owner?", "choice");
    expect(r.type).toBe("text");
  });

  it("handles 'the' prefix in the topic without doubling it", () => {
    const r = normalisePersonHintQuestion("What is the the security lead?", "text");
    expect(r.question).toBe("Who is the security lead?");
  });
});
