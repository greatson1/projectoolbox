/**
 * Similar Projects — Vector Similarity
 *
 * Embed each project (description + category + methodology) via OpenAI's
 * text-embedding-3-small (1536 dims, cheap). Store in ProjectEmbedding.
 * On query, compute cosine similarity between the target project and all
 * other org projects; return top-K matches with their outcomes so the user
 * can see what went well/wrong in past similar work.
 */

import { db } from "@/lib/db";
import { getMethodologyLabel } from "@/lib/methodology-definitions";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

/** Build the input text that represents a project for embedding. */
export function buildProjectText(project: {
  name: string;
  description?: string | null;
  category?: string | null;
  methodology?: string | null;
  budget?: number | null;
}): string {
  const parts: string[] = [];
  parts.push(`Project: ${project.name}`);
  if (project.category) parts.push(`Category: ${project.category}`);
  if (project.methodology) parts.push(`Methodology: ${getMethodologyLabel(project.methodology)}`);
  if (project.budget) parts.push(`Budget: £${project.budget.toLocaleString()}`);
  if (project.description) parts.push(`Description: ${project.description}`);
  return parts.join("\n");
}

/** Call OpenAI embedding API. Returns 1536-dim vector. */
async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured for embeddings");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // truncate to stay under token limit
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.data[0].embedding;
}

// ── Lexical fallback ─────────────────────────────────────────────────────────
// The embedding provider can be unavailable (the OpenAI key spent weeks in
// 429 insufficient_quota and every similarity feature silently returned []).
// Token-overlap similarity over the same project text is a serviceable
// stand-in: deterministic, free, and good enough to surface "you ran a
// project like this before". Used automatically whenever embed() fails.

const LEXICAL_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by",
  "at", "is", "are", "was", "were", "be", "this", "that", "it", "its", "as",
  "project", "description", "category", "methodology", "budget",
]);

function tokenise(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !LEXICAL_STOPWORDS.has(w)),
  );
}

function lexicalSimilarity(a: string, b: string): number {
  const ta = tokenise(a);
  const tb = tokenise(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  return overlap / Math.min(ta.size, tb.size); // overlap coefficient — robust to length imbalance
}

async function findSimilarLexical(
  orgId: string,
  targetText: string,
  excludeProjectId: string | null,
  k: number,
): Promise<SimilarProject[]> {
  const projects = await db.project.findMany({
    where: { orgId, ...(excludeProjectId ? { id: { not: excludeProjectId } } : {}) },
    select: { id: true, name: true, description: true, category: true, methodology: true, budget: true, status: true },
    take: 200,
  }).catch(() => []);
  const scored = projects
    .map((p) => ({ p, similarity: lexicalSimilarity(targetText, buildProjectText(p)) }))
    .filter((s) => s.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
  return scored.map(({ p, similarity }) => ({
    projectId: p.id,
    name: p.name,
    similarity: Math.round(similarity * 100) / 100,
    category: p.category,
    methodology: p.methodology,
    status: p.status,
    health: null,
  }));
}

/**
 * Generate or refresh embedding for one project.
 * @returns true when an embedding was written; false when the provider is
 *          unavailable (callers should use the lexical fallback).
 */
export async function upsertProjectEmbedding(projectId: string): Promise<boolean> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true, name: true, description: true, category: true, methodology: true, budget: true },
  });
  if (!project) return false;

  const text = buildProjectText(project);

  let embedding: number[];
  try {
    embedding = await embed(text);
  } catch (e) {
    console.warn(`[similar-projects] embeddings unavailable for ${projectId} (${(e as any)?.message?.slice(0, 120)}) — lexical fallback will be used`);
    return false;
  }

  try {
    await db.projectEmbedding.upsert({
      where: { projectId },
      update: {
        embedding: embedding as any,
        sourceText: text,
        model: EMBEDDING_MODEL,
        dims: EMBEDDING_DIMS,
      },
      create: {
        orgId: project.orgId,
        projectId,
        embedding: embedding as any,
        sourceText: text,
        model: EMBEDDING_MODEL,
        dims: EMBEDDING_DIMS,
      },
    });
  } catch (e) {
    // ProjectEmbedding table may not exist yet — fail gracefully
    console.error(`[similar-projects] upsert failed for ${projectId}:`, e);
    return false;
  }
  return true;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export interface SimilarProject {
  projectId: string;
  name: string;
  similarity: number; // 0..1
  category?: string | null;
  methodology?: string | null;
  status?: string | null;
  health?: string | null;
}

/** Find top-K similar projects in the same org. */
export async function findSimilarProjects(
  targetProjectId: string,
  k: number = 5,
): Promise<SimilarProject[]> {
  const target = await db.projectEmbedding.findUnique({
    where: { projectId: targetProjectId },
    select: { embedding: true, orgId: true },
  }).catch(() => null);

  if (!target) {
    // No embedding yet — generate one synchronously then retry
    const written = await upsertProjectEmbedding(targetProjectId);
    if (!written) {
      // Embedding provider down/unfunded — lexical fallback instead of [].
      const project = await db.project.findUnique({
        where: { id: targetProjectId },
        select: { orgId: true, name: true, description: true, category: true, methodology: true, budget: true },
      });
      if (!project?.orgId) return [];
      return findSimilarLexical(project.orgId, buildProjectText(project), targetProjectId, k);
    }
    const fresh = await db.projectEmbedding.findUnique({
      where: { projectId: targetProjectId },
      select: { embedding: true, orgId: true },
    }).catch(() => null);
    if (!fresh) return [];
    return findSimilarProjects(targetProjectId, k);
  }

  const targetVec = target.embedding as unknown as number[];
  if (!Array.isArray(targetVec)) return [];

  const candidates = await db.projectEmbedding.findMany({
    where: { orgId: target.orgId, projectId: { not: targetProjectId } },
    select: { projectId: true, embedding: true },
  }).catch(() => []);

  const scored = candidates.map((c) => ({
    projectId: c.projectId,
    similarity: cosineSimilarity(targetVec, c.embedding as unknown as number[]),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, k);
  if (top.length === 0) return [];

  // Enrich with project metadata
  const projects = await db.project.findMany({
    where: { id: { in: top.map((t) => t.projectId) } },
    select: { id: true, name: true, category: true, methodology: true, status: true },
  });

  return top.map((t) => {
    const p = projects.find((pr) => pr.id === t.projectId);
    return {
      projectId: t.projectId,
      name: p?.name || "Unknown project",
      similarity: Math.round(t.similarity * 100) / 100,
      category: p?.category,
      methodology: p?.methodology,
      status: p?.status,
      health: null,
    };
  });
}

/** Find similar projects for a free-text input (deploy wizard preview). */
export async function findSimilarByText(
  orgId: string,
  input: { name?: string; description?: string; category?: string; methodology?: string },
  k: number = 5,
): Promise<SimilarProject[]> {
  const text = buildProjectText({
    name: input.name || "New project",
    description: input.description,
    category: input.category,
    methodology: input.methodology,
    budget: null,
  });

  let targetVec: number[];
  try {
    targetVec = await embed(text);
  } catch (e) {
    console.warn(`[similar-projects] embeddings unavailable for text query (${(e as any)?.message?.slice(0, 120)}) — lexical fallback`);
    return findSimilarLexical(orgId, text, null, k);
  }

  const candidates = await db.projectEmbedding.findMany({
    where: { orgId },
    select: { projectId: true, embedding: true },
  }).catch(() => []);

  if (candidates.length === 0) return findSimilarLexical(orgId, text, null, k);

  const scored = candidates.map((c) => ({
    projectId: c.projectId,
    similarity: cosineSimilarity(targetVec, c.embedding as unknown as number[]),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, k);

  const projects = await db.project.findMany({
    where: { id: { in: top.map((t) => t.projectId) } },
    select: { id: true, name: true, category: true, methodology: true, status: true },
  });

  return top.map((t) => {
    const p = projects.find((pr) => pr.id === t.projectId);
    return {
      projectId: t.projectId,
      name: p?.name || "Unknown project",
      similarity: Math.round(t.similarity * 100) / 100,
      category: p?.category,
      methodology: p?.methodology,
      status: p?.status,
      health: null,
    };
  });
}
