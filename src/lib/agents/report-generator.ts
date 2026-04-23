import { db } from "@/lib/db";

export interface ReportContext {
  projectId: string;
  type: string;
  sections: string[];
}

/**
 * Gathers all project data needed for report generation.
 */
export async function gatherProjectData(projectId: string) {
  const [project, tasks, risks, issues, stakeholders, changeRequests, activities, approvals] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      include: {
        phases: { orderBy: { order: "asc" } },
        agents: { where: { isActive: true }, include: { agent: true } },
      },
    }),
    db.task.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    db.risk.findMany({ where: { projectId }, orderBy: { score: "desc" } }),
    db.issue.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    db.stakeholder.findMany({ where: { projectId } }),
    db.changeRequest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    db.agentActivity.findMany({
      where: { agent: { deployments: { some: { projectId, isActive: true } } } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { agent: { select: { name: true } } },
    }),
    db.approval.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  if (!project) throw new Error("Project not found");

  // Stakeholder sentiment snapshot — used for "Recent Sentiment" section
  const stakeholdersForSentiment = await db.stakeholder.findMany({
    where: { projectId },
    select: { name: true, sentiment: true, sentimentScore: true, role: true },
  });
  const negativeCount = stakeholdersForSentiment.filter(s => s.sentiment === "negative").length;
  const concernedCount = stakeholdersForSentiment.filter(s => s.sentiment === "concerned").length;
  const stakeholderSentiment = {
    negative: negativeCount,
    concerned: concernedCount,
    total: stakeholdersForSentiment.length,
    at_risk: stakeholdersForSentiment.filter(s => s.sentiment === "negative" || s.sentiment === "concerned"),
  };

  // Calculate metrics
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const inProgressTasks = tasks.filter(t => t.status === "IN_PROGRESS").length;
  const blockedTasks = tasks.filter(t => t.status === "BLOCKED").length;
  const totalSP = tasks.reduce((s, t) => s + (t.storyPoints || 0), 0);
  const doneSP = tasks.filter(t => t.status === "DONE").reduce((s, t) => s + (t.storyPoints || 0), 0);
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const criticalRisks = risks.filter(r => (r.score || 0) >= 15);
  const openIssues = issues.filter(i => i.status === "OPEN" || i.status === "IN_PROGRESS");
  const pendingApprovals = approvals.filter(a => a.status === "PENDING");
  const pendingCRs = changeRequests.filter(cr => cr.status === "SUBMITTED" || cr.status === "UNDER_REVIEW");

  const budget = project.budget || 0;
  const agent = project.agents[0]?.agent;

  return {
    project: {
      name: project.name,
      description: project.description,
      methodology: project.methodology,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      budget,
    },
    phases: project.phases,
    agent: agent ? { name: agent.name, autonomyLevel: agent.autonomyLevel } : null,
    metrics: {
      totalTasks, doneTasks, inProgressTasks, blockedTasks,
      totalSP, doneSP, progressPct,
      totalRisks: risks.length,
      criticalRisks: criticalRisks.length,
      openIssues: openIssues.length,
      totalIssues: issues.length,
      pendingApprovals: pendingApprovals.length,
      pendingCRs: pendingCRs.length,
      stakeholders: stakeholders.length,
      changeRequests: changeRequests.length,
    },
    topRisks: criticalRisks.slice(0, 5).map(r => ({
      title: r.title, probability: r.probability, impact: r.impact,
      score: r.score, status: r.status, owner: r.owner, mitigation: r.mitigation,
    })),
    recentIssues: openIssues.slice(0, 5).map(i => ({
      title: i.title, priority: i.priority, status: i.status,
    })),
    recentActivities: activities.slice(0, 10).map(a => ({
      type: a.type, summary: a.summary, agent: a.agent.name,
      date: a.createdAt.toISOString().split("T")[0],
    })),
    pendingCRs: pendingCRs.slice(0, 5).map(cr => ({
      title: cr.title, status: cr.status, impact: cr.impact,
    })),
    stakeholderSentiment,
  };
}

/**
 * Builds the LLM prompt for report generation.
 */
export function buildReportPrompt(type: string, sections: string[], data: Awaited<ReturnType<typeof gatherProjectData>>): string {
  const { project, metrics, topRisks, recentIssues, recentActivities, phases, agent } = data;

  const dataContext = `
PROJECT: ${project.name}
Methodology: ${project.methodology}
Status: ${project.status}
Budget: £${(project.budget || 0).toLocaleString()}
Start: ${project.startDate || "TBD"} | End: ${project.endDate || "TBD"}
Agent: ${agent ? `${agent.name} (L${agent.autonomyLevel})` : "None assigned"}

PROGRESS:
- Tasks: ${metrics.doneTasks}/${metrics.totalTasks} completed (${metrics.progressPct}%)
- Story Points: ${metrics.doneSP}/${metrics.totalSP} SP done
- In Progress: ${metrics.inProgressTasks} | Blocked: ${metrics.blockedTasks}

PHASES:
${phases.map(p => `- ${p.name}: ${p.status}`).join("\n")}

RISKS (${metrics.totalRisks} total, ${metrics.criticalRisks} critical):
${topRisks.map(r => `- [Score ${r.score}] ${r.title} (${r.status}) — Owner: ${r.owner || "Unassigned"}\n  Mitigation: ${r.mitigation || "None defined"}`).join("\n")}

ISSUES (${metrics.openIssues} open of ${metrics.totalIssues}):
${recentIssues.map(i => `- [${i.priority}] ${i.title} (${i.status})`).join("\n")}

CHANGE REQUESTS (${metrics.pendingCRs} pending):
${data.pendingCRs.map(cr => `- ${cr.title} (${cr.status})`).join("\n")}

PENDING APPROVALS: ${metrics.pendingApprovals}
STAKEHOLDERS: ${metrics.stakeholders}

RECENT AGENT ACTIVITIES:
${recentActivities.map(a => `- ${a.date}: ${a.agent} — ${a.summary}`).join("\n")}
`;

  const typeInstructions: Record<string, string> = {
    STATUS: `Generate a comprehensive weekly STATUS REPORT. Include: Executive Summary (2-3 paragraphs), Schedule Status (RAG + commentary), Budget Status (spend vs plan), Key Risks (top 3 with mitigation), Issues & Blockers, Key Decisions This Week, Upcoming Milestones, Recommendations.`,
    EXECUTIVE: `Generate an EXECUTIVE SUMMARY for senior leadership. Keep it high-level and strategic. Include: Portfolio Health (1 paragraph), Key Achievements, Strategic Risks, Budget Overview, Recommendations for Steering Committee. Maximum 2 pages equivalent.`,
    RISK: `Generate a detailed RISK REPORT. Include: Risk Summary Dashboard (total, critical, new, closed), Top Risks Analysis (each with probability, impact, score, trend, mitigation status), Risk Trend (improving/worsening), New Risks Identified, Risks Closed/Mitigated, Recommended Actions.`,
    SPRINT_REVIEW: `Generate a SPRINT REVIEW report. Include: Sprint Goal Achievement, Completed Items (with SP), Carry-over Items, Velocity Analysis (vs previous sprints), Burndown Assessment, Team Performance, Impediments Encountered, Retrospective Themes, Next Sprint Preview.`,
    EVM: `Generate an EARNED VALUE MANAGEMENT report. Include: EVM Summary (BAC, PV, EV, AC, SV, CV, SPI, CPI, EAC, ETC, VAC, TCPI), S-Curve Analysis, Performance Assessment, Variance Analysis by Work Package, Forecast Scenarios (optimistic/likely/pessimistic), Recovery Plan Recommendations.`,
    STAKEHOLDER: `Generate a STAKEHOLDER UPDATE email. Keep it professional, concise, and action-oriented. Include: Progress Summary (3-4 bullets), Key Achievements This Period, Upcoming Milestones, Items Requiring Attention, Budget Summary (one line). Tone: confident but transparent.`,
    BUDGET: `Generate a BUDGET REPORT. Include: Budget Summary (BAC, Actual, Committed, Remaining), Cost Breakdown by Category, Variance Analysis, Contingency Status, Forecast to Completion, Cost Risks, Recommendations.`,
    PHASE_GATE: `Generate a PHASE GATE REVIEW report. Include: Gate Readiness Assessment, Prerequisite Checklist (each artefact status), Outstanding Items, Risk Assessment for Next Phase, Resource Readiness, Quality Assessment, Gate Decision Recommendation (Proceed/Conditional/Hold).`,
  };

  return `You are an enterprise project management AI generating a formal ${type} report.

⚠️ ZERO FABRICATION RULE: NEVER invent personal names, company names, contact details, or any fact not in the data below. Use role titles instead of names. Write "Data not available" for missing information. Never claim something is confirmed, booked, or done unless explicitly stated in the data.

${typeInstructions[type] || typeInstructions.STATUS}

Use the following REAL project data — do NOT fabricate any numbers or facts. If data is missing, state "Data not available" rather than making it up.

${dataContext}

FORMAT REQUIREMENTS:
- Output valid HTML suitable for a TipTap rich text editor
- Use <h1> for the report title, <h2> for major sections, <h3> for subsections
- Use <table> with <thead>/<tbody> for any tabular data
- Use <ul>/<li> for bullet lists
- Use <strong> for emphasis on key metrics
- Use proper paragraph <p> tags
- Include a "Report Generated" footer with date and agent name
- Professional tone, evidence-based, no speculation

${sections.length > 0 ? `\nINCLUDE THESE SECTIONS: ${sections.join(", ")}` : ""}

Generate the complete report now.`;
}

/**
 * Sanitises LLM output — converts any residual markdown to HTML
 * and strips artifacts that would render badly in TipTap.
 */
function sanitiseReportHtml(raw: string): string {
  let html = raw.trim();

  // Strip wrapping markdown code fences (```html ... ```)
  html = html.replace(/^```(?:html)?\s*\n?/i, "").replace(/\n?```\s*$/, "");

  // Convert markdown headings → HTML headings
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Convert **bold** → <strong>
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Convert *italic* / _italic_ → <em> (but not inside HTML tags)
  html = html.replace(/(?<![<\w])_([^_\n]+?)_(?![>\w])/g, "<em>$1</em>");
  html = html.replace(/(?<![<\w])\*([^*\n]+?)\*(?![>\w])/g, "<em>$1</em>");

  // Convert markdown bullet lists (- item / * item) that aren't already in <ul>
  html = html.replace(/(?:^|\n)((?:[ \t]*[-*]\s+.+\n?)+)/g, (_match, block: string) => {
    // Skip if already inside a <ul> or <li>
    if (block.includes("<li>")) return block;
    const items = block.trim().split("\n")
      .map((line: string) => line.replace(/^[ \t]*[-*]\s+/, "").trim())
      .filter(Boolean)
      .map((item: string) => `<li>${item}</li>`)
      .join("\n");
    return `\n<ul>\n${items}\n</ul>\n`;
  });

  // Convert markdown numbered lists (1. item)
  html = html.replace(/(?:^|\n)((?:\d+\.\s+.+\n?)+)/g, (_match, block: string) => {
    if (block.includes("<li>")) return block;
    const items = block.trim().split("\n")
      .map((line: string) => line.replace(/^\d+\.\s+/, "").trim())
      .filter(Boolean)
      .map((item: string) => `<li>${item}</li>`)
      .join("\n");
    return `\n<ol>\n${items}\n</ol>\n`;
  });

  // Convert markdown links [text](url) → <a>
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Convert markdown horizontal rules (--- or ***) → <hr>
  html = html.replace(/^[-*]{3,}\s*$/gm, "<hr>");

  // Wrap bare text blocks (lines not starting with <) in <p> tags
  html = html.replace(/^(?!<[a-z/]|\s*$)(.+)$/gm, "<p>$1</p>");

  return html;
}

/**
 * Calls the LLM to generate the report content.
 */
export async function generateReportContent(type: string, sections: string[], data: Awaited<ReturnType<typeof gatherProjectData>>): Promise<string> {
  const prompt = buildReportPrompt(type, sections, data);

  // Try Anthropic first
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const raw = result.content[0]?.text || "<p>Report generation failed. Please try again.</p>";
        return sanitiseReportHtml(raw);
      }
    } catch (e) {
      console.error("Anthropic report generation error:", e);
    }
  }

  // Fallback: generate structured HTML from data directly
  return generateFallbackReport(type, data);
}

/**
 * Generates a structured report from data without LLM.
 */
function generateFallbackReport(type: string, data: Awaited<ReturnType<typeof gatherProjectData>>): string {
  const { project, metrics, topRisks, recentIssues, recentActivities, phases } = data;
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return `
<h1>${type.replace(/_/g, " ")} Report — ${project.name}</h1>
<p><em>Generated ${date} by Projectoolbox AI</em></p>

<h2>Executive Summary</h2>
<p>${project.name} is currently <strong>${project.status}</strong> using ${project.methodology} methodology.
Overall progress stands at <strong>${metrics.progressPct}%</strong> with ${metrics.doneTasks} of ${metrics.totalTasks} tasks completed
(${metrics.doneSP}/${metrics.totalSP} story points). The project has ${metrics.criticalRisks} critical risk${metrics.criticalRisks !== 1 ? "s" : ""}
and ${metrics.openIssues} open issue${metrics.openIssues !== 1 ? "s" : ""} requiring attention.</p>

<h2>Project Status</h2>
<table>
<thead><tr><th>Metric</th><th>Value</th><th>Status</th></tr></thead>
<tbody>
<tr><td>Overall Progress</td><td>${metrics.progressPct}%</td><td>${metrics.progressPct >= 70 ? "🟢 On Track" : metrics.progressPct >= 40 ? "🟡 At Risk" : "🔴 Behind"}</td></tr>
<tr><td>Tasks Completed</td><td>${metrics.doneTasks} / ${metrics.totalTasks}</td><td>${metrics.blockedTasks > 0 ? "🟡 " + metrics.blockedTasks + " blocked" : "🟢 No blockers"}</td></tr>
<tr><td>Story Points</td><td>${metrics.doneSP} / ${metrics.totalSP} SP</td><td>${metrics.doneSP > metrics.totalSP * 0.5 ? "🟢" : "🟡"}</td></tr>
<tr><td>Open Risks</td><td>${metrics.totalRisks} (${metrics.criticalRisks} critical)</td><td>${metrics.criticalRisks > 2 ? "🔴 High" : metrics.criticalRisks > 0 ? "🟡 Medium" : "🟢 Low"}</td></tr>
<tr><td>Open Issues</td><td>${metrics.openIssues}</td><td>${metrics.openIssues > 5 ? "🟡" : "🟢"}</td></tr>
<tr><td>Pending Approvals</td><td>${metrics.pendingApprovals}</td><td>${metrics.pendingApprovals > 3 ? "🟡" : "🟢"}</td></tr>
<tr><td>Budget</td><td>£${(project.budget || 0).toLocaleString()}</td><td>— No spend data</td></tr>
</tbody>
</table>

<h2>Phase Progress</h2>
<table>
<thead><tr><th>Phase</th><th>Status</th></tr></thead>
<tbody>
${phases.map(p => `<tr><td>${p.name}</td><td>${p.status === "COMPLETED" ? "✅ Complete" : p.status === "ACTIVE" ? "🔵 In Progress" : "⬜ Pending"}</td></tr>`).join("\n")}
</tbody>
</table>

${topRisks.length > 0 ? `
<h2>Key Risks</h2>
<table>
<thead><tr><th>Risk</th><th>P</th><th>I</th><th>Score</th><th>Status</th><th>Owner</th></tr></thead>
<tbody>
${topRisks.map(r => `<tr><td>${r.title}</td><td>${r.probability}</td><td>${r.impact}</td><td><strong>${r.score}</strong></td><td>${r.status}</td><td>${r.owner || "—"}</td></tr>`).join("\n")}
</tbody>
</table>
` : ""}

${recentIssues.length > 0 ? `
<h2>Open Issues</h2>
<ul>
${recentIssues.map(i => `<li><strong>[${i.priority}]</strong> ${i.title} — ${i.status}</li>`).join("\n")}
</ul>
` : ""}

${recentActivities.length > 0 ? `
<h2>Recent Agent Activity</h2>
<ul>
${recentActivities.map(a => `<li>${a.date}: <strong>${a.agent}</strong> — ${a.summary}</li>`).join("\n")}
</ul>
` : ""}

<h2>Recommendations</h2>
<ul>
${metrics.criticalRisks > 0 ? `<li>Address ${metrics.criticalRisks} critical risk${metrics.criticalRisks > 1 ? "s" : ""} — schedule risk review meeting</li>` : ""}
${metrics.blockedTasks > 0 ? `<li>Unblock ${metrics.blockedTasks} blocked task${metrics.blockedTasks > 1 ? "s" : ""} — escalate blockers</li>` : ""}
${metrics.pendingApprovals > 0 ? `<li>Process ${metrics.pendingApprovals} pending approval${metrics.pendingApprovals > 1 ? "s" : ""}</li>` : ""}
${metrics.pendingCRs > 0 ? `<li>Review ${metrics.pendingCRs} pending change request${metrics.pendingCRs > 1 ? "s" : ""}</li>` : ""}
<li>Continue monitoring progress against schedule baseline</li>
</ul>

<hr>
<p><em>Report generated by Projectoolbox AI on ${date}. ${data.agent ? `Agent ${data.agent.name} (L${data.agent.autonomyLevel})` : "System"} compiled this report from live project data.</em></p>
`;
}
