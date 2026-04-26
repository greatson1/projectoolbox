import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/kb-action
 *
 * One-click handler for the inline "Pending decision" and "Action suggestion"
 * cards posted to chat by the meeting processor.
 *
 * Body:
 *   { action: "confirm",           kbItemId }   → drop pending_user_confirmation
 *                                                  + needs_review tags, lift trust
 *                                                  to HIGH_TRUST
 *   { action: "discard",           kbItemId }   → delete the KB item
 *   { action: "apply_task_done",   projectId, taskId } → mark task DONE
 *   { action: "apply_risk_close",  projectId, riskId } → mark risk CLOSED
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { id: agentId } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "action required" }, { status: 400 });

  try {
    if (body.action === "confirm") {
      const item = await db.knowledgeBaseItem.findFirst({
        where: { id: body.kbItemId, orgId, agentId },
        select: { id: true, tags: true, content: true },
      });
      if (!item) return NextResponse.json({ error: "KB item not found" }, { status: 404 });
      const newTags = (item.tags || []).filter(
        (t) => t !== "pending_user_confirmation" && t !== "needs_review",
      );
      newTags.push("user_confirmed");
      await db.knowledgeBaseItem.update({
        where: { id: item.id },
        data: {
          tags: newTags,
          trustLevel: "HIGH_TRUST",
          // Strip the inline " · NEEDS REVIEW" / "Flagged for confirmation…" caveat
          // we wrote at storage time, since it's now confirmed.
          content: item.content
            .replace(/\s*·\s*NEEDS REVIEW/g, "")
            .replace(/\nFlagged for confirmation[^\n]*\n?/g, "\n")
            .replace(/\n\nFlagged for confirmation[^\n]*$/g, "")
            .trim(),
        },
      });
      return NextResponse.json({ data: { ok: true, action: "confirmed", kbItemId: item.id } });
    }

    if (body.action === "edit") {
      // Edit + confirm: caller passes a corrected text; we update the KB
      // item, treat it as user-confirmed (HIGH_TRUST), drop pending tags,
      // and strip any "NEEDS REVIEW" caveats. Saves a discard-and-recreate.
      const item = await db.knowledgeBaseItem.findFirst({
        where: { id: body.kbItemId, orgId, agentId },
        select: { id: true, tags: true, content: true, title: true },
      });
      if (!item) return NextResponse.json({ error: "KB item not found" }, { status: 404 });
      const newText: string | undefined = body.text;
      if (!newText || !newText.trim()) {
        return NextResponse.json({ error: "text required" }, { status: 400 });
      }
      const newTags = (item.tags || []).filter(
        (t) => t !== "pending_user_confirmation" && t !== "needs_review",
      );
      newTags.push("user_confirmed", "user_edited");
      // Re-build content using a clean structure — preserve "Made by"/"Rationale" if we can parse them.
      const byMatch = item.content.match(/Made by:\s*([^\n]+)/i);
      const rationaleMatch = item.content.match(/Rationale:\s*([^\n]+)/i);
      const rebuilt = [
        `Decision: ${newText.trim()}`,
        byMatch ? `Made by: ${byMatch[1].trim()}` : null,
        rationaleMatch ? `Rationale: ${rationaleMatch[1].trim()}` : null,
        `Edited and confirmed by user on ${new Date().toLocaleDateString("en-GB")}`,
      ].filter(Boolean).join("\n");
      await db.knowledgeBaseItem.update({
        where: { id: item.id },
        data: {
          tags: newTags,
          trustLevel: "HIGH_TRUST",
          title: newText.trim().slice(0, 120),
          content: rebuilt,
        },
      });
      return NextResponse.json({ data: { ok: true, action: "edited", kbItemId: item.id, newText: newText.trim() } });
    }

    if (body.action === "discard") {
      const item = await db.knowledgeBaseItem.findFirst({
        where: { id: body.kbItemId, orgId, agentId },
        select: { id: true },
      });
      if (!item) return NextResponse.json({ error: "KB item not found" }, { status: 404 });
      await db.knowledgeBaseItem.delete({ where: { id: item.id } });
      return NextResponse.json({ data: { ok: true, action: "discarded", kbItemId: item.id } });
    }

    if (body.action === "apply_task_done") {
      if (!body.projectId || !body.taskId) {
        return NextResponse.json({ error: "projectId + taskId required" }, { status: 400 });
      }
      // Verify the task belongs to a project in this org
      const task = await db.task.findFirst({
        where: { id: body.taskId, project: { orgId } },
        select: { id: true },
      });
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      await db.task.update({
        where: { id: body.taskId },
        data: { status: "DONE", progress: 100 },
      });
      return NextResponse.json({ data: { ok: true, action: "task_done", taskId: body.taskId } });
    }

    if (body.action === "apply_risk_close") {
      if (!body.projectId || !body.riskId) {
        return NextResponse.json({ error: "projectId + riskId required" }, { status: 400 });
      }
      const risk = await db.risk.findFirst({
        where: { id: body.riskId, project: { orgId } },
        select: { id: true },
      });
      if (!risk) return NextResponse.json({ error: "Risk not found" }, { status: 404 });
      await db.risk.update({
        where: { id: body.riskId },
        data: { status: "CLOSED" },
      });
      return NextResponse.json({ data: { ok: true, action: "risk_closed", riskId: body.riskId } });
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (e: any) {
    console.error("[kb-action] failed:", e);
    return NextResponse.json({ error: e.message || "Action failed" }, { status: 500 });
  }
}