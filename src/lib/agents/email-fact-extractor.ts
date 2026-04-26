/**
 * Pull atomic project facts out of an inbound email body via Claude Haiku.
 *
 * The verification gate previously asked the user to confirm "the email"
 * as a whole — but a single email can contain several distinct claims
 * (a deadline change, a sponsor swap, a budget tweak). Extracting them
 * lets the verification card surface each claim explicitly so the user
 * can see what would change.
 *
 * Pure module: takes the email + a small project context (name +
 * description), returns a list of facts. The LLM call is wrapped in a
 * fetcher so tests can mock it.
 */

export interface ExtractedFact {
  /** Short, atomic claim — one sentence, in the email's own voice. */
  claim: string;
  /** Category hint — used for KB tags. */
  category: "deadline" | "budget" | "stakeholder" | "scope" | "risk" | "decision" | "other";
  /** Optional verbatim quote from the email body that supports this claim. */
  quote?: string;
}

export interface ExtractEmailFactsInput {
  subject: string;
  body: string;
  senderEmail: string;
  projectName?: string;
  projectDescription?: string;
}

const MAX_BODY = 6000; // truncate aggressively — Haiku context is enough

const SYSTEM_PROMPT = `You extract atomic project facts from inbound emails so a project manager can confirm or reject each one before it changes the project record.

Rules:
- One fact per claim. If the email says two things, return two facts.
- Quote or paraphrase faithfully. Do NOT infer beyond what is written.
- Skip pleasantries, signatures, marketing, and generic context.
- If the email contains zero project-changing claims (e.g. it's an OOO autoreply, a marketing newsletter, or just a thank-you note), return [].
- Output STRICT JSON: {"facts":[{"claim":"...","category":"...","quote":"..."}]}
- Allowed categories: deadline, budget, stakeholder, scope, risk, decision, other.
- Keep each claim under 160 characters.
- The "quote" field is optional — only include it when there is a direct verbatim sentence from the email that supports the claim.`;

/** Function-shaped fetcher so tests can inject a mock. */
export type ChatCompletionFetcher = (prompt: string, system: string) => Promise<string>;

const liveFetcher: ChatCompletionFetcher = async (prompt, system) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return (data?.content?.[0]?.text || "").trim();
};

function buildPrompt(input: ExtractEmailFactsInput): string {
  const trimmedBody = input.body.length > MAX_BODY
    ? input.body.slice(0, MAX_BODY) + "\n…(truncated)"
    : input.body;
  const projectBlock = input.projectName
    ? `Project: ${input.projectName}${input.projectDescription ? `\nDescription: ${input.projectDescription.slice(0, 400)}` : ""}\n\n`
    : "";
  return `${projectBlock}Email subject: ${input.subject}
From: ${input.senderEmail}

${trimmedBody}`;
}

/**
 * Best-effort JSON parse of Claude's reply. Tolerates leading/trailing
 * prose ("Here are the facts:" type intros) by extracting the first
 * {...} block. Returns [] on any parse error.
 */
export function parseFactsResponse(raw: string): ExtractedFact[] {
  if (!raw) return [];
  // Find the first JSON object in the response
  const match = raw.match(/\{[\s\S]*\}/);
  const json = match ? match[0] : raw;
  try {
    const parsed = JSON.parse(json);
    const arr: unknown = parsed?.facts;
    if (!Array.isArray(arr)) return [];
    const out: ExtractedFact[] = [];
    for (const f of arr) {
      if (typeof f !== "object" || f === null) continue;
      const claim = typeof (f as any).claim === "string" ? (f as any).claim.trim() : "";
      if (!claim) continue;
      const rawCat = String((f as any).category || "other").toLowerCase();
      const category: ExtractedFact["category"] = (
        ["deadline", "budget", "stakeholder", "scope", "risk", "decision", "other"] as const
      ).includes(rawCat as any) ? (rawCat as ExtractedFact["category"]) : "other";
      const quote = typeof (f as any).quote === "string" ? (f as any).quote.trim() || undefined : undefined;
      // Cap claim length defensively even if model went over
      out.push({ claim: claim.slice(0, 200), category, quote });
    }
    // Dedupe by claim text (case-insensitive)
    const seen = new Set<string>();
    return out.filter(f => {
      const k = f.claim.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch {
    return [];
  }
}

/**
 * Run extraction against the live API (or a mocked fetcher in tests).
 * Returns [] on any failure — never throws — so the webhook can fall
 * back to whole-email verification gracefully.
 */
export async function extractEmailFacts(
  input: ExtractEmailFactsInput,
  fetcher: ChatCompletionFetcher = liveFetcher,
): Promise<ExtractedFact[]> {
  try {
    const reply = await fetcher(buildPrompt(input), SYSTEM_PROMPT);
    return parseFactsResponse(reply);
  } catch (e) {
    console.error("[email-fact-extractor] extraction failed:", e);
    return [];
  }
}
