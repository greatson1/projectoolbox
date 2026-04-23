/**
 * Sentiment Analyzer — Claude Haiku-powered sentiment extraction.
 *
 * Cheap (~$0.0001 per call), fast (<1s), returns structured:
 *   { label: "positive|neutral|concerned|negative", score: -1..1, confidence: 0..1 }
 *
 * Falls back to keyword-based classifier if ANTHROPIC_API_KEY missing.
 */

export interface SentimentResult {
  label: "positive" | "neutral" | "concerned" | "negative";
  score: number;       // -1 (very negative) to +1 (very positive)
  confidence: number;  // 0 to 1
  summary?: string;    // one-line summary if text was long
}

const LABELS = ["positive", "neutral", "concerned", "negative"] as const;

/** Quick keyword-based fallback when LLM unavailable. */
export function keywordSentiment(text: string): SentimentResult {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return { label: "neutral", score: 0, confidence: 0 };

  const positive = ["approved", "great", "excellent", "happy", "pleased", "thank", "perfect", "well done", "love it", "go ahead", "looks good", "lgtm", "agreed"];
  const negative = ["rejected", "angry", "furious", "terrible", "awful", "disappointed", "unacceptable", "not happy", "disgusted", "horrible", "unreasonable", "fuming"];
  const concerned = ["concerned", "worried", "uncertain", "unsure", "hesitant", "doubt", "not confident", "risky", "careful", "issue", "problem", "concern"];

  let pos = 0, neg = 0, worry = 0;
  for (const w of positive) if (t.includes(w)) pos++;
  for (const w of negative) if (t.includes(w)) neg++;
  for (const w of concerned) if (t.includes(w)) worry++;

  const total = pos + neg + worry;
  if (total === 0) return { label: "neutral", score: 0, confidence: 0.3 };

  if (neg > pos && neg > worry) return { label: "negative", score: -0.7, confidence: 0.5 };
  if (worry > pos) return { label: "concerned", score: -0.3, confidence: 0.5 };
  if (pos > neg && pos > worry) return { label: "positive", score: 0.7, confidence: 0.5 };
  return { label: "neutral", score: 0, confidence: 0.4 };
}

/** Call Claude Haiku to classify sentiment. */
export async function analyzeSentiment(text: string, context?: string): Promise<SentimentResult> {
  if (!text || text.trim().length < 3) {
    return { label: "neutral", score: 0, confidence: 0 };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return keywordSentiment(text);

  try {
    const prompt = `You are a sentiment classifier for business communications${context ? ` (${context})` : ""}. Classify the sentiment of the following text. Respond ONLY with valid JSON matching this schema:
{"label": "positive"|"neutral"|"concerned"|"negative", "score": -1 to 1, "confidence": 0 to 1}

- "positive": happy, enthusiastic, approving, grateful
- "neutral": factual, informational, no strong emotion
- "concerned": worried, uncertain, hesitant, questioning
- "negative": angry, frustrated, disappointed, rejecting

Text:
"""
${text.slice(0, 2000)}
"""

Return ONLY the JSON object, no other text.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return keywordSentiment(text);
    const data = await response.json();
    const content = data.content?.[0]?.text || "";

    // Extract JSON
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return keywordSentiment(text);
    const parsed = JSON.parse(match[0]);

    if (!LABELS.includes(parsed.label)) return keywordSentiment(text);
    return {
      label: parsed.label,
      score: Math.max(-1, Math.min(1, Number(parsed.score) || 0)),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
    };
  } catch (e) {
    console.error("[sentiment] analyze failed, falling back to keywords:", e);
    return keywordSentiment(text);
  }
}

/** Analyze multiple texts in a single Claude call (batch for efficiency). */
export async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await analyzeSentiment(texts[0])];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return texts.map(keywordSentiment);

  try {
    const numbered = texts.map((t, i) => `[${i + 1}] ${t.slice(0, 800)}`).join("\n\n---\n\n");
    const prompt = `Classify the sentiment of each of the following ${texts.length} texts. Respond with a JSON array where each element is {"label": "positive"|"neutral"|"concerned"|"negative", "score": -1 to 1, "confidence": 0 to 1}.

Texts:
${numbered}

Return ONLY a JSON array of ${texts.length} objects, no other text.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return texts.map(keywordSentiment);
    const data = await response.json();
    const content = data.content?.[0]?.text || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return texts.map(keywordSentiment);
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return texts.map(keywordSentiment);
    return parsed.map((p: any): SentimentResult => ({
      label: LABELS.includes(p.label) ? p.label : "neutral",
      score: Math.max(-1, Math.min(1, Number(p.score) || 0)),
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0.7)),
    }));
  } catch (e) {
    console.error("[sentiment] batch failed:", e);
    return texts.map(keywordSentiment);
  }
}
