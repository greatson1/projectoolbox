import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/research-audit — Research audit trail with provenance, gaps, conflicts, cost
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const agentFilter = searchParams.get("agent");
  const projectFilter = searchParams.get("project");
  const range = searchParams.get("range") || "30d";

  let since = new Date();
  if (range === "7d") since.setDate(since.getDate() - 7);
  else if (range === "30d") since.setDate(since.getDate() - 30);
  else if (range === "90d") since.setDate(since.getDate() - 90);
  else since.setDate(since.getDate() - 30);

  // Resolve project→agent mapping
  let agentIdsForProject: string[] | null = null;
  if (projectFilter) {
    const deployments = await db.agentDeployment.findMany({
      where: { projectId: projectFilter, agent: { orgId } },
      select: { agentId: true },
    });
    agentIdsForProject = deployments.map((d) => d.agentId);
  }

  const agentWhere = agentFilter
    ? { agentId: agentFilter }
    : agentIdsForProject
      ? { agentId: { in: agentIdsForProject } }
      : {};

  // ── Parallel data fetches ─────────────────────────────────────────────────

  const [kbItems, activities, chatMessages, agents, projects, artefacts, creditTxns, allDeployments] =
    await Promise.all([
      // 1. Research-tagged KB items
      db.knowledgeBaseItem.findMany({
        where: {
          orgId,
          tags: { hasSome: ["research", "feasibility", "perplexity"] },
          createdAt: { gte: since },
          ...agentWhere,
        },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          id: true, title: true, content: true, type: true, layer: true,
          trustLevel: true, tags: true, createdAt: true, updatedAt: true,
          agentId: true, projectId: true, sourceUrl: true, metadata: true,
        },
      }),

      // 2. Research-related activity log
      db.agentActivity.findMany({
        where: {
          agent: { orgId },
          createdAt: { gte: since },
          OR: [
            { summary: { contains: "research", mode: "insensitive" } },
            { summary: { contains: "feasibility", mode: "insensitive" } },
            { summary: { contains: "Perplexity", mode: "insensitive" } },
            { summary: { contains: "PESTLE", mode: "insensitive" } },
            { type: "knowledge" },
          ],
          ...agentWhere,
        },
        include: { agent: { select: { id: true, name: true, gradient: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),

      // 3. Chat messages with research_findings
      db.chatMessage.findMany({
        where: {
          agent: { orgId },
          content: "__RESEARCH_FINDINGS__",
          createdAt: { gte: since },
          ...agentWhere,
        },
        include: { agent: { select: { id: true, name: true, gradient: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),

      // 4. Agents with active deployment
      db.agent.findMany({
        where: { orgId, status: { not: "DECOMMISSIONED" } },
        select: {
          id: true, name: true, gradient: true,
          deployments: {
            where: { isActive: true },
            select: {
              projectId: true,
              phaseStatus: true,
              currentPhase: true,
              project: { select: { id: true, name: true, status: true } },
            },
            take: 1,
          },
        },
      }),

      // 5. Projects
      db.project.findMany({
        where: { orgId },
        select: { id: true, name: true, status: true },
        orderBy: { updatedAt: "desc" },
      }),

      // 6. Artefacts — for provenance tracking (which artefacts used research data)
      db.agentArtefact.findMany({
        where: {
          projectId: projectFilter || undefined,
          agentId: agentFilter || undefined,
          createdAt: { gte: since },
        },
        select: {
          id: true, agentId: true, projectId: true, name: true, format: true,
          status: true, version: true, createdAt: true, phaseId: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),

      // 7. Credit transactions — research cost tracking
      db.creditTransaction.findMany({
        where: {
          orgId,
          type: "USAGE",
          createdAt: { gte: since },
          OR: [
            { description: { contains: "research", mode: "insensitive" } },
            { description: { contains: "feasibility", mode: "insensitive" } },
            { description: { contains: "PESTLE", mode: "insensitive" } },
            { description: { contains: "Generated", mode: "insensitive" } },
          ],
        },
        select: {
          id: true, amount: true, description: true, agentId: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),

      // 8. All active deployments — for gap analysis
      db.agentDeployment.findMany({
        where: { agent: { orgId }, isActive: true },
        select: {
          agentId: true, projectId: true, phaseStatus: true, currentPhase: true,
          project: { select: { id: true, name: true, status: true } },
          agent: { select: { id: true, name: true } },
        },
      }),
    ]);

  // ── Agent→project mapping ─────────────────────────────────────────────────

  const agentProjectMap = new Map<string, { projectId: string; projectName: string }>();
  agents.forEach((a) => {
    const dep = a.deployments?.[0];
    if (dep?.project) {
      agentProjectMap.set(a.id, { projectId: dep.project.id, projectName: dep.project.name });
    }
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  const sessions = chatMessages.map((msg) => {
    const meta = msg.metadata as any;
    const agentProject = agentProjectMap.get(msg.agentId);
    return {
      id: msg.id,
      agentId: msg.agentId,
      agentName: (msg.agent as any).name,
      agentGradient: (msg.agent as any).gradient,
      projectId: agentProject?.projectId || null,
      projectName: meta?.projectName || agentProject?.projectName || "Unknown",
      factsCount: meta?.factsCount || 0,
      sections: meta?.sections || [],
      facts: meta?.facts || [],
      createdAt: msg.createdAt,
    };
  });

  // ── Provenance: link artefacts to the research facts that informed them ───

  const provenance = artefacts.map((art) => {
    // Find KB research facts for this project created BEFORE this artefact
    const sourceFacts = kbItems.filter(
      (k) =>
        k.projectId === art.projectId &&
        new Date(k.createdAt) <= new Date(art.createdAt)
    );
    // Find the research session that produced these facts
    const sourceSession = sessions.find(
      (s) => s.projectId === art.projectId && new Date(s.createdAt) <= new Date(art.createdAt)
    );
    return {
      artefactId: art.id,
      artefactName: art.name,
      artefactFormat: art.format,
      artefactStatus: art.status,
      artefactVersion: art.version,
      artefactCreatedAt: art.createdAt,
      agentId: art.agentId,
      projectId: art.projectId,
      sourceFactCount: sourceFacts.length,
      sourceFactIds: sourceFacts.slice(0, 20).map((f) => f.id),
      sourceFactTitles: sourceFacts.slice(0, 10).map((f) => f.title),
      sourceSessionId: sourceSession?.id || null,
      sourceSessionDate: sourceSession?.createdAt || null,
      highTrustSources: sourceFacts.filter((f) => f.trustLevel === "HIGH_TRUST").length,
      standardSources: sourceFacts.filter((f) => f.trustLevel === "STANDARD").length,
    };
  });

  // ── Research gaps: active projects with no/stale research ─────────────────

  const STALE_THRESHOLD_DAYS = 30;
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - STALE_THRESHOLD_DAYS);

  const gaps: Array<{
    projectId: string;
    projectName: string;
    agentName: string;
    gapType: "no_research" | "stale_research" | "missing_category";
    detail: string;
    severity: "high" | "medium" | "low";
    lastResearchDate: string | null;
    daysSinceResearch: number | null;
  }> = [];

  // Check each active deployment for research coverage
  for (const dep of allDeployments) {
    const projectKBFacts = kbItems.filter((k) => k.projectId === dep.projectId);
    const projectSessions = sessions.filter((s) => s.projectId === dep.projectId);

    if (projectSessions.length === 0 && projectKBFacts.length === 0) {
      gaps.push({
        projectId: dep.projectId,
        projectName: dep.project.name,
        agentName: dep.agent.name,
        gapType: "no_research",
        detail: "No feasibility research has been conducted for this project",
        severity: "high",
        lastResearchDate: null,
        daysSinceResearch: null,
      });
      continue;
    }

    // Check staleness
    const latestFact = projectKBFacts[0]; // already sorted desc
    if (latestFact && new Date(latestFact.createdAt) < staleDate) {
      const daysSince = Math.floor((Date.now() - new Date(latestFact.createdAt).getTime()) / 86400000);
      gaps.push({
        projectId: dep.projectId,
        projectName: dep.project.name,
        agentName: dep.agent.name,
        gapType: "stale_research",
        detail: `Research is ${daysSince} days old — consider refreshing`,
        severity: daysSince > 60 ? "high" : "medium",
        lastResearchDate: latestFact.createdAt.toISOString ? latestFact.createdAt.toISOString() : String(latestFact.createdAt),
        daysSinceResearch: daysSince,
      });
    }

    // Check category coverage
    const factTitles = projectKBFacts.map((k) => k.title.toLowerCase()).join(" ");
    const hasCost = /cost|price|budget|fee|£/.test(factTitles);
    const hasRisk = /risk|danger|warning|safety/.test(factTitles);
    const hasRegulatory = /regulation|compliance|legal|permit|licence/.test(factTitles);
    const hasTimeline = /timeline|duration|schedule|deadline/.test(factTitles);

    const missing: string[] = [];
    if (!hasCost) missing.push("Costs & Budget");
    if (!hasRisk) missing.push("Risks & Safety");
    if (!hasRegulatory) missing.push("Regulatory");
    if (!hasTimeline) missing.push("Timeline");

    if (missing.length >= 2) {
      gaps.push({
        projectId: dep.projectId,
        projectName: dep.project.name,
        agentName: dep.agent.name,
        gapType: "missing_category",
        detail: `Missing research in: ${missing.join(", ")}`,
        severity: missing.length >= 3 ? "high" : "medium",
        lastResearchDate: latestFact ? (latestFact.createdAt.toISOString ? latestFact.createdAt.toISOString() : String(latestFact.createdAt)) : null,
        daysSinceResearch: latestFact ? Math.floor((Date.now() - new Date(latestFact.createdAt).getTime()) / 86400000) : null,
      });
    }
  }

  // ── Fact conflicts: KB items with similar titles but different content ─────

  const conflicts: Array<{
    factA: { id: string; title: string; content: string; createdAt: any; trustLevel: string };
    factB: { id: string; title: string; content: string; createdAt: any; trustLevel: string };
    projectId: string | null;
    conflictType: string;
  }> = [];

  // Group KB items by project, then find title overlaps
  const byProject = new Map<string, typeof kbItems>();
  kbItems.forEach((k) => {
    const pid = k.projectId || "__global";
    if (!byProject.has(pid)) byProject.set(pid, []);
    byProject.get(pid)!.push(k);
  });

  for (const [pid, items] of byProject) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        // Check for significant title overlap (shared keywords)
        const aWords = new Set(a.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
        const bWords = new Set(b.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
        const overlap = [...aWords].filter((w) => bWords.has(w));
        if (overlap.length >= 2 && a.content.trim() !== b.content.trim()) {
          // Different content on the same topic
          const contentSimilar = a.content.slice(0, 200).toLowerCase() === b.content.slice(0, 200).toLowerCase();
          if (!contentSimilar) {
            conflicts.push({
              factA: { id: a.id, title: a.title, content: a.content.slice(0, 300), createdAt: a.createdAt, trustLevel: a.trustLevel },
              factB: { id: b.id, title: b.title, content: b.content.slice(0, 300), createdAt: b.createdAt, trustLevel: b.trustLevel },
              projectId: pid === "__global" ? null : pid,
              conflictType: `Overlapping topic: "${overlap.join(", ")}"`,
            });
          }
        }
      }
    }
  }

  // ── Cost analytics ────────────────────────────────────────────────────────

  const researchTxns = creditTxns.filter(
    (t) => /research|feasibility|pestle/i.test(t.description)
  );
  const generationTxns = creditTxns.filter(
    (t) => /generated/i.test(t.description) && !/research/i.test(t.description)
  );

  const totalResearchCredits = researchTxns.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalGenerationCredits = generationTxns.reduce((s, t) => s + Math.abs(t.amount), 0);

  // Per-agent cost breakdown
  const costByAgent: Record<string, { research: number; generation: number; total: number }> = {};
  creditTxns.forEach((t) => {
    const aid = t.agentId || "__unknown";
    if (!costByAgent[aid]) costByAgent[aid] = { research: 0, generation: 0, total: 0 };
    const amt = Math.abs(t.amount);
    costByAgent[aid].total += amt;
    if (/research|feasibility|pestle/i.test(t.description)) costByAgent[aid].research += amt;
    else costByAgent[aid].generation += amt;
  });

  // Per-project cost (map agent→project)
  const costByProject: Record<string, { name: string; research: number; generation: number; total: number; facts: number }> = {};
  Object.entries(costByAgent).forEach(([aid, cost]) => {
    const proj = agentProjectMap.get(aid);
    if (proj) {
      if (!costByProject[proj.projectId]) {
        costByProject[proj.projectId] = { name: proj.projectName, research: 0, generation: 0, total: 0, facts: 0 };
      }
      costByProject[proj.projectId].research += cost.research;
      costByProject[proj.projectId].generation += cost.generation;
      costByProject[proj.projectId].total += cost.total;
    }
  });
  // Add fact counts per project
  kbItems.forEach((k) => {
    if (k.projectId && costByProject[k.projectId]) {
      costByProject[k.projectId].facts++;
    }
  });

  // ── Stale facts (individual) ──────────────────────────────────────────────

  const staleFacts = kbItems
    .filter((k) => new Date(k.createdAt) < staleDate)
    .map((k) => ({
      id: k.id,
      title: k.title,
      projectId: k.projectId,
      trustLevel: k.trustLevel,
      createdAt: k.createdAt,
      daysSince: Math.floor((Date.now() - new Date(k.createdAt).getTime()) / 86400000),
    }));

  // ── Stats ─────────────────────────────────────────────────────────────────

  const totalFacts = kbItems.length;
  const totalSessions = sessions.length;
  const totalActivities = activities.length;
  const highTrustFacts = kbItems.filter((k) => k.trustLevel === "HIGH_TRUST").length;
  const standardFacts = kbItems.filter((k) => k.trustLevel === "STANDARD").length;

  const categories: Record<string, number> = {};
  kbItems.forEach((k) => {
    (k.tags || []).forEach((t: string) => {
      if (!["research", "feasibility", "perplexity"].includes(t)) {
        categories[t] = (categories[t] || 0) + 1;
      }
    });
  });

  // Facts per credit (ROI)
  const factsPerCredit = totalResearchCredits > 0 ? (totalFacts / totalResearchCredits).toFixed(1) : "N/A";

  return NextResponse.json({
    data: {
      sessions,
      kbItems: kbItems.map((k) => ({
        ...k,
        metadata: undefined,
        daysSinceUpdate: Math.floor((Date.now() - new Date(k.updatedAt || k.createdAt).getTime()) / 86400000),
        isStale: new Date(k.createdAt) < staleDate,
      })),
      activities: activities.map((a) => ({
        id: a.id,
        agentId: a.agentId,
        agentName: (a.agent as any).name,
        agentGradient: (a.agent as any).gradient,
        type: a.type,
        summary: a.summary,
        metadata: a.metadata,
        createdAt: a.createdAt,
      })),
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        gradient: a.gradient,
        projectId: a.deployments?.[0]?.project?.id || null,
        projectName: a.deployments?.[0]?.project?.name || null,
      })),
      projects,
      // New: provenance, gaps, conflicts, cost
      provenance,
      gaps,
      conflicts,
      staleFacts,
      cost: {
        totalResearchCredits,
        totalGenerationCredits,
        factsPerCredit,
        byAgent: Object.entries(costByAgent).map(([agentId, c]) => {
          const agentInfo = agents.find((a) => a.id === agentId);
          return {
            agentId,
            agentName: agentInfo?.name || "Unknown",
            ...c,
          };
        }),
        byProject: Object.entries(costByProject).map(([projectId, c]) => ({
          projectId,
          ...c,
        })),
      },
      stats: {
        totalFacts,
        totalSessions,
        totalActivities,
        highTrustFacts,
        standardFacts,
        categories,
        totalArtefacts: artefacts.length,
        totalConflicts: conflicts.length,
        totalGaps: gaps.length,
        totalStaleFacts: staleFacts.length,
        totalCreditsSpent: totalResearchCredits + totalGenerationCredits,
      },
    },
  });
}
