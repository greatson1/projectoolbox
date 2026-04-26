import { describe, it, expect } from "vitest";
import { parseFactsResponse, extractEmailFacts, type ChatCompletionFetcher } from "./email-fact-extractor";

describe("parseFactsResponse", () => {
  it("parses well-formed JSON", () => {
    const raw = '{"facts":[{"claim":"Deadline moved to 2026-05-10","category":"deadline","quote":"please note the new date"}]}';
    const out = parseFactsResponse(raw);
    expect(out.length).toBe(1);
    expect(out[0].claim).toContain("Deadline moved");
    expect(out[0].category).toBe("deadline");
    expect(out[0].quote).toBe("please note the new date");
  });

  it("strips prose around the JSON", () => {
    const raw = 'Here are the facts I extracted:\n{"facts":[{"claim":"Sponsor changed to Sarah","category":"stakeholder"}]}\n\nHope that helps!';
    const out = parseFactsResponse(raw);
    expect(out.length).toBe(1);
    expect(out[0].category).toBe("stakeholder");
  });

  it("returns [] on empty facts", () => {
    expect(parseFactsResponse('{"facts":[]}')).toEqual([]);
  });

  it("returns [] on malformed JSON", () => {
    expect(parseFactsResponse("not json at all")).toEqual([]);
    expect(parseFactsResponse('{"facts":[{')).toEqual([]);
  });

  it("returns [] on missing facts key", () => {
    expect(parseFactsResponse('{"data":[]}')).toEqual([]);
  });

  it("normalises an unknown category to 'other'", () => {
    const out = parseFactsResponse('{"facts":[{"claim":"x","category":"nonsense"}]}');
    expect(out[0].category).toBe("other");
  });

  it("skips entries with empty claim", () => {
    const out = parseFactsResponse('{"facts":[{"claim":"","category":"budget"},{"claim":"  ","category":"budget"},{"claim":"real one","category":"budget"}]}');
    expect(out.length).toBe(1);
    expect(out[0].claim).toBe("real one");
  });

  it("dedupes case-insensitively on claim", () => {
    const out = parseFactsResponse('{"facts":[{"claim":"Budget +5k","category":"budget"},{"claim":"BUDGET +5k","category":"budget"}]}');
    expect(out.length).toBe(1);
  });

  it("caps claim length to 200 chars", () => {
    const long = "x".repeat(500);
    const out = parseFactsResponse(JSON.stringify({ facts: [{ claim: long, category: "other" }] }));
    expect(out[0].claim.length).toBe(200);
  });
});

describe("extractEmailFacts", () => {
  it("returns parsed facts when the fetcher succeeds", async () => {
    const mock: ChatCompletionFetcher = async () =>
      '{"facts":[{"claim":"Kickoff moved to Monday","category":"deadline"}]}';
    const out = await extractEmailFacts({
      subject: "Kickoff",
      body: "Hi, the kickoff is now Monday.",
      senderEmail: "sponsor@x.com",
    }, mock);
    expect(out.length).toBe(1);
    expect(out[0].category).toBe("deadline");
  });

  it("returns [] when the fetcher throws — webhook falls back gracefully", async () => {
    const mock: ChatCompletionFetcher = async () => {
      throw new Error("API down");
    };
    const out = await extractEmailFacts({
      subject: "Kickoff",
      body: "Hi",
      senderEmail: "x@y",
    }, mock);
    expect(out).toEqual([]);
  });

  it("returns [] when the fetcher returns garbage", async () => {
    const mock: ChatCompletionFetcher = async () => "I refuse to comply.";
    const out = await extractEmailFacts({
      subject: "x",
      body: "y",
      senderEmail: "z@w",
    }, mock);
    expect(out).toEqual([]);
  });

  it("passes project context into the prompt", async () => {
    let captured = "";
    const mock: ChatCompletionFetcher = async (prompt) => {
      captured = prompt;
      return '{"facts":[]}';
    };
    await extractEmailFacts({
      subject: "Update",
      body: "Hello.",
      senderEmail: "x@y",
      projectName: "Family Trip to Dubai",
      projectDescription: "Seven-day family trip in May 2026",
    }, mock);
    expect(captured).toContain("Family Trip to Dubai");
    expect(captured).toContain("Seven-day family trip");
  });
});
