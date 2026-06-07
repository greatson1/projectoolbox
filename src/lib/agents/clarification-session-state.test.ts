import { describe, it, expect } from "vitest";
import { sessionHasUnansweredQuestions } from "./clarification-session-state";

describe("sessionHasUnansweredQuestions", () => {
  it("returns true when ≥1 question is unanswered — the source of truth for 'still pending'", () => {
    const content = JSON.stringify({
      sessionId: "cs_1", status: "active",
      questions: [
        { id: "q1", text: "Sponsor?", answered: true },
        { id: "q2", text: "Budget?", answered: false },
        { id: "q3", text: "Deadline?", answered: true },
      ],
    });
    expect(sessionHasUnansweredQuestions(content)).toBe(true);
  });

  it("returns true when answered is missing (treated as not answered)", () => {
    const content = JSON.stringify({
      sessionId: "cs_2",
      questions: [{ id: "q1", text: "Sponsor?" }],
    });
    expect(sessionHasUnansweredQuestions(content)).toBe(true);
  });

  it("returns false when every question is answered", () => {
    const content = JSON.stringify({
      questions: [
        { id: "q1", answered: true },
        { id: "q2", answered: true },
      ],
    });
    expect(sessionHasUnansweredQuestions(content)).toBe(false);
  });

  it("returns false on empty questions array", () => {
    expect(sessionHasUnansweredQuestions(JSON.stringify({ questions: [] }))).toBe(false);
  });

  it("returns false on null / undefined / empty content", () => {
    expect(sessionHasUnansweredQuestions(null)).toBe(false);
    expect(sessionHasUnansweredQuestions(undefined)).toBe(false);
    expect(sessionHasUnansweredQuestions("")).toBe(false);
  });

  it("returns false on malformed JSON — caller falls back to its heuristic", () => {
    expect(sessionHasUnansweredQuestions("{not json")).toBe(false);
    expect(sessionHasUnansweredQuestions("null")).toBe(false);
    expect(sessionHasUnansweredQuestions('"a string"')).toBe(false);
  });

  it("returns false when content is JSON but not the expected shape", () => {
    expect(sessionHasUnansweredQuestions(JSON.stringify({ foo: "bar" }))).toBe(false);
    expect(sessionHasUnansweredQuestions(JSON.stringify({ questions: "not an array" }))).toBe(false);
  });
});
