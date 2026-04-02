import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/agents/events — SSE stream for real-time agent activity
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgId = (session.user as any).orgId;
  if (!orgId) return new Response("No org", { status: 400 });

  const encoder = new TextEncoder();
  let lastActivityId: string | null = null;
  let lastApprovalCount = 0;
  let lastNotifCount = 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial data
      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      // Poll every 10 seconds for changes
      const poll = async () => {
        if (closed) return;

        try {
          // Check for new activities
          const latestActivity = await db.agentActivity.findFirst({
            where: { agent: { orgId } },
            orderBy: { createdAt: "desc" },
            include: { agent: { select: { name: true, gradient: true, status: true } } },
          });

          if (latestActivity && latestActivity.id !== lastActivityId) {
            lastActivityId = latestActivity.id;
            send("agent_activity", {
              id: latestActivity.id,
              type: latestActivity.type,
              summary: latestActivity.summary,
              agentName: latestActivity.agent.name,
              agentGradient: latestActivity.agent.gradient,
              createdAt: latestActivity.createdAt,
            });
          }

          // Check approval count
          const approvalCount = await db.approval.count({ where: { project: { orgId }, status: "PENDING" } });
          if (approvalCount !== lastApprovalCount) {
            lastApprovalCount = approvalCount;
            send("approval_count", { count: approvalCount });
          }

          // Check notification count
          const notifCount = await db.notification.count({ where: { userId: session.user!.id!, isRead: false } });
          if (notifCount !== lastNotifCount) {
            lastNotifCount = notifCount;
            send("notification_count", { count: notifCount });
          }

          // Credit balance
          const org = await db.organisation.findUnique({ where: { id: orgId }, select: { creditBalance: true } });
          send("credit_update", { balance: org?.creditBalance || 0 });

        } catch (e) {
          console.error("SSE poll error:", e);
        }

        if (!closed) setTimeout(poll, 10000);
      };

      // Send keepalive
      const keepalive = setInterval(() => {
        if (closed) { clearInterval(keepalive); return; }
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { closed = true; }
      }, 30000);

      // Start polling
      send("connected", { message: "SSE connected", orgId });
      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
