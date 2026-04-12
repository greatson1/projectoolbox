/**
 * Cron: Run Report Schedules
 *
 * Called by the Vercel cron every hour (via vercel.json or agent-tick).
 * Finds all active ReportSchedule rows where nextRunAt <= now,
 * generates the report, then updates lastRunAt and nextRunAt.
 *
 * GET /api/cron/run-report-schedules
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calcNextRun } from "@/app/api/reports/schedule/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Find all due, active schedules
  const dueSchedules = await db.reportSchedule.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: now },
      projectId: { not: null },
    },
  });

  if (dueSchedules.length === 0) {
    return NextResponse.json({ ok: true, ran: 0 });
  }

  let ran = 0;
  const errors: string[] = [];

  for (const schedule of dueSchedules) {
    try {
      // Build the report title
      const templateNames: Record<string, string> = {
        status: "Status Report", executive: "Executive Summary", risk: "Risk Report",
        evm: "EVM Report", sprint: "Sprint Review", stakeholder: "Stakeholder Update",
        budget: "Budget Report", phase_gate: "Phase Gate Report",
      };
      const templateName = templateNames[schedule.templateId] || schedule.name;
      const dateStr = now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

      // Resolve org owner to use as the "user" for credit deduction
      const orgOwner = await db.user.findFirst({
        where: { orgId: schedule.orgId, role: { in: ["OWNER", "ADMIN"] } },
        select: { id: true },
      });
      if (!orgOwner) continue;

      // Check credits
      const { CreditService } = await import("@/lib/credits/service");
      const hasCredits = await CreditService.checkBalance(schedule.orgId, 10);
      if (!hasCredits) {
        console.warn(`[report-cron] Skipping schedule ${schedule.id} — insufficient credits`);
        continue;
      }

      // Create report record (DRAFT)
      const report = await db.report.create({
        data: {
          orgId: schedule.orgId,
          projectId: schedule.projectId!,
          title: `${templateName} — ${dateStr}`,
          type: mapTemplateToType(schedule.templateId),
          status: "DRAFT",
          format: "HTML",
          templateId: schedule.templateId,
          creditsUsed: 10,
          recipients: schedule.recipients,
        },
      });

      // Generate content asynchronously (fire-and-forget to avoid blocking cron)
      generateAndUpdateReport(report.id, schedule.templateId, schedule.projectId!, schedule.orgId, schedule.recipients)
        .catch(e => console.error(`[report-cron] Generation failed for schedule ${schedule.id}:`, e));

      // Update schedule: mark last run and calculate next
      const [freq, dom, dow, h] = parseCron(schedule.cronExpression, schedule.frequency);
      const nextRunAt = calcNextRun(freq, dow, dom, h);

      await db.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt },
      });

      ran++;
    } catch (e: any) {
      console.error(`[report-cron] Error processing schedule ${schedule.id}:`, e);
      errors.push(`${schedule.id}: ${e.message}`);
    }
  }

  return NextResponse.json({ ok: true, ran, errors: errors.length > 0 ? errors : undefined });
}

async function generateAndUpdateReport(
  reportId: string,
  templateId: string,
  projectId: string,
  orgId: string,
  recipients: string[],
): Promise<void> {
  try {
    // Re-use the report generation logic from the shared library
    const { gatherProjectData, generateReportContent } = await import("@/lib/agents/report-generator");
    const projectData = await gatherProjectData(projectId);
    const content = await generateReportContent(templateId.toUpperCase(), [], projectData);

    await db.report.update({
      where: { id: reportId },
      data: { content, status: "PUBLISHED", publishedAt: new Date() },
    });

    // Deduct credits
    const { CreditService } = await import("@/lib/credits/service");
    await CreditService.deduct(orgId, 10, `Scheduled report: ${templateId}`, undefined).catch(() => {});

    // Activity log
    await db.agentActivity.create({
      data: {
        agentId: "system",
        type: "document",
        summary: `Scheduled ${templateId} report generated for project ${projectId}`,
      },
    }).catch(() => {});

  } catch (e) {
    await db.report.update({
      where: { id: reportId },
      data: { status: "FAILED" },
    }).catch(() => {});
    throw e;
  }
}

function mapTemplateToType(templateId: string): any {
  const map: Record<string, string> = {
    status: "STATUS", executive: "EXECUTIVE", risk: "RISK",
    evm: "EVM", sprint: "SPRINT", stakeholder: "STAKEHOLDER",
    budget: "BUDGET", phase_gate: "PHASE_GATE",
  };
  return map[templateId] || "STATUS";
}

/** Parse a cron string back to [frequency, dayOfMonth, dayOfWeek, hour] */
function parseCron(cron: string, frequency: string): [string, number, number, number] {
  const parts = cron.split(" ");
  const hour       = parseInt(parts[1]) || 9;
  const dayOfMonth = parseInt(parts[2]) || 1;
  const dayOfWeek  = parseInt(parts[4]) || 1;
  return [frequency, dayOfMonth, dayOfWeek, hour];
}
