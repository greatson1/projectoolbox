/**
 * Planning Research Engine
 *
 * Runs Perplexity searches BEFORE WBS generation to gather:
 *   1. Industry benchmarks for task durations
 *   2. Market rates for roles in the project's region
 *   3. Vendor/tool pricing for non-labour costs
 *   4. Typical WBS structure for the project type
 *   5. Common dependencies and risks for this type of work
 *
 * Results are injected into the LLM prompt so Claude produces
 * informed estimates backed by real market data.
 */

import { db } from "@/lib/db";

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

interface PlanningResearch {
  wbsTemplate: string;
  marketRates: MarketRate[];
  durationBenchmarks: DurationBenchmark[];
  vendorPricing: VendorPrice[];
  commonDependencies: string;
  commonRisks: string;
  sources: string[];
}

interface MarketRate {
  role: string;
  dailyRate: number;
  hourlyRate: number;
  source: string;
}

interface DurationBenchmark {
  taskType: string;
  typicalDays: number;
  range: string;
  source: string;
}

interface VendorPrice {
  item: string;
  price: number;
  unit: string;
  vendor: string;
}

/**
 * Run all planning research queries in parallel.
 * Returns structured data to inject into the WBS/estimation prompts.
 */
export async function researchBeforePlanning(
  project: { name: string; description: string | null; category: string | null; methodology: string; budget: number | null; startDate: Date | string | null; endDate: Date | string | null },
  context: { orgId: string; agentId?: string; projectId?: string },
): Promise<PlanningResearch> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return fallbackResearch(project);

  const projectType = project.category || inferProjectType(project.name, project.description);
  const region = "UK"; // Could be configured per org

  // Check cache first
  const cacheKey = `planning-research:${projectType}:${project.methodology}`;
  const cached = await db.knowledgeBaseItem.findFirst({
    where: { orgId: context.orgId, title: cacheKey, cachedUntil: { gte: new Date() } },
    select: { content: true },
  });

  if (cached) {
    try { return JSON.parse(cached.content); } catch {}
  }

  // Run 5 searches in parallel
  const [wbsResult, ratesResult, durationsResult, pricingResult, risksResult] = await Promise.all([
    searchPerplexity(apiKey, `Typical work breakdown structure (WBS) for a ${projectType} project using ${project.methodology} methodology. List the main deliverables and work packages with typical task breakdown. Be specific with task names.`),
    searchPerplexity(apiKey, `Average day rates and hourly rates for project roles in ${region} 2026: project manager, business analyst, developer, designer, QA tester, DevOps engineer, data analyst, scrum master. Include contractor and permanent rates.`),
    searchPerplexity(apiKey, `Typical task durations and effort estimates for ${projectType} project activities: requirements gathering, design, development, testing, deployment, training, documentation. Include range estimates (optimistic/likely/pessimistic) in days.`),
    searchPerplexity(apiKey, `Current pricing for common tools and services used in ${projectType} projects: cloud hosting, project management tools, design tools, testing tools, CI/CD, monitoring. Include monthly/annual pricing.`),
    searchPerplexity(apiKey, `Common dependencies, risks, and constraints for ${projectType} projects using ${project.methodology}. Include typical critical path items and predecessor/successor relationships between project phases.`),
  ]);

  // Parse market rates from search results
  const marketRates = parseMarketRates(ratesResult.content);
  const durationBenchmarks = parseDurations(durationsResult.content);
  const vendorPricing = parseVendorPricing(pricingResult.content);

  const allSources = [...new Set([...wbsResult.sources, ...ratesResult.sources, ...durationsResult.sources, ...pricingResult.sources, ...risksResult.sources])];

  const research: PlanningResearch = {
    wbsTemplate: wbsResult.content,
    marketRates,
    durationBenchmarks,
    vendorPricing,
    commonDependencies: risksResult.content.split("risk")[0] || risksResult.content,
    commonRisks: risksResult.content,
    sources: allSources.slice(0, 10),
  };

  // Cache for 7 days
  await db.knowledgeBaseItem.create({
    data: {
      orgId: context.orgId,
      agentId: context.agentId || null,
      projectId: context.projectId || null,
      layer: "WORKSPACE",
      type: "URL",
      title: cacheKey,
      content: JSON.stringify(research),
      tags: ["planning-research", "auto-generated", projectType],
      cachedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return research;
}

/**
 * Build the enhanced WBS prompt with research data injected.
 */
export function buildResearchEnhancedPrompt(
  project: { name: string; description: string | null; methodology: string; budget: number | null },
  research: PlanningResearch,
): string {
  const ratesSection = research.marketRates.length > 0
    ? `\nMARKET RATES (use these for cost estimation):\n${research.marketRates.map(r => `- ${r.role}: £${r.hourlyRate}/hr (£${r.dailyRate}/day) [${r.source}]`).join("\n")}`
    : "";

  const durationsSection = research.durationBenchmarks.length > 0
    ? `\nDURATION BENCHMARKS (use these for time estimation):\n${research.durationBenchmarks.map(d => `- ${d.taskType}: typically ${d.typicalDays} days (range: ${d.range}) [${d.source}]`).join("\n")}`
    : "";

  const pricingSection = research.vendorPricing.length > 0
    ? `\nTOOL/VENDOR PRICING (use for non-labour cost estimation):\n${research.vendorPricing.map(v => `- ${v.item}: £${v.price}/${v.unit} (${v.vendor})`).join("\n")}`
    : "";

  return `You are building a WBS and cost estimate for: ${project.name}
Description: ${project.description || "Not specified"}
Methodology: ${project.methodology}
Budget: ${project.budget ? `£${project.budget.toLocaleString()}` : "Not set"}

INDUSTRY REFERENCE WBS (adapt to this specific project):
${research.wbsTemplate}
${ratesSection}
${durationsSection}
${pricingSection}

COMMON DEPENDENCIES:
${research.commonDependencies}

COMMON RISKS:
${research.commonRisks}

INSTRUCTIONS:
- Create tasks with REALISTIC durations based on the benchmarks above
- Use MARKET RATES for cost estimation, not default rates
- Include dependencies between tasks (predecessor task IDs)
- Flag tasks on the critical path
- Identify resource types needed per task
- Estimate non-labour costs using the vendor pricing above
- If budget is set, ensure total estimate is within 10% of budget or flag the gap

SOURCES USED: ${research.sources.slice(0, 5).join(", ")}`;
}

// ─── Perplexity API ───

async function searchPerplexity(apiKey: string, query: string): Promise<{ content: string; sources: string[] }> {
  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "You are a project management research assistant. Provide specific, quantified data with sources. Focus on UK market data where available." },
          { role: "user", content: query },
        ],
        max_tokens: 1500,
        return_citations: true,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        content: data.choices?.[0]?.message?.content || "",
        sources: data.citations || [],
      };
    }
  } catch (e) {
    console.error("Perplexity search failed:", e);
  }
  return { content: "", sources: [] };
}

// ─── Parsers ───

function parseMarketRates(text: string): MarketRate[] {
  const rates: MarketRate[] = [];
  const lines = text.split("\n");

  const rolePatterns = [
    { role: "Project Manager", pattern: /project\s*manager/i },
    { role: "Business Analyst", pattern: /business\s*analyst/i },
    { role: "Developer", pattern: /developer|software\s*engineer/i },
    { role: "Senior Developer", pattern: /senior\s*developer|lead\s*developer/i },
    { role: "Designer", pattern: /designer|ux|ui/i },
    { role: "QA Tester", pattern: /qa|tester|test\s*engineer/i },
    { role: "DevOps", pattern: /devops|infrastructure|cloud\s*engineer/i },
    { role: "Data Analyst", pattern: /data\s*analyst|data\s*engineer/i },
    { role: "Scrum Master", pattern: /scrum\s*master|agile\s*coach/i },
  ];

  for (const line of lines) {
    for (const rp of rolePatterns) {
      if (rp.pattern.test(line)) {
        // Try to extract numbers
        const dayMatch = line.match(/£(\d[\d,]*)\s*(?:per\s*)?(?:\/)?day/i) || line.match(/(\d[\d,]*)\s*(?:per\s*)?day/i);
        const hourMatch = line.match(/£(\d[\d,]*)\s*(?:per\s*)?(?:\/)?h(?:ou)?r/i) || line.match(/(\d[\d,]*)\s*(?:per\s*)?h(?:ou)?r/i);

        let dailyRate = dayMatch ? parseInt(dayMatch[1].replace(",", "")) : 0;
        let hourlyRate = hourMatch ? parseInt(hourMatch[1].replace(",", "")) : 0;

        if (dailyRate && !hourlyRate) hourlyRate = Math.round(dailyRate / 8);
        if (hourlyRate && !dailyRate) dailyRate = hourlyRate * 8;

        if (dailyRate > 0 || hourlyRate > 0) {
          // Deduplicate
          if (!rates.find(r => r.role === rp.role)) {
            rates.push({ role: rp.role, dailyRate, hourlyRate, source: "Perplexity market research" });
          }
        }
      }
    }
  }

  return rates;
}

function parseDurations(text: string): DurationBenchmark[] {
  const benchmarks: DurationBenchmark[] = [];
  const lines = text.split("\n");

  const taskTypes = ["requirements", "design", "development", "testing", "deployment", "training", "documentation", "planning", "analysis", "integration"];

  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const tt of taskTypes) {
      if (lower.includes(tt)) {
        const dayMatch = line.match(/(\d+)\s*(?:-\s*(\d+))?\s*days/i) || line.match(/(\d+)\s*(?:-\s*(\d+))?\s*weeks/i);
        if (dayMatch) {
          const min = parseInt(dayMatch[1]);
          const max = dayMatch[2] ? parseInt(dayMatch[2]) : min;
          const isWeeks = lower.includes("week");
          const minDays = isWeeks ? min * 5 : min;
          const maxDays = isWeeks ? max * 5 : max;
          const typical = Math.round((minDays + maxDays) / 2);

          if (!benchmarks.find(b => b.taskType === tt)) {
            benchmarks.push({
              taskType: tt,
              typicalDays: typical,
              range: `${minDays}-${maxDays} days`,
              source: "Industry benchmark",
            });
          }
        }
      }
    }
  }

  return benchmarks;
}

function parseVendorPricing(text: string): VendorPrice[] {
  const prices: VendorPrice[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const priceMatch = line.match(/[£$](\d[\d,]*(?:\.\d{2})?)\s*(?:\/|\s*per\s*)(month|year|annual|user|license)/i);
    if (priceMatch) {
      const item = line.split(/[£$]/)[0].replace(/[-–—:•*]/g, "").trim().slice(0, 60);
      if (item.length > 3) {
        prices.push({
          item,
          price: parseFloat(priceMatch[1].replace(",", "")),
          unit: priceMatch[2].toLowerCase(),
          vendor: item.split(/\s*[-–(]/)[0].trim(),
        });
      }
    }
  }

  return prices.slice(0, 10);
}

function inferProjectType(name: string, description: string | null): string {
  const text = `${name} ${description || ""}`.toLowerCase();
  if (text.includes("website") || text.includes("web app") || text.includes("frontend")) return "web development";
  if (text.includes("mobile") || text.includes("app")) return "mobile app development";
  if (text.includes("migration") || text.includes("crm") || text.includes("erp")) return "system migration";
  if (text.includes("infrastructure") || text.includes("cloud") || text.includes("devops")) return "IT infrastructure";
  if (text.includes("construction") || text.includes("building") || text.includes("renovation")) return "construction";
  if (text.includes("marketing") || text.includes("campaign") || text.includes("brand")) return "marketing";
  if (text.includes("data") || text.includes("analytics") || text.includes("bi")) return "data and analytics";
  return "IT project";
}

/**
 * Fallback when Perplexity is unavailable.
 */
function fallbackResearch(project: { name: string; description: string | null; category: string | null; methodology: string }): PlanningResearch {
  const projectType = project.category || inferProjectType(project.name, project.description);

  return {
    wbsTemplate: `Standard ${projectType} WBS: Initiation (charter, stakeholders) → Planning (requirements, design, schedule) → Execution (build, test, integrate) → Closure (deploy, handover, lessons learned)`,
    marketRates: [
      { role: "Project Manager", dailyRate: 600, hourlyRate: 75, source: "UK average 2026" },
      { role: "Senior Developer", dailyRate: 550, hourlyRate: 69, source: "UK average 2026" },
      { role: "Developer", dailyRate: 450, hourlyRate: 56, source: "UK average 2026" },
      { role: "Designer", dailyRate: 400, hourlyRate: 50, source: "UK average 2026" },
      { role: "QA Tester", dailyRate: 350, hourlyRate: 44, source: "UK average 2026" },
      { role: "Business Analyst", dailyRate: 500, hourlyRate: 63, source: "UK average 2026" },
    ],
    durationBenchmarks: [
      { taskType: "requirements", typicalDays: 10, range: "5-15 days", source: "Industry average" },
      { taskType: "design", typicalDays: 15, range: "10-20 days", source: "Industry average" },
      { taskType: "development", typicalDays: 30, range: "20-60 days", source: "Industry average" },
      { taskType: "testing", typicalDays: 10, range: "5-20 days", source: "Industry average" },
      { taskType: "deployment", typicalDays: 5, range: "2-10 days", source: "Industry average" },
    ],
    vendorPricing: [],
    commonDependencies: "Requirements → Design → Development → Testing → Deployment. Design must complete before development starts. Testing cannot begin until core development is feature-complete.",
    commonRisks: "Scope creep, resource availability, technical complexity underestimation, third-party dependency delays, stakeholder availability for reviews.",
    sources: [],
  };
}
