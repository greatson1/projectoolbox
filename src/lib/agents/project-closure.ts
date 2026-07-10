/**
 * Project Closure Pipeline
 *
 * Triggered when the final phase gate is approved. Handles:
 *   1. Closure enforcement gate — blocks if open items remain
 *   2. Auto-generate closure report artefact
 *   3. Consolidate agent activities into AuditLog
 *   4. Auto-archive project + agents
 *   5. Final notification
 *
 * Applies to ALL methodologies — the closure scan adapts to whatever
 * artefacts and data exist for the project.
 */

import { db } from "@/lib/db";

import { HEAVY_MODEL_REQUEST } from "@/lib/ai-models";

export interface ClosureResult {
  success: boolean;
  blockers: string[];
  closureReportId?: string;
  auditEntriesConsolidated: number;
  archivedAt?: string;
}

/**
 * Run the full project closure pipeline. Called from the approval handler
 * when getNextPhase() returns null (no more phases).
 */
export async function runProjectClosure(
  projectId: string,
  agentId: string,
  approvedBy: string,
): Promise<ClosureResult> {
  const result: ClosureResult = {
    success: false,
    blockers: [],
    auditEntriesConsolidated: 0,
  };

  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, orgId: true, budget: true, methodology: true },
    });
    if (!project) { result.blockers.push("Project not found"); return result; }

    // ── 1. Closure enforcement gate ──────────────────────────────────────
    const openTasks = await db.task.count({
      where: { projectId, status: { notIn: ["DONE", "COMPLETED", "CANCELLED"] }, NOT: { description: { contains: "[scaffolded]" } } },
    });
    const openRisks = await db.risk.count({
      where: { projectId, status: { notIn: ["CLOSED", "MITIGATED", "ACCEPTED", "TRANSFERRED"] } },
    });
    const openIssues = await db.issue.count({
      where: { projectId, status: { notIn: ["CLOSED", "RESOLVED"] } },
    });
    const pendingApprovals = await db.approval.count({
      where: { projectId, status: "PENDING" },
    });
    const unapprovedArtefacts = await db.agentArtefact.count({
      where: { projectId, status: { in: ["DRAFT", "PENDING_REVIEW"] } },
    });

    if (openTasks > 0) result.blockers.push(`${openTasks} open task(s) — close, cancel, or transfer before closure`);
    if (openRisks > 0) result.blockers.push(`${openRisks} open risk(s) — close, accept, or transfer`);
    if (openIssues > 0) result.blockers.push(`${openIssues} open issue(s) — resolve or close`);
    if (pendingApprovals > 0) result.blockers.push(`${pendingApprovals} pending approval(s) — approve or reject`);
    if (unapprovedArtefacts > 0) result.blockers.push(`${unapprovedArtefacts} unapproved artefact(s) — approve or reject`);

    // Non-blocking warnings (logged but don't prevent closure)
    const warnings: string[] = [];

    // Check for lessons learned artefact
    const lessonsArtefact = await db.agentArtefact.findFirst({
      where: { projectId, name: { contains: "Lessons", mode: "insensitive" as any }, status: "APPROVED" },
    });
    if (!lessonsArtefact) warnings.push("No approved Lessons Learned document — consider capturing lessons before closure");

    // ── 2. Generate closure report ──────────────────────────────────────
    // Even if there are blockers, generate the report — it helps the user
    // see what needs attention. But only auto-archive if zero blockers.

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        // Gather all project data for the closure report
        const [artefacts, tasks, risks, issues, costs, stakeholders, benefits, phases, activities] = await Promise.all([
          db.agentArtefact.findMany({ where: { projectId, status: "APPROVED" }, select: { name: true, format: true, version: true, updatedAt: true }, orderBy: { updatedAt: "asc" } }),
          db.task.findMany({ where: { projectId, NOT: { description: { contains: "[scaffolded]" } } }, select: { title: true, status: true, progress: true } }),
          db.risk.findMany({ where: { projectId }, select: { title: true, status: true, score: true, category: true } }),
          db.issue.findMany({ where: { projectId }, select: { title: true, status: true, priority: true } }),
          db.costEntry.findMany({ where: { projectId }, select: { description: true, amount: true, entryType: true, category: true } }),
          db.stakeholder.findMany({ where: { projectId }, select: { name: true, role: true } }),
          db.benefit.findMany({ where: { projectId }, select: { name: true, status: true, targetValue: true, realisedValue: true } }),
          db.phase.findMany({ where: { projectId }, select: { name: true, status: true, gateApprovedAt: true }, orderBy: { order: "asc" } }),
          db.agentActivity.findMany({ where: { agentId }, select: { type: true, summary: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 }),
        ]);

        const totalBudget = project.budget || 0;
        const estimatedCosts = costs.filter((c: any) => c.entryType === "ESTIMATE").reduce((s: number, c: any) => s + (c.amount || 0), 0);
        const actualCosts = costs.filter((c: any) => c.entryType === "ACTUAL").reduce((s: number, c: any) => s + (c.amount || 0), 0);
        const completedTasks = tasks.filter((t: any) => t.status === "DONE" || t.status === "COMPLETED").length;

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            ...HEAVY_MODEL_REQUEST,
            max_tokens: 8192,
            messages: [{
              role: "user",
              content: `Generate a comprehensive Project Closure Report for "${project.name}" (methodology: ${project.methodology || "Traditional"}).

PROJECT DATA:
- Phases completed: ${phases.map((p: any) => `${p.name} (${p.status}${p.gateApprovedAt ? `, gate approved ${new Date(p.gateApprovedAt).toLocaleDateString("en-GB")}` : ""})`).join(", ")}
- Artefacts approved: ${artefacts.length} (${artefacts.map((a: any) => a.name).join(", ")})
- Tasks: ${completedTasks}/${tasks.length} completed
- Risks: ${risks.length} identified (${risks.filter((r: any) => r.status === "CLOSED" || r.status === "MITIGATED").length} closed/mitigated)
- Issues: ${issues.length} raised (${issues.filter((i: any) => i.status === "CLOSED" || i.status === "RESOLVED").length} resolved)
- Budget: ${totalBudget > 0 ? `Planned: ${totalBudget}, Estimated: ${estimatedCosts}, Actual: ${actualCosts}, Variance: ${totalBudget - actualCosts}` : "Not set"}
- Stakeholders: ${stakeholders.length} (${stakeholders.slice(0, 5).map((s: any) => s.role || s.name).join(", ")})
- Benefits: ${benefits.length} (${benefits.filter((b: any) => b.status === "REALISED").length} realised)
${result.blockers.length > 0 ? `\n⚠️ OPEN ITEMS (blocking clean closure):\n${result.blockers.map(b => `- ${b}`).join("\n")}` : ""}
${warnings.length > 0 ? `\n⚠️ WARNINGS:\n${warnings.map(w => `- ${w}`).join("\n")}` : ""}

Generate a formal Project Closure Report in markdown with these sections:
1. **Executive Summary** — project objectives, overall outcome, key achievements
2. **Scope Delivery** — what was delivered vs what was planned, any scope changes
3. **Schedule Performance** — phases completed, timeline adherence, delays
4. **Cost Performance** — budget vs actual, variance analysis
5. **Risk & Issue Summary** — key risks materialised, issues resolved, lessons
6. **Stakeholder Satisfaction** — engagement outcomes
7. **Benefits Realisation** — benefits achieved vs planned, outstanding benefits
8. **Lessons Learned** — what went well, what to improve, recommendations
9. **Outstanding Items** — any open tasks, risks, or issues requiring handover
10. **Formal Sign-off** — closure recommendation, sign-off block

Be specific to this project's actual data. Reference real artefact names, task counts, and budget figures.`,
            }],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const reportContent = data.content?.[0]?.text || "";

          if (reportContent) {
            const closureArtefact = await db.agentArtefact.create({
              data: {
                agentId,
                projectId,
                name: "Project Closure Report",
                format: "markdown",
                content: reportContent,
                status: result.blockers.length === 0 ? "APPROVED" : "DRAFT",
                version: 1,
              },
            });
            result.closureReportId = closureArtefact.id;

            await db.agentActivity.create({
              data: { agentId, type: "document", summary: `Project Closure Report generated${result.blockers.length > 0 ? " (DRAFT — open items remain)" : " and auto-approved"}` },
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.error("[project-closure] Closure report generation failed:", e);
      }
    }

    // ── 3. Consolidate agent activities into AuditLog ────────────────────
    try {
      const unconsolidated = await db.agentActivity.findMany({
        where: { agentId },
        select: { id: true, type: true, summary: true, metadata: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      let consolidated = 0;
      for (const act of unconsolidated) {
        await db.auditLog.create({
          data: {
            orgId: project.orgId,
            action: `AGENT_${act.type.toUpperCase()}`,
            target: act.summary?.slice(0, 200) || "",
            entityType: "agent_activity",
            entityId: act.id,
            agentId,
            projectId,
            rationale: act.summary || "",
            details: act.metadata as any,
            createdAt: act.createdAt,
          },
        }).catch(() => {});
        consolidated++;
      }
      result.auditEntriesConsolidated = consolidated;
    } catch (e) {
      console.error("[project-closure] Audit consolidation failed:", e);
    }

    // ── 4. Auto-archive if no blockers ──────────────────────────────────
    if (result.blockers.length === 0) {
      try {
        const now = new Date();

        // Archive the project
        await db.project.update({
          where: { id: projectId },
          data: {
            status: "ARCHIVED",
            archivedAt: now,
            archivedBy: approvedBy,
            archiveReason: "Project lifecycle complete — all phases approved",
          },
        });

        // Deactivate all agent deployments
        await db.agentDeployment.updateMany({
          where: { projectId, isActive: true },
          data: { isActive: false, phaseStatus: "complete" },
        });

        // Archive the agent
        await db.agent.updateMany({
          where: { id: agentId },
          data: {
            archivedAt: now,
            archivedBy: approvedBy,
            archiveReason: `Project "${project.name}" completed`,
            status: "ARCHIVED",
          },
        });

        result.archivedAt = now.toISOString();

        // Notification hygiene: clear unread notifications pointing at the
        // archived project/agent so they stop inflating the bell count
        // (Notification has no projectId column — match on actionUrl).
        await db.notification.updateMany({
          where: {
            isRead: false,
            user: { orgId: project.orgId },
            OR: [
              { actionUrl: { contains: `/projects/${projectId}` } },
              { actionUrl: { contains: `/agents/${agentId}` } },
            ],
          },
          data: { isRead: true },
        }).catch(() => {});

        // Final audit log entry
        await db.auditLog.create({
          data: {
            orgId: project.orgId,
            userId: approvedBy,
            action: "PROJECT_COMPLETED",
            target: project.name,
            entityType: "project",
            entityId: projectId,
            rationale: `Project lifecycle complete. ${result.auditEntriesConsolidated} agent activities consolidated. Closure report ${result.closureReportId ? "generated" : "skipped"}.`,
            details: {
              closureReportId: result.closureReportId,
              auditEntriesConsolidated: result.auditEntriesConsolidated,
            } as any,
          },
        }).catch(() => {});

        result.success = true;
      } catch (e) {
        console.error("[project-closure] Auto-archive failed:", e);
        result.blockers.push("Auto-archive failed — archive manually");
      }
    } else {
      // Blockers exist — don't archive, but report is generated
      await db.agentActivity.create({
        data: {
          agentId,
          type: "approval",
          summary: `⛔ Project closure blocked:\n${result.blockers.map(b => `• ${b}`).join("\n")}\n\nResolve these items, then the project will auto-archive on the next closure attempt.`,
        },
      }).catch(() => {});
    }

    return result;
  } catch (e) {
    console.error("[project-closure] Pipeline failed:", e);
    result.blockers.push(`Closure pipeline error: ${(e as any)?.message || "unknown"}`);
    return result;
  }
}
