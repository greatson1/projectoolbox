import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const INDIGO = "FF4F46E5";
const WHITE = "FFFFFFFF";

const SHEET_COLORS = [
  "FF4F46E5", // indigo — Summary
  "FF0EA5E9", // sky — Tasks
  "FFEF4444", // red — Risks
  "FFF59E0B", // amber — Issues
  "FF10B981", // emerald — Stakeholders
  "FF8B5CF6", // violet — Cost Estimate
  "FF14B8A6", // teal — Cost Actuals
];

function applyHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INDIGO } };
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF6366F1" } },
    };
  });
  row.height = 20;
}

function applyDataRow(row: ExcelJS.Row, rowIndex: number) {
  const isEven = rowIndex % 2 === 0;
  const bg = isEven ? "FFF8FAFC" : "FFFFFFFF";
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.font = { size: 10 };
    cell.alignment = { vertical: "middle", wrapText: false };
  });
  row.height = 18;
}

function autoFitColumns(sheet: ExcelJS.Worksheet, headers: string[]) {
  sheet.columns.forEach((col, i) => {
    if (!col || !col.eachCell) return;
    let maxLen = headers[i]?.length ?? 10;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value ? String(cell.value) : "";
      if (v.length > maxLen) maxLen = v.length;
    });
    col.width = Math.min(50, Math.max(12, maxLen + 2));
  });
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  tabColor: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const sheet = wb.addWorksheet(name, {
    properties: { tabColor: { argb: tabColor } },
  });

  sheet.addRow(headers);
  applyHeaderRow(sheet.lastRow!);
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  rows.forEach((r, i) => {
    sheet.addRow(r);
    applyDataRow(sheet.lastRow!, i);
  });

  autoFitColumns(sheet, headers);
  return sheet;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { projectId } = await params;

  const [project, tasks, risks, issues, stakeholders, estimateEntries, actualEntries] =
    await Promise.all([
      db.project.findUnique({
        where: { id: projectId },
        include: {
          phases: { orderBy: { order: "asc" } },
          _count: {
            select: {
              tasks: true,
              risks: { where: { status: { not: "CLOSED" } } },
              issues: { where: { status: { not: "RESOLVED" } } },
              stakeholders: true,
            },
          },
        },
      }),
      db.task.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      }),
      db.risk.findMany({
        where: { projectId },
        orderBy: { score: "desc" },
      }),
      db.issue.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      }),
      db.stakeholder.findMany({
        where: { projectId },
        orderBy: { name: "asc" },
      }),
      db.costEntry.findMany({
        where: { projectId, entryType: "ESTIMATE" },
        orderBy: { recordedAt: "asc" },
      }),
      db.costEntry.findMany({
        where: { projectId, entryType: "ACTUAL" },
        orderBy: { recordedAt: "desc" },
      }),
    ]);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Build assignee lookup from task assigneeIds
  const assigneeIds = [...new Set(tasks.map((t) => t.assigneeId).filter(Boolean))] as string[];
  const users =
    assigneeIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, name: true },
        })
      : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name ?? u.id]));

  // Phase name lookup
  const phaseMap = Object.fromEntries(project.phases.map((p) => [p.id, p.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "ProjecToolbox";
  wb.created = new Date();
  wb.modified = new Date();

  // ── Sheet 1: Summary ────────────────────────────────────────────────────────
  const summaryData: [string, string | number | null][] = [
    ["Project Name", project.name],
    ["Status", project.status],
    ["Methodology", project.methodology],
    ["Budget (£)", project.budget ?? null],
    [
      "Start Date",
      project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : null,
    ],
    [
      "End Date",
      project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : null,
    ],
    ["Team Size", project._count.stakeholders],
    ["Total Tasks", project._count.tasks],
    ["Open Risks", project._count.risks],
    ["Open Issues", project._count.issues],
  ];

  const summarySheet = wb.addWorksheet("Summary", {
    properties: { tabColor: { argb: SHEET_COLORS[0] } },
  });
  summarySheet.views = [{ state: "frozen", ySplit: 1 }];
  summarySheet.addRow(["Field", "Value"]);
  applyHeaderRow(summarySheet.lastRow!);
  summaryData.forEach(([field, value], i) => {
    summarySheet.addRow([field, value]);
    applyDataRow(summarySheet.lastRow!, i);
  });
  summarySheet.getColumn(1).width = 20;
  summarySheet.getColumn(2).width = 36;

  // ── Sheet 2: Tasks ─────────────────────────────────────────────────────────
  addSheet(
    wb,
    "Tasks",
    SHEET_COLORS[1],
    ["Title", "Phase", "Status", "Assignee", "Start Date", "End Date", "Est. Hours", "Actual Hours", "Progress %", "Priority"],
    tasks.map((t) => [
      t.title,
      (t.phaseId && phaseMap[t.phaseId]) || "Unassigned",
      t.status,
      (t.assigneeId && userMap[t.assigneeId]) || "Unassigned",
      t.startDate ? new Date(t.startDate).toLocaleDateString("en-GB") : null,
      t.endDate ? new Date(t.endDate).toLocaleDateString("en-GB") : null,
      t.estimatedHours ?? null,
      t.actualHours ?? null,
      t.progress,
      t.priority ?? null,
    ]),
  );

  // ── Sheet 3: Risks ─────────────────────────────────────────────────────────
  addSheet(
    wb,
    "Risks",
    SHEET_COLORS[2],
    ["Title", "Category", "Probability", "Impact", "Score", "Status", "Owner", "Mitigation"],
    risks.map((r) => [
      r.title,
      r.category ?? null,
      r.probability,
      r.impact,
      r.score ?? r.probability * r.impact,
      r.status,
      r.owner ?? null,
      r.mitigation ?? null,
    ]),
  );

  // ── Sheet 4: Issues ────────────────────────────────────────────────────────
  addSheet(
    wb,
    "Issues",
    SHEET_COLORS[3],
    ["Title", "Priority", "Status", "Assignee", "Due Date", "Description"],
    issues.map((i) => [
      i.title,
      i.priority,
      i.status,
      (i.assigneeId && userMap[i.assigneeId]) || "Unassigned",
      i.dueDate ? new Date(i.dueDate).toLocaleDateString("en-GB") : null,
      i.description ?? null,
    ]),
  );

  // ── Sheet 5: Stakeholders ──────────────────────────────────────────────────
  addSheet(
    wb,
    "Stakeholders",
    SHEET_COLORS[4],
    ["Name", "Role", "Email", "Organisation", "Power", "Interest", "Sentiment"],
    stakeholders.map((s) => [
      s.name,
      s.role ?? null,
      s.email ?? null,
      s.organisation ?? null,
      s.power,
      s.interest,
      s.sentiment ?? null,
    ]),
  );

  // ── Sheet 6: Cost Estimate ─────────────────────────────────────────────────
  addSheet(
    wb,
    "Cost Estimate",
    SHEET_COLORS[5],
    ["Category", "Description", "Qty", "Unit Rate (£)", "Amount (£)"],
    estimateEntries.map((e) => [
      e.category,
      e.description ?? null,
      e.unitQty ?? null,
      e.unitRate ?? null,
      e.amount,
    ]),
  );

  // ── Sheet 7: Cost Actuals ──────────────────────────────────────────────────
  addSheet(
    wb,
    "Cost Actuals",
    SHEET_COLORS[6],
    ["Date", "Category", "Description", "Vendor", "Amount (£)"],
    actualEntries.map((e) => [
      new Date(e.recordedAt).toLocaleDateString("en-GB"),
      e.category,
      e.description ?? null,
      e.vendorName ?? null,
      e.amount,
    ]),
  );

  // ── Serialise ──────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const today = new Date().toISOString().slice(0, 10);
  const safeName = project.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const filename = `${safeName}-export-${today}.xlsx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
