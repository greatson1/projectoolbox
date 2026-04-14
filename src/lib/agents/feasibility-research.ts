/**
 * Feasibility Research — first step after agent deployment.
 *
 * Before generating any artefacts or asking questions, the agent researches
 * the project context using Perplexity AI. This builds a foundational
 * knowledge base so that:
 *   1. Clarification questions are smarter (informed by real-world context)
 *   2. Artefacts are grounded in actual data, not generic templates
 *   3. Risks, costs, and stakeholder considerations are evidence-based
 *
 * Flow: Deploy → Research (this module) → Clarification Questions → Generate Artefacts
 */

import { db } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ResearchResult {
  factsDiscovered: number;
  queries: string[];
  summary: string;
}

interface ProjectContext {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  budget: number | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  methodology: string | null;
}

// ─── Perplexity API ──────────────────────────────────────────────────────────

async function queryPerplexity(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "system",
          content: "You are a project management research assistant. Provide specific, factual, actionable information. Include real costs, timelines, regulations, and requirements where available. Always cite sources. Be concise — bullet points preferred over paragraphs.",
        },
        { role: "user", content: query },
      ],
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "unknown");
    throw new Error(`Perplexity API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Research Query Builder ──────────────────────────────────────────────────

function buildResearchQueries(project: ProjectContext): string[] {
  const name = project.name || "the project";
  const desc = project.description || "";
  const category = (project.category || "general").toLowerCase();
  const budget = project.budget ? `£${project.budget.toLocaleString()}` : null;

  const queries: string[] = [];

  // Query 1: Core feasibility — what does this type of project actually involve?
  queries.push(
    `What are the key requirements, typical costs, common risks, and timeline considerations for: "${name}"? ${desc ? `Context: ${desc.slice(0, 300)}` : ""} ${budget ? `Budget: ${budget}.` : ""} Provide specific actionable details, not generic advice.`
  );

  // Query 2: Category-specific research
  if (category === "travel" || desc.toLowerCase().includes("trip") || desc.toLowerCase().includes("travel")) {
    const destination = extractDestination(desc);
    queries.push(
      `Travel planning requirements for ${destination || name}: visa requirements, health/vaccination requirements, typical accommodation costs, transport options, safety considerations, local regulations, and cultural considerations. Focus on practical logistics.`
    );
  } else if (category === "training" || desc.toLowerCase().includes("training") || desc.toLowerCase().includes("course")) {
    queries.push(
      `Best practices for organising ${name}: venue requirements, typical costs per attendee, materials needed, scheduling considerations, evaluation methods, and certification requirements if applicable. ${budget ? `Budget: ${budget}.` : ""}`
    );
  } else if (category === "event" || desc.toLowerCase().includes("event") || desc.toLowerCase().includes("conference")) {
    queries.push(
      `Event planning requirements for ${name}: venue capacity and costs, catering considerations, AV requirements, registration process, health and safety requirements, insurance needs. ${budget ? `Budget: ${budget}.` : ""}`
    );
  } else if (category === "construction" || desc.toLowerCase().includes("build") || desc.toLowerCase().includes("renovation")) {
    queries.push(
      `Construction/renovation project requirements for ${name}: planning permissions needed, typical contractor costs, building regulations, timeline expectations, common risks and delays, insurance requirements.`
    );
  } else if (category === "it" || category === "software" || desc.toLowerCase().includes("software") || desc.toLowerCase().includes("app") || desc.toLowerCase().includes("system")) {
    queries.push(
      `Software/IT project considerations for ${name}: technology stack options, typical development timelines, infrastructure requirements, security considerations, testing approach, deployment strategy. ${budget ? `Budget: ${budget}.` : ""}`
    );
  } else {
    queries.push(
      `Key success factors, common pitfalls, and industry benchmarks for projects similar to: "${name}". ${desc ? `Description: ${desc.slice(0, 300)}` : ""} What should a project manager be aware of?`
    );
  }

  // Query 3: Regulatory/compliance (always useful)
  queries.push(
    `What UK regulations, compliance requirements, or legal considerations apply to: "${name}"? ${desc ? `Context: ${desc.slice(0, 200)}` : ""} Include any permits, certifications, insurance, or health & safety requirements.`
  );

  return queries;
}

function extractDestination(description: string): string | null {
  // Simple extraction of destination from description
  const patterns = [
    /(?:to|in|at|visiting)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:trip|travel|visit|holiday)/,
  ];
  for (const p of patterns) {
    const match = description.match(p);
    if (match) return match[1];
  }
  return null;
}

// ─── Fact Extraction ─────────────────────────────────────────────────────────

async function extractAndStoreFacts(
  agentId: string,
  projectId: string,
  orgId: string,
  researchText: string,
  queryLabel: string,
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY || !researchText.trim()) return 0;

  // Use Claude to extract structured facts from the research
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: `Extract the key facts from this research that would be useful for project planning. Return ONLY a JSON array of objects with "title" and "content" fields. Title should be a short label (2-5 words), content should be the specific detail.

Only include facts that are:
- Specific and actionable (not generic advice)
- Relevant to project planning, budgeting, risk management, or logistics
- Based on the research data (not your own knowledge)

Research text:
${researchText.slice(0, 4000)}

Return ONLY the JSON array, no other text.`,
      }],
    }),
  });

  if (!response.ok) return 0;

  const data = await response.json();
  const text = data.content?.[0]?.text || "";

  let facts: Array<{ title: string; content: string }> = [];
  try {
    // Extract JSON array — handle cases where Claude wraps in markdown
    const jsonStr = text.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    facts = JSON.parse(jsonStr);
    if (!Array.isArray(facts)) facts = [];
  } catch {
    return 0;
  }

  // Store each fact to KB
  let stored = 0;
  for (const fact of facts.slice(0, 20)) { // Cap at 20 facts per query
    if (!fact.title || !fact.content) continue;
    try {
      const existing = await db.knowledgeBaseItem.findFirst({
        where: { agentId, projectId, title: fact.title },
        select: { id: true },
      });
      if (existing) continue; // Don't duplicate

      await db.knowledgeBaseItem.create({
        data: {
          orgId,
          agentId,
          projectId,
          layer: "PROJECT",
          type: "TEXT",
          title: fact.title,
          content: `[Research — ${queryLabel}] ${fact.content}`,
          trustLevel: "STANDARD", // Research is STANDARD, not HIGH_TRUST (user hasn't confirmed)
          tags: ["research", "feasibility", "perplexity", queryLabel.toLowerCase().replace(/\s+/g, "_")],
          metadata: { source: "perplexity_research", extractedAt: new Date().toISOString() } as any,
        },
      });
      stored++;
    } catch {}
  }

  return stored;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Run feasibility research for a newly deployed project.
 * Queries Perplexity AI for real-world context, extracts facts, stores to KB.
 * Returns a summary that can be used to inform clarification questions.
 */
export async function runFeasibilityResearch(
  agentId: string,
  projectId: string,
  orgId: string,
): Promise<ResearchResult> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true, category: true, budget: true, startDate: true, endDate: true, methodology: true },
  });
  if (!project) return { factsDiscovered: 0, queries: [], summary: "Project not found" };

  const queries = buildResearchQueries(project as ProjectContext);
  const queryLabels = ["Core feasibility", "Domain-specific research", "Regulatory & compliance"];

  let totalFacts = 0;
  const allResearch: string[] = [];

  for (let i = 0; i < queries.length; i++) {
    try {
      const result = await queryPerplexity(queries[i]);
      if (result) {
        allResearch.push(result);

        // Store the raw research as a KB item too
        await db.knowledgeBaseItem.create({
          data: {
            orgId, agentId, projectId,
            layer: "PROJECT", type: "TEXT",
            title: `Feasibility Research: ${queryLabels[i]}`,
            content: result.slice(0, 5000),
            trustLevel: "STANDARD",
            tags: ["research", "feasibility", "perplexity", "raw_research"],
            metadata: { source: "perplexity", query: queries[i].slice(0, 200), researchedAt: new Date().toISOString() } as any,
          },
        }).catch(() => {});

        // Extract and store individual facts
        const facts = await extractAndStoreFacts(agentId, projectId, orgId, result, queryLabels[i]);
        totalFacts += facts;
      }
    } catch (e) {
      console.error(`[feasibility-research] Query ${i} failed:`, e);
    }
  }

  // Build a compact summary for the clarification session prompt
  const summary = allResearch.length > 0
    ? allResearch.map((r, i) => `### ${queryLabels[i]}\n${r}`).join("\n\n").slice(0, 6000)
    : "No research results available.";

  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Feasibility research complete — ${totalFacts} facts discovered from ${allResearch.length} queries. Knowledge base enriched.`,
    },
  }).catch(() => {});

  return { factsDiscovered: totalFacts, queries, summary };
}
