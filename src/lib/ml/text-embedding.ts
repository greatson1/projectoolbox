/**
 * Generic text embedding utility.
 *
 * Used for short-text semantic matching (e.g. matching a meeting decision to
 * an open task/risk title). Wraps OpenAI's text-embedding-3-small (1536d) and
 * supports batch input so we only pay one round-trip per N strings.
 *
 * Callers MUST handle the "no API key configured" path themselves — this
 * module throws rather than silently returning zeros, so the caller can
 * fall back to keyword matching when embeddings aren't available.
 */

const EMBEDDING_MODEL = "text-embedding-3-small";

export function isEmbeddingsAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  if (inputs.length === 0) return [];

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.data.map((d: any) => d.embedding as number[]);
}

export async function embedText(input: string): Promise<number[]> {
  const [vec] = await embedTexts([input]);
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
