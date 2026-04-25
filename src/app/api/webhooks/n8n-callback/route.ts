/**
 * POST /api/webhooks/n8n-callback
 *
 * Callback endpoint for n8n workflows to write results back to Projectoolbox.
 * Each workflow type maps to a handler that processes the result data.
 *
 * Auth: N8N_CALLBACK_SECRET env var (checked via x-callback-secret header)
 *
 * Body: {
 *   workflowType: string,     — which workflow is calling back
 *   orgId?: string,           — target organisation
 *   agentId?: string,         — target agent
 *   projectId?: string,       — target project
 *   action: string,           — what to do (e.g. "store_kb", "create_notification", "update_approval")
 *   data: Record<string, any> — action-specific payload
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Auth check
  const secret = process.env.N8N_CALLBACK_SECRET;
  if (secret) {
    const provided = req.headers.get("x-callback-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Invalid callback secret" }, { status: 401 });
    }
  }

  try {
    const body = await req.json();
    const { workflowType, orgId, agentId, projectId, action, data } = body;

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    const results: any[] = [];

    switch (action) {
      // ── Store item(s) to Knowledge Base ─────────────────────────────
      case "store_kb": {
        const items = Array.isArray(data.items) ? data.items : [data];
        for (const item of items) {
          const created = await db.knowledgeBaseItem.create({
            data: {
              orgId: orgId || item.orgId,
              agentId: agentId || item.agentId || null,
              projectId: projectId || item.projectId || null,
              layer: item.layer || "PROJECT",
              type: item.type || "TEXT",
              title: item.title,
              content: item.content,
              trustLevel: item.trustLevel || "STANDARD",
              tags: item.tags || [],
              sourceUrl: item.sourceUrl || null,
              metadata: { source: "n8n", workflowType },
            },
          });
          results.push({ id: created.id, title: created.title });
        }
        break;
      }

      // ── Create notification(s) ──────────────────────────────────────
      case "create_notification": {
        const users = await db.user.findMany({
          where: { orgId },
          select: { id: true },
        });
        for (const u of users) {
          await db.notification.create({
            data: {
              userId: u.id,
              type: data.type || "SYSTEM",
              title: data.title,
              body: data.body || "",
              actionUrl: data.actionUrl || null,
            },
          });
        }
        results.push({ notified: users.length });
        break;
      }

      // ── Update approval status ──────────────────────────────────────
      case "update_approval": {
        if (!data.approvalId || !data.status) {
          return NextResponse.json({ error: "Missing approvalId or status" }, { status: 400 });
        }
        await db.approval.update({
          where: { id: data.approvalId },
          data: { status: data.status, resolvedAt: new Date() },
        });
        results.push({ updated: data.approvalId });
        break;
      }

      // ── Log agent activity ──────────────────────────────────────────
      case "log_activity": {
        if (!agentId) {
          return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
        }
        await db.agentActivity.create({
          data: {
            agentId,
            type: data.type || "system",
            summary: data.summary || `n8n callback: ${workflowType}`,
            metadata: data.metadata || null,
          },
        });
        results.push({ logged: true });
        break;
      }

      // ── Create chat message (agent posting back) ────────────────────
      case "create_chat_message": {
        if (!agentId) {
          return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
        }
        await db.chatMessage.create({
          data: {
            agentId,
            role: data.role || "agent",
            content: data.content,
            metadata: data.metadata || null,
          },
        });
        results.push({ posted: true });
        break;
      }

      // ── Store meeting record ────────────────────────────────────────
      case "store_meeting": {
        const meeting = await db.meeting.create({
          data: {
            orgId,
            agentId: agentId || null,
            projectId: projectId || null,
            title: data.title,
            rawTranscript: data.transcript || null,
            summary: data.summary || null,
            status: data.status || "COMPLETED",
            platform: data.platform || "n8n",
            duration: data.duration || null,
          },
        });
        results.push({ meetingId: meeting.id });

        // Sentiment: analyze the meeting body (prefer summary if present —
        // raw transcripts are noisy and Haiku will dilute the signal).
        // Fire-and-forget so the webhook stays fast.
        const meetingText = (data.summary && String(data.summary).trim().length > 20)
          ? String(data.summary)
          : (data.transcript ? String(data.transcript).slice(0, 6000) : "");
        if (meetingText) {
          import("@/lib/sentiment/recorder").then(({ recordSentiment }) => {
            recordSentiment({
              orgId,
              text: meetingText,
              subjectType: "meeting",
              subjectId: meeting.id,
              context: "meeting transcript",
            }).catch((e) => console.error("[n8n-callback] meeting sentiment record failed:", e));
          }).catch(() => {});
        }
        break;
      }

      // ── Send email via Resend ───────────────────────────────────────
      case "send_email": {
        if (!process.env.RESEND_API_KEY) {
          return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 503 });
        }
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: data.from || "Projectoolbox <notifications@projectoolbox.com>",
            to: data.to,
            subject: data.subject,
            html: data.html,
          }),
        });
        results.push({ sent: emailRes.ok });
        break;
      }

      // ── Store artefact ──────────────────────────────────────────────
      case "store_artefact": {
        if (!agentId || !projectId) {
          return NextResponse.json({ error: "Missing agentId or projectId" }, { status: 400 });
        }
        const artefact = await db.agentArtefact.create({
          data: {
            agentId,
            projectId,
            name: data.name,
            format: data.format || "markdown",
            content: data.content,
            status: "DRAFT",
            phaseId: data.phaseId || null,
          },
        });
        results.push({ artefactId: artefact.id, name: artefact.name });
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action, results });
  } catch (err: any) {
    console.error("[n8n-callback] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
