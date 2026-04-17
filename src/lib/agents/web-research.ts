/**
 * Web Research Service — Internet Intelligence
 *
 * Per spec Section 7.3: Agents can access the open internet to gather
 * external intelligence relevant to the project.
 *
 * Uses Perplexity API for: PESTLE scans, news monitoring, stakeholder
 * research, vendor research, and ad-hoc queries.
 *
 * Credit costs:
 *   3 credits — targeted search (specific query)
 *   8 credits — full PESTLE scan
 *   5 credits — stakeholder intelligence profile
 *   5 credits — vendor research report
 *   1 credit  — cached result (7-day cache)
 */

import { db } from "@/lib/db";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

function getApiKey(): string {
  return process.env.PERPLEXITY_API_KEY || "";
}

interface ResearchResult {
  title: string;
  content: string;
  sources: string[];
  cached: boolean;
  creditCost: number;
}

/**
 * Core search function — calls Perplexity API with a structured query.
 */
async function perplexitySearch(query: string, systemPrompt: string): Promise<{ content: string; sources: string[] }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not configured");

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      max_tokens: 2000,
      return_citations: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const sources = data.citations || [];

  return { content, sources };
}

/**
 * Check if a cached result exists (7-day cache per spec).
 */
async function getCachedResult(orgId: string, queryKey: string): Promise<ResearchResult | null> {
  const cached = await db.knowledgeBaseItem.findFirst({
    where: {
      orgId,
      type: "URL",
      title: queryKey,
      cachedUntil: { gte: new Date() },
    },
    select: { title: true, content: true, metadata: true },
  });

  if (cached) {
    return {
      title: cached.title,
      content: cached.content,
      sources: (cached.metadata as any)?.sources || [],
      cached: true,
      creditCost: 1, // Cached results cost 1 credit
    };
  }

  return null;
}

/**
 * Save research result to knowledge base with 7-day cache.
 */
async function cacheResult(
  orgId: string,
  agentId: string | null,
  projectId: string | null,
  title: string,
  content: string,
  sources: string[],
  type: string,
): Promise<void> {
  const cacheExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.knowledgeBaseItem.create({
    data: {
      orgId,
      agentId,
      projectId,
      layer: projectId ? "PROJECT" : "WORKSPACE",
      type: "URL",
      title,
      content,
      tags: [type, "research", "auto-generated"],
      metadata: { sources, researchType: type, generatedAt: new Date().toISOString() },
      cachedUntil: cacheExpiry,
    },
  });
}

// ─── Public Research Functions ───

/**
 * Targeted web search — 3 credits.
 */
export async function targetedSearch(
  query: string,
  context: { orgId: string; agentId?: string; projectId?: string },
): Promise<ResearchResult> {
  const cacheKey = `search:${query.toLowerCase().slice(0, 100)}`;
  const cached = await getCachedResult(context.orgId, cacheKey);
  if (cached) return cached;

  const result = await perplexitySearch(query,
    "You are a project management research assistant. Provide concise, factual findings relevant to project planning and risk management. Include specific data points, dates, and sources.");

  await cacheResult(context.orgId, context.agentId || null, context.projectId || null, cacheKey, result.content, result.sources, "targeted_search");

  return { title: query, content: result.content, sources: result.sources, cached: false, creditCost: 3 };
}

/**
 * Full PESTLE scan — 8 credits.
 * Scans across all 6 PESTLE dimensions for a given project context.
 */
export async function pestleScan(
  projectContext: { name: string; industry?: string; region?: string; technologies?: string[] },
  context: { orgId: string; agentId?: string; projectId?: string },
): Promise<{ findings: PestleFinding[]; summary: string; creditCost: number }> {
  const cacheKey = `pestle:${projectContext.name}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await getCachedResult(context.orgId, cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.content);
      return { findings: parsed.findings || [], summary: parsed.summary || cached.content, creditCost: 1 };
    } catch {
      return { findings: [], summary: cached.content, creditCost: 1 };
    }
  }

  const dimensions = [
    { code: "P", name: "Political", prompt: `Political factors affecting "${projectContext.name}" in ${projectContext.region || "the UK"}: government policy changes, regulations, political stability, trade policies relevant to ${projectContext.industry || "this industry"}.` },
    { code: "E", name: "Economic", prompt: `Economic factors affecting "${projectContext.name}": market conditions, inflation, interest rates, currency risk, sector growth indicators for ${projectContext.industry || "this sector"}.` },
    { code: "S", name: "Social", prompt: `Social factors affecting "${projectContext.name}": workforce trends, demographic changes, cultural factors, skills availability in ${projectContext.industry || "this industry"}.` },
    { code: "T", name: "Technological", prompt: `Technology factors affecting "${projectContext.name}": ${projectContext.technologies?.length ? `specifically around ${projectContext.technologies.join(", ")}` : "technology shifts"}, platform deprecations, new tooling, AI/automation impact.` },
    { code: "L", name: "Legal", prompt: `Legal factors affecting "${projectContext.name}": compliance requirements, data protection (GDPR/UK DPA), employment law, contractual risks, recent legislation changes in ${projectContext.region || "the UK"}.` },
    { code: "E2", name: "Environmental", prompt: `Environmental factors affecting "${projectContext.name}": sustainability requirements, carbon reporting, environmental regulations, ESG considerations for ${projectContext.industry || "this sector"}.` },
  ];

  const findings: PestleFinding[] = [];

  // Run all PESTLE dimensions (single combined query to save API calls)
  const combinedQuery = dimensions.map(d => d.prompt).join("\n\n");
  const result = await perplexitySearch(combinedQuery,
    `You are a PESTLE analysis expert. For each of the 6 dimensions (Political, Economic, Social, Technological, Legal, Environmental), identify 1-3 specific factors that could impact this project. Format each finding as:
[DIMENSION] Finding title: Brief description with specific data or dates.
Rate each finding's impact: LOW, MEDIUM, or HIGH.`);

  // Parse findings from the response
  const lines = result.content.split("\n").filter(l => l.trim());
  let currentDimension = "";

  for (const line of lines) {
    const dimMatch = line.match(/\[(P|E|S|T|L|E2|Political|Economic|Social|Technological|Legal|Environmental)\]/i);
    if (dimMatch) {
      currentDimension = dimMatch[1].charAt(0).toUpperCase();
      if (dimMatch[1].toLowerCase() === "environmental" || dimMatch[1] === "E2") currentDimension = "E (Env)";
    }

    const impactMatch = line.match(/(LOW|MEDIUM|HIGH)/i);
    const impact = impactMatch ? impactMatch[1].toUpperCase() as "LOW" | "MEDIUM" | "HIGH" : "MEDIUM";

    if (line.length > 20 && currentDimension) {
      findings.push({
        dimension: currentDimension,
        title: line.replace(/\[.*?\]/g, "").replace(/(LOW|MEDIUM|HIGH)/gi, "").trim().slice(0, 150),
        description: line.trim(),
        impact,
        sources: result.sources,
      });
    }
  }

  const summary = `PESTLE scan for "${projectContext.name}" identified ${findings.length} factors across ${new Set(findings.map(f => f.dimension)).size} dimensions. ${findings.filter(f => f.impact === "HIGH").length} high-impact factors require attention.`;

  // Cache the result
  await cacheResult(context.orgId, context.agentId || null, context.projectId || null, cacheKey,
    JSON.stringify({ findings, summary }), result.sources, "pestle_scan");

  return { findings, summary, creditCost: 8 };
}

/**
 * Stakeholder intelligence profile — 5 credits.
 */
export async function stakeholderResearch(
  stakeholder: { name: string; organisation?: string; role?: string },
  context: { orgId: string; agentId?: string; projectId?: string },
): Promise<ResearchResult> {
  const cacheKey = `stakeholder:${stakeholder.name.toLowerCase()}`;
  const cached = await getCachedResult(context.orgId, cacheKey);
  if (cached) return cached;

  const query = `Professional profile of ${stakeholder.name}${stakeholder.organisation ? ` at ${stakeholder.organisation}` : ""}${stakeholder.role ? ` (${stakeholder.role})` : ""}. Include: current role, career background, recent public activity, known professional priorities, and areas of influence. Focus on information relevant to project stakeholder engagement.`;

  const result = await perplexitySearch(query,
    "You are a stakeholder intelligence analyst. Provide factual, professional information about this person that would help a project manager engage with them effectively. Focus on their professional background, decision-making style, and known priorities. Do not include personal information.");

  await cacheResult(context.orgId, context.agentId || null, context.projectId || null, cacheKey, result.content, result.sources, "stakeholder_research");

  return { title: `Stakeholder Profile: ${stakeholder.name}`, content: result.content, sources: result.sources, cached: false, creditCost: 5 };
}

/**
 * Vendor/technology research — 5 credits.
 */
export async function vendorResearch(
  vendor: { name: string; type?: string },
  context: { orgId: string; agentId?: string; projectId?: string },
): Promise<ResearchResult> {
  const cacheKey = `vendor:${vendor.name.toLowerCase()}`;
  const cached = await getCachedResult(context.orgId, cacheKey);
  if (cached) return cached;

  const query = `Research on ${vendor.name}${vendor.type ? ` (${vendor.type})` : ""}: financial stability, market position, customer reviews, known service issues, upcoming changes (deprecations, pricing changes, feature roadmap), and competitor alternatives. Focus on factors that could affect a project using this vendor.`;

  const result = await perplexitySearch(query,
    "You are a vendor risk analyst. Provide objective assessment of this vendor/technology focusing on: reliability, financial health, market trajectory, known issues, and risks to projects dependent on them.");

  await cacheResult(context.orgId, context.agentId || null, context.projectId || null, cacheKey, result.content, result.sources, "vendor_research");

  return { title: `Vendor Research: ${vendor.name}`, content: result.content, sources: result.sources, cached: false, creditCost: 5 };
}

/**
 * News monitoring for a project — 3 credits.
 */
export async function newsMonitor(
  project: { name: string; industry?: string; technologies?: string[]; vendors?: string[] },
  context: { orgId: string; agentId?: string; projectId?: string },
): Promise<ResearchResult> {
  const cacheKey = `news:${project.name}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await getCachedResult(context.orgId, cacheKey);
  if (cached) return cached;

  const topics = [
    project.industry,
    ...(project.technologies || []),
    ...(project.vendors || []),
  ].filter(Boolean).join(", ");

  const query = `Latest news and developments (last 7 days) relevant to: ${topics}. Focus on: regulatory changes, technology updates, market shifts, vendor announcements, and industry trends that could impact a ${project.industry || "technology"} project.`;

  const result = await perplexitySearch(query,
    "You are a project intelligence analyst monitoring news for project risk factors. List each relevant news item with: date, headline, source, and brief assessment of potential project impact (LOW/MEDIUM/HIGH).");

  await cacheResult(context.orgId, context.agentId || null, context.projectId || null, cacheKey, result.content, result.sources, "news_monitor");

  return { title: `News Monitor: ${project.name}`, content: result.content, sources: result.sources, cached: false, creditCost: 3 };
}

/**
 * Market Research — 5 credits.
 * Searches for current market prices for materials, equipment, services,
 * or labour from multiple suppliers/sources. Returns structured CSV data.
 */
export async function procurementResearch(
  items: { name: string; quantity?: string; specs?: string }[],
  projectContext: { name: string; region?: string; industry?: string },
  context: { orgId: string; agentId?: string; projectId?: string },
): Promise<{ csv: string; summary: string; items: ProcurementItem[]; sources: string[]; cached: boolean; creditCost: number }> {
  const itemList = items.map(i => `${i.name}${i.quantity ? ` (qty: ${i.quantity})` : ""}${i.specs ? ` — ${i.specs}` : ""}`).join("\n");
  const cacheKey = `procurement:${items.map(i => i.name).join(",").toLowerCase().slice(0, 80)}:${new Date().toISOString().slice(0, 10)}`;

  const cached = await getCachedResult(context.orgId, cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.content);
      return { csv: parsed.csv || "", summary: parsed.summary || "", items: parsed.items || [], sources: cached.sources || [], cached: true, creditCost: 1 };
    } catch {
      return { csv: cached.content, summary: "", items: [], sources: [], cached: true, creditCost: 1 };
    }
  }

  const region = projectContext.region || "UK";
  const query = `Current market prices and rates for the following items/resources in ${region}:\n${itemList}\n\nFor each item, find prices from at least 2-3 different suppliers, vendors, or recruitment sources. Items may be physical materials, equipment, software, services, or human resources (labour/contractors). Include: supplier/source name, unit price or day rate, unit of measure, minimum order quantity or contract term if known, lead time or availability if available, and source URL.`;

  const result = await perplexitySearch(query,
    `You are a procurement and resource pricing analyst. Research current market prices and rates for the requested items. Items may include:
- Physical materials (steel, cement, equipment) — find supplier prices
- Human resources (developers, project managers, engineers) — find current day rates or salary ranges
- Software/services (licenses, subscriptions, SaaS tools) — find pricing tiers
- Professional services (consultants, contractors) — find market rates

Return your findings as a structured table with these exact columns:
Item,Supplier,Unit Price,Unit,MOQ,Lead Time,Notes

For human resources use "per day" or "per annum" as the Unit. For Supplier use the recruitment agency, job board, or market source.
Use actual supplier/source names and real current pricing. If exact prices aren't available, provide typical market ranges. Include GBP pricing for ${region}. After the table, provide a brief market summary noting any price trends, supply constraints, or bulk discount opportunities.`);

  // Parse the response into structured items
  const parsedItems: ProcurementItem[] = [];
  const lines = result.content.split("\n");
  let inTable = false;
  const csvLines: string[] = ["Item,Supplier,Unit Price,Unit,MOQ,Lead Time,Notes"];

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect CSV/table rows (contains multiple commas or pipes)
    if (trimmed.includes(",") && (trimmed.split(",").length >= 3 || inTable)) {
      inTable = true;
      if (trimmed.toLowerCase().startsWith("item,") || trimmed.startsWith("---")) continue;
      const parts = trimmed.split(",").map(p => p.trim());
      if (parts.length >= 3 && parts[0] && parts[1]) {
        parsedItems.push({
          item: parts[0],
          supplier: parts[1],
          unitPrice: parts[2] || "",
          unit: parts[3] || "",
          moq: parts[4] || "",
          leadTime: parts[5] || "",
          notes: parts.slice(6).join(", ") || "",
        });
        csvLines.push(trimmed);
      }
    }
    // Also handle pipe-separated tables (markdown)
    if (trimmed.includes("|") && trimmed.split("|").length >= 4) {
      const parts = trimmed.split("|").map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3 && !parts[0].includes("---") && !parts[0].toLowerCase().startsWith("item")) {
        parsedItems.push({
          item: parts[0],
          supplier: parts[1],
          unitPrice: parts[2] || "",
          unit: parts[3] || "",
          moq: parts[4] || "",
          leadTime: parts[5] || "",
          notes: parts.slice(6).join(", ") || "",
        });
        csvLines.push(parts.join(","));
      }
    }
  }

  // Extract summary (text after the table)
  const summaryStart = result.content.lastIndexOf("\n\n");
  const summary = summaryStart > 0 ? result.content.slice(summaryStart).trim() : `Found pricing for ${parsedItems.length} item/supplier combinations from ${new Set(parsedItems.map(i => i.supplier)).size} suppliers.`;

  const csv = csvLines.join("\n");

  // Cache the result
  await cacheResult(context.orgId, context.agentId || null, context.projectId || null, cacheKey,
    JSON.stringify({ csv, summary, items: parsedItems }), result.sources, "procurement_research");

  return { csv, summary, items: parsedItems, sources: result.sources, cached: false, creditCost: 5 };
}

/**
 * Convert procurement research results into a Cost Estimate artefact
 * and optionally create CostEntry records.
 */
export async function procurementToArtefact(
  items: ProcurementItem[],
  csv: string,
  projectId: string,
  agentId: string,
): Promise<{ artefactId: string; costEntriesCreated: number }> {
  let costEntries = 0;

  // Create a procurement comparison artefact
  const artefact = await db.agentArtefact.create({
    data: {
      agentId,
      projectId,
      name: "Market Pricing Research",
      format: "csv",
      content: csv,
      status: "DRAFT",
    },
  });

  // Create cost entries from the pricing data
  for (const item of items) {
    const price = parseFloat(item.unitPrice.replace(/[^0-9.]/g, ""));
    if (!isNaN(price) && price > 0) {
      try {
        await db.costEntry.create({
          data: {
            projectId,
            category: "MATERIALS",
            description: `${item.item} — ${item.supplier}`,
            amount: price,
            currency: "GBP",
            type: "ESTIMATED",
            notes: `Unit: ${item.unit || "each"}. MOQ: ${item.moq || "N/A"}. Lead time: ${item.leadTime || "N/A"}. Source: Procurement research.`,
          },
        });
        costEntries++;
      } catch { /* CostEntry model may not have all fields — skip gracefully */ }
    }
  }

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "proactive_alert",
      summary: `Market pricing research: ${items.length} item/supplier combinations found, ${costEntries} cost entries created, artefact generated`,
      metadata: { type: "procurement_research", items: items.length, costEntries, artefactId: artefact.id },
    },
  });

  return { artefactId: artefact.id, costEntriesCreated: costEntries };
}

/**
 * Resource Rates research — 5 credits.
 * Searches for current market rates for specific roles by location and type.
 * Returns structured data suitable for resource planning and cost estimation.
 */
export async function resourceRatesResearch(
  roles: { title: string; location?: string; type?: string; seniority?: string }[],
  projectContext: { name: string; region?: string; industry?: string },
  context: { orgId: string; agentId?: string; projectId?: string },
): Promise<{ csv: string; summary: string; rates: ResourceRate[]; sources: string[]; cached: boolean; creditCost: number }> {
  const roleList = roles.map(r =>
    `${r.title}${r.seniority ? ` (${r.seniority})` : ""}${r.location ? ` in ${r.location}` : ""}${r.type ? ` — ${r.type}` : ""}`
  ).join("\n");
  const cacheKey = `resource_rates:${roles.map(r => r.title).join(",").toLowerCase().slice(0, 80)}:${new Date().toISOString().slice(0, 10)}`;

  const cached = await getCachedResult(context.orgId, cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.content);
      return { csv: parsed.csv || "", summary: parsed.summary || "", rates: parsed.rates || [], sources: [], cached: true, creditCost: 1 };
    } catch {
      return { csv: cached.content, summary: "", rates: [], sources: [], cached: true, creditCost: 1 };
    }
  }

  const region = projectContext.region || "UK";
  const industry = projectContext.industry || "";
  const query = `Current market rates for the following roles in ${region}${industry ? ` (${industry} sector)` : ""}:\n${roleList}\n\nFor each role, provide: contract/freelance day rate, permanent salary range, typical availability, and demand level. Include rates from multiple sources (recruitment agencies, job boards, market surveys).`;

  const result = await perplexitySearch(query,
    `You are a resource market analyst specialising in ${region} labour markets. Research current rates for the requested roles. Return your findings as a structured table with these exact columns:
Role,Seniority,Day Rate (Contract),Annual Salary (Perm),Location,Demand,Source
Use GBP. Day rates should be outside IR35 rates. Salaries should be base salary excluding benefits. Demand should be Low/Medium/High/Very High. After the table, provide a brief market summary covering: rate trends, skills shortages, regional variations, and hiring timeline expectations.`);

  // Parse the response into structured rates
  const parsedRates: ResourceRate[] = [];
  const csvLines: string[] = ["Role,Seniority,Day Rate (Contract),Annual Salary (Perm),Location,Demand,Source"];

  for (const line of result.content.split("\n")) {
    const trimmed = line.trim();
    // Handle comma-separated
    if (trimmed.includes(",") && trimmed.split(",").length >= 4) {
      const parts = trimmed.split(",").map(p => p.trim());
      if (parts[0] && !parts[0].toLowerCase().startsWith("role") && !parts[0].includes("---")) {
        parsedRates.push({
          role: parts[0], seniority: parts[1] || "", dayRate: parts[2] || "",
          annualSalary: parts[3] || "", location: parts[4] || region,
          demand: parts[5] || "", source: parts[6] || "",
        });
        csvLines.push(trimmed);
      }
    }
    // Handle pipe-separated (markdown)
    if (trimmed.includes("|") && trimmed.split("|").length >= 5) {
      const parts = trimmed.split("|").map(p => p.trim()).filter(Boolean);
      if (parts.length >= 4 && !parts[0].includes("---") && !parts[0].toLowerCase().startsWith("role")) {
        parsedRates.push({
          role: parts[0], seniority: parts[1] || "", dayRate: parts[2] || "",
          annualSalary: parts[3] || "", location: parts[4] || region,
          demand: parts[5] || "", source: parts[6] || "",
        });
        csvLines.push(parts.join(","));
      }
    }
  }

  const summaryStart = result.content.lastIndexOf("\n\n");
  const summary = summaryStart > 0 ? result.content.slice(summaryStart).trim()
    : `Found rates for ${parsedRates.length} role configurations across ${new Set(parsedRates.map(r => r.source)).size} sources.`;

  const csv = csvLines.join("\n");

  await cacheResult(context.orgId, context.agentId || null, context.projectId || null, cacheKey,
    JSON.stringify({ csv, summary, rates: parsedRates }), result.sources, "resource_rates");

  return { csv, summary, rates: parsedRates, sources: result.sources, cached: false, creditCost: 5 };
}

export interface ResourceRate {
  role: string;
  seniority: string;
  dayRate: string;
  annualSalary: string;
  location: string;
  demand: string;
  source: string;
}

export interface ProcurementItem {
  item: string;
  supplier: string;
  unitPrice: string;
  unit: string;
  moq: string;
  leadTime: string;
  notes: string;
}

// ─── Types ───

export interface PestleFinding {
  dimension: string;
  title: string;
  description: string;
  impact: "LOW" | "MEDIUM" | "HIGH";
  sources: string[];
}

// ─── Research-to-Action Loop (spec 7.4) ───

/**
 * Convert PESTLE findings into project risks.
 * Called after a PESTLE scan to create/update risk entries.
 */
export async function pestleToRisks(
  findings: PestleFinding[],
  projectId: string,
  agentId: string,
): Promise<{ risksCreated: number; risksUpdated: number }> {
  let created = 0;
  let updated = 0;

  for (const finding of findings) {
    if (finding.impact === "LOW") continue; // Only create risks for MEDIUM+ findings

    // Check if a similar risk already exists
    const existing = await db.risk.findFirst({
      where: {
        projectId,
        title: { contains: finding.title.slice(0, 30), mode: "insensitive" as any },
        category: finding.dimension,
      },
    });

    const impactScore = finding.impact === "HIGH" ? 4 : 3;
    const probabilityScore = finding.impact === "HIGH" ? 4 : 3;

    if (existing) {
      // Update existing risk if score changed
      const newScore = impactScore * probabilityScore;
      if (newScore !== existing.score) {
        await db.risk.update({
          where: { id: existing.id },
          data: {
            impact: impactScore,
            probability: probabilityScore,
            score: newScore,
            mitigation: `${existing.mitigation || ""}\n\n[Auto-updated from PESTLE scan: ${finding.description}]`.trim(),
          },
        });
        updated++;
      }
    } else {
      // Create new risk
      await db.risk.create({
        data: {
          projectId,
          title: `[PESTLE ${finding.dimension}] ${finding.title}`,
          description: finding.description,
          category: finding.dimension,
          probability: probabilityScore,
          impact: impactScore,
          score: impactScore * probabilityScore,
          status: "OPEN",
          owner: null,
          mitigation: `Auto-identified from external intelligence scan. Sources: ${finding.sources.slice(0, 3).join(", ")}`,
        },
      });
      created++;
    }
  }

  // Log activity
  if (created > 0 || updated > 0) {
    await db.agentActivity.create({
      data: {
        agentId,
        type: "proactive_alert",
        summary: `PESTLE scan: ${created} new risk${created !== 1 ? "s" : ""} created, ${updated} existing risk${updated !== 1 ? "s" : ""} updated from external intelligence`,
        metadata: { type: "pestle_to_risks", created, updated, findingCount: findings.length },
      },
    });
  }

  return { risksCreated: created, risksUpdated: updated };
}
