/**
 * Execution-phase context scan.
 *
 * Replaces the outward-looking Perplexity research that the front-of-project
 * pipeline runs. By Execution, the team has already decided what they're
 * building — what they actually need is an *inward* look at their own
 * project: schedule drift, risk materialisation, cost variance, open
 * issues. So we scan the DB and produce a ResearchResult-shaped report
 * that the existing chat-card UI and clarification seeder can consume
 * unchanged.
 *
 * Cheap: 5 indexed queries against the project's own tables, no external
 * API call. Returns within a second.
 */

import { db } from "@/lib/db";
import type { ResearchResult } from "./feasibility-research";

function pct(n: number, d: number): string {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

export async function runExecutionProgressScan(
  agentId: string,
  projectId: string,
  phaseName: string,
): Promise<ResearchResult> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, budget: true, startDate: true, endDate: true },
  });
  if (!project) {
    return { factsDiscovered: 0, queries: [], summary: "Project not found", sections: [], facts: [] };
  }

  const now = new Date();

  // Run the heavy reads in parallel — all are indexed.
  const [tasks, risks, issues, costsByType] = await Promise.all([
    db.task.findMany({
      where: { projectId },
      select: { status: true, endDate: true, isCriticalPath: true, blocked: true, title: true, progress: true },
    }),
    db.risk.findMany({
      where: { projectId, status: "OPEN" },
      select: { title: true, probability: true, impact: true, score: true, category: true },
    }),
    db.issue.findMany({
      where: { projectId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      select: { title: true, priority: true },
    }),
    db.costEntry.groupBy({
      by: ["entryType"],
      where: { projectId },
      _sum: { amount: true },
    }),
  ]);

  // ── Tasks ────────────────────────────────────────────────────────────
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.status === "DONE" || t.status === "COMPLETED").length;
  const inProgressTasks = tasks.filter(t => t.status === "IN_PROGRESS").length;
  const blockedTasks = tasks.filter(t => t.blocked).length;
  const overdueTasks = tasks.filter(t => t.endDate && t.endDate < now && t.status !== "DONE" && t.status !== "COMPLETED");
  const overdueCriticalPath = overdueTasks.filter(t => t.isCriticalPath);

  // ── Risks ────────────────────────────────────────────────────────────
  const totalOpenRisks = risks.length;
  // "Materialised" proxy: high impact and high probability (score >= 12 on
  // a 1-5×1-5 scale). These are the ones likely already biting the project.
  const materialisedRisks = risks.filter(r => (r.score ?? r.probability * r.impact) >= 12);

  // ── Costs ────────────────────────────────────────────────────────────
  const sumOf = (t: string) => Number(costsByType.find(c => c.entryType === t)?._sum.amount ?? 0);
  const estimate = sumOf("ESTIMATE");
  const actual = sumOf("ACTUAL");
  const committed = sumOf("COMMITMENT");
  const budget = project.budget ?? 0;
  const burnPct = budget > 0 ? Math.round(((actual + committed) / budget) * 100) : null;
  const variance = budget > 0 ? budget - (actual + committed) : null;

  // ── Schedule envelope ────────────────────────────────────────────────
  let scheduleSummary = "";
  if (project.startDate && project.endDate) {
    const total = project.endDate.getTime() - project.startDate.getTime();
    const elapsed = Math.max(0, now.getTime() - project.startDate.getTime());
    const pctElapsed = Math.round((elapsed / total) * 100);
    const daysRemaining = Math.max(0, Math.round((project.endDate.getTime() - now.getTime()) / 86_400_000));
    scheduleSummary = `${pctElapsed}% of project window elapsed · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining to planned end date.`;
  }

  // ── Build the report ─────────────────────────────────────────────────
  // ResearchSection is `{label, content}` — content is a single string so
  // we render each bullet on its own line.
  const sectionData: { label: string; bullets: string[] }[] = [
    {
      label: "Delivery progress",
      bullets: [
        `${doneTasks}/${totalTasks} tasks complete (${pct(doneTasks, totalTasks)})`,
        `${inProgressTasks} in progress · ${blockedTasks} blocked`,
        `${overdueTasks.length} task${overdueTasks.length === 1 ? "" : "s"} past planned end date` +
          (overdueCriticalPath.length > 0 ? ` · ${overdueCriticalPath.length} on the critical path` : ""),
        scheduleSummary || "Schedule dates not set — drift cannot be calculated.",
      ],
    },
    {
      label: "Risk posture",
      bullets: totalOpenRisks === 0
        ? ["No open risks on the register — confirm this is real, not a gap in capture."]
        : [
          `${totalOpenRisks} open risk${totalOpenRisks === 1 ? "" : "s"} on the register`,
          materialisedRisks.length > 0
            ? `${materialisedRisks.length} high-score risk${materialisedRisks.length === 1 ? "" : "s"} (probability × impact ≥ 12) — likely already affecting delivery`
            : "No high-score risks — monitoring only",
          ...materialisedRisks.slice(0, 3).map(r => `↑ ${r.title}${r.category ? ` (${r.category})` : ""}`),
        ],
    },
    {
      label: "Budget burn",
      bullets: budget > 0 ? [
        `Budget: ${gbp(budget)} · Actual: ${gbp(actual)} · Committed: ${gbp(committed)}` + (estimate ? ` · Estimate: ${gbp(estimate)}` : ""),
        burnPct !== null ? `${burnPct}% of budget consumed (actual + committed)` : "Burn not calculable",
        variance !== null
          ? variance >= 0
            ? `${gbp(variance)} remaining vs. budget`
            : `${gbp(Math.abs(variance))} OVER budget — escalate before further commitments`
          : "",
      ].filter(Boolean) : ["Project budget not set — cost variance cannot be calculated."],
    },
    {
      label: "Open issues",
      bullets: issues.length === 0
        ? ["No open issues logged."]
        : [
          `${issues.length} open issue${issues.length === 1 ? "" : "s"}`,
          ...issues.slice(0, 5).map(i => `· ${i.priority || "MEDIUM"} — ${i.title}`),
        ],
    },
  ];
  const sections = sectionData.map(s => ({
    label: s.label,
    content: s.bullets.map(b => `• ${b}`).join("\n"),
  }));

  // The chat card renders `facts` as a separate bullet list. Use it for
  // the items that need the user's most direct attention.
  const facts: { title: string; content: string }[] = [];
  if (overdueCriticalPath.length > 0) {
    facts.push({
      title: `${overdueCriticalPath.length} critical-path task${overdueCriticalPath.length === 1 ? "" : "s"} overdue`,
      content: overdueCriticalPath.slice(0, 5).map(t => t.title).join("; "),
    });
  }
  if (variance !== null && variance < 0) {
    facts.push({
      title: "Budget overrun",
      content: `${gbp(Math.abs(variance))} above the planned budget of ${gbp(budget)} (actual + committed).`,
    });
  }
  if (materialisedRisks.length > 0) {
    facts.push({
      title: "High-score risks likely materialised",
      content: materialisedRisks.slice(0, 3).map(r => r.title).join("; "),
    });
  }
  if (blockedTasks > 0) {
    facts.push({
      title: `${blockedTasks} task${blockedTasks === 1 ? "" : "s"} blocked`,
      content: "Blocked tasks halt downstream work — clear or escalate before generating the status report.",
    });
  }

  const factsDiscovered = sectionData.reduce((n, s) => n + s.bullets.length, 0) + facts.length;

  return {
    factsDiscovered,
    queries: [`Internal progress scan for "${phaseName}" phase of "${project.name}"`],
    summary: `Scanned ${totalTasks} task${totalTasks === 1 ? "" : "s"}, ${totalOpenRisks} open risk${totalOpenRisks === 1 ? "" : "s"}, ${issues.length} open issue${issues.length === 1 ? "" : "s"} and the cost ledger to surface ${facts.length} item${facts.length === 1 ? "" : "s"} that need your attention before generating ${phaseName} artefacts.`,
    sections,
    facts,
  };
}
