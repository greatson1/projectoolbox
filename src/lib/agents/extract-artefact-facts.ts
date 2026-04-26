/**
 * Extract structured facts from artefact prose via a single Haiku call.
 *
 * The Project Charter and Business Case prose may contain budget figures,
 * dates, sponsor names that are not present in the Project row or
 * Stakeholder table. Without extraction, downstream artefact prompts only
 * see a 600-char preview of the Charter (artefact-learning.ts), which can
 * easily lose the budget figure. With extraction, those facts are written
 * to the artefact's metadata.extractedFacts and surfaced via the
 * confirmed-facts module — guaranteeing every later prompt sees them.
 */

import { db } from "@/lib/db";

interface ExtractedFacts {
  budget?: number;
  startDate?: string; // ISO yyyy-mm-dd
  endDate?: string;
  sponsor?: string;
  projectManager?: string;
  scope?: string;
  successCriteria?: string;
}

/** Strip HTML to plain text. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Run extraction on an approved artefact and persist results to its
 * metadata.extractedFacts. Idempotent — safe to call repeatedly. Cheap
 * (one Haiku call, few-hundred tokens).
 */
export async function extractAndPersistArtefactFacts(artefactId: string): Promise<ExtractedFacts | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const artefact = await db.agentArtefact.findUnique({
    where: { id: artefactId },
    select: { id: true, name: true, content: true, metadata: true },
  });
  if (!artefact) return null;

  // Only run for artefacts whose name matches the system-of-record set.
  // Other artefacts produce noise (e.g. a Risk Register's "scope" is a
  // different concept than the project scope).
  const SOR_ARTEFACTS = ["charter", "business case", "project brief", "scope statement", "project initiation document", "pid"];
  const nameLower = artefact.name.toLowerCase();
  if (!SOR_ARTEFACTS.some(s => nameLower.includes(s))) return null;

  const text = stripHtml(artefact.content || "").slice(0, 8000);
  if (text.length < 100) return null;

  const prompt = `Extract structured project facts from this approved project document. Return ONLY a JSON object with the keys you find evidence for; OMIT any key you can't confidently extract — do NOT guess.

Allowed keys (omit any not clearly present):
- budget: number (just the figure, no currency)
- startDate: ISO date "yyyy-mm-dd"
- endDate: ISO date "yyyy-mm-dd"
- sponsor: string (full name only)
- projectManager: string (full name only)
- scope: string (one short paragraph, max 240 chars)
- successCriteria: string (one short paragraph, max 240 chars)

DOCUMENT:
${text}

Respond with ONLY the JSON object, no preamble.`;

  let parsed: ExtractedFacts = {};
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const txt = (data.content?.[0]?.text || "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    parsed = JSON.parse(m[0]);
  } catch (e) {
    console.error("[extract-artefact-facts] LLM call failed:", e);
    return null;
  }

  // Validate
  const cleaned: ExtractedFacts = {};
  if (typeof parsed.budget === "number" && parsed.budget > 0) cleaned.budget = parsed.budget;
  if (typeof parsed.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.startDate)) cleaned.startDate = parsed.startDate;
  if (typeof parsed.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.endDate)) cleaned.endDate = parsed.endDate;
  if (typeof parsed.sponsor === "string" && parsed.sponsor.length > 1 && parsed.sponsor.length <= 80) cleaned.sponsor = parsed.sponsor.trim();
  if (typeof parsed.projectManager === "string" && parsed.projectManager.length > 1 && parsed.projectManager.length <= 80) cleaned.projectManager = parsed.projectManager.trim();
  if (typeof parsed.scope === "string" && parsed.scope.length > 5) cleaned.scope = parsed.scope.slice(0, 240).trim();
  if (typeof parsed.successCriteria === "string" && parsed.successCriteria.length > 5) cleaned.successCriteria = parsed.successCriteria.slice(0, 240).trim();

  // Persist to artefact.metadata.extractedFacts
  const existingMeta = (artefact.metadata as any) || {};
  await db.agentArtefact.update({
    where: { id: artefact.id },
    data: {
      metadata: { ...existingMeta, extractedFacts: cleaned, factsExtractedAt: new Date().toISOString() } as any,
    },
  }).catch(() => {});

  return cleaned;
}
