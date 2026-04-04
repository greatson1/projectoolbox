import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/webhooks/inbound-email
 *
 * PRIVACY: All emails are processed server-side and stored per-org.
 * Only the owning organisation's users can access their agent's emails.
 * No emails are forwarded to any external inbox.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (secret) {
    const provided = req.headers.get("x-webhook-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }
  }

  try {
    const body = await req.json();
    const { subject, text, html, _source } = body;

    // Normalise from/to
    const fromRaw = body.from;
    const toRaw = body.to;
    const senderEmail = typeof fromRaw === "string"
      ? fromRaw.match(/<([^>]+)>/)?.[1] || fromRaw
      : fromRaw?.address || "unknown";
    const recipientAddress = typeof toRaw === "string"
      ? toRaw.match(/<([^>]+)>/)?.[1] || toRaw.toLowerCase()
      : Array.isArray(toRaw)
        ? (typeof toRaw[0] === "string" ? toRaw[0] : toRaw[0]?.address || "").toLowerCase()
        : toRaw?.address?.toLowerCase() || "";

    if (!recipientAddress || !subject) {
      return NextResponse.json({ error: "Missing to/subject" }, { status: 400 });
    }

    // Find agent by email address
    const agentEmail = await db.agentEmail.findUnique({
      where: { address: recipientAddress },
      include: {
        agent: {
          include: {
            org: { select: { id: true, creditBalance: true } },
            deployments: {
              where: { isActive: true },
              include: { project: { select: { id: true, name: true } } },
              take: 1,
            },
          },
        },
      },
    });

    if (!agentEmail || !agentEmail.isActive) {
      return NextResponse.json({ status: "ignored", reason: "no_agent" });
    }

    const agent = agentEmail.agent;
    const orgId = agent.org.id;
    const activeProject = agent.deployments[0]?.project;
    const emailContent = text || html || "";

    // Update email stats
    await db.agentEmail.update({
      where: { id: agentEmail.id },
      data: { inboundCount: { increment: 1 }, lastReceived: new Date() },
    });

    // ── Email-based approvals (spec 7.1) ──
    const contentLower = emailContent.toLowerCase().trim();
    const isApprovalReply = contentLower.startsWith("approved") || contentLower.startsWith("rejected") || contentLower.includes("human");

    if (isApprovalReply) {
      // Check if sender is a known stakeholder
      const stakeholder = activeProject ? await db.stakeholder.findFirst({
        where: { projectId: activeProject.id, email: senderEmail },
      }) : null;

      if (stakeholder || contentLower.includes("human")) {
        // "HUMAN" keyword → route to PM
        if (contentLower.includes("human")) {
          const admins = await db.user.findMany({
            where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
            select: { id: true },
          });
          for (const admin of admins) {
            await db.notification.create({
              data: {
                userId: admin.id,
                type: "AGENT_ALERT",
                title: `Human contact requested by ${senderEmail}`,
                body: `A stakeholder replied to ${agent.name}'s email with "HUMAN". They want to speak to a person.\n\nOriginal message: ${emailContent.slice(0, 300)}`,
                actionUrl: "/agents/chat",
              },
            });
          }
          await db.agentActivity.create({
            data: { agentId: agent.id, type: "chat", summary: `Human contact requested by ${senderEmail} via email` },
          });
          return NextResponse.json({ status: "processed", type: "human_request" });
        }

        // "APPROVED" → find pending approval and approve
        if (contentLower.startsWith("approved")) {
          const comments = contentLower.replace(/^approved\s*(with\s*comments?\s*:?\s*)?/i, "").trim();
          const pendingApproval = await db.approval.findFirst({
            where: { projectId: activeProject?.id, status: "PENDING" },
            orderBy: { createdAt: "desc" },
          });

          if (pendingApproval) {
            await db.approval.update({
              where: { id: pendingApproval.id },
              data: { status: "APPROVED" as any, resolvedAt: new Date(), comment: comments || `Approved via email by ${senderEmail}` },
            });
            await db.agentDecision.updateMany({
              where: { approvalId: pendingApproval.id },
              data: { status: "APPROVED" as any },
            });
            try {
              const { executeApprovedAction } = await import("@/lib/agents/action-executor");
              await executeApprovedAction(pendingApproval.id);
            } catch {}

            await db.agentActivity.create({
              data: { agentId: agent.id, type: "approval", summary: `Approval "${pendingApproval.title}" approved via email by ${senderEmail}` },
            });
          }
          return NextResponse.json({ status: "processed", type: "email_approval" });
        }

        // "REJECTED" → find pending approval and reject
        if (contentLower.startsWith("rejected")) {
          const reason = contentLower.replace(/^rejected\s*:?\s*/i, "").trim();
          const pendingApproval = await db.approval.findFirst({
            where: { projectId: activeProject?.id, status: "PENDING" },
            orderBy: { createdAt: "desc" },
          });

          if (pendingApproval) {
            await db.approval.update({
              where: { id: pendingApproval.id },
              data: { status: "REJECTED" as any, resolvedAt: new Date(), comment: reason || `Rejected via email by ${senderEmail}` },
            });
            await db.agentDecision.updateMany({
              where: { approvalId: pendingApproval.id },
              data: { status: "REJECTED" as any },
            });
            await db.agentActivity.create({
              data: { agentId: agent.id, type: "approval", summary: `Approval "${pendingApproval.title}" rejected via email by ${senderEmail}` },
            });
          }
          return NextResponse.json({ status: "processed", type: "email_rejection" });
        }
      }
    }

    // Classify email
    const lowerSubject = subject.toLowerCase();
    const isCalendarInvite = emailContent.includes("BEGIN:VCALENDAR") ||
      lowerSubject.includes("invitation:") || lowerSubject.includes("invite");
    const isMeetingNotes = lowerSubject.includes("minutes") || lowerSubject.includes("notes") ||
      lowerSubject.includes("recap") || lowerSubject.includes("summary") || lowerSubject.includes("transcript");
    const isStatusUpdate = lowerSubject.includes("update") || lowerSubject.includes("status") ||
      lowerSubject.includes("report") || lowerSubject.includes("progress");

    const emailType = isCalendarInvite ? "MEETING_INVITE"
      : isMeetingNotes ? "MEETING_NOTES"
      : isStatusUpdate ? "STATUS_UPDATE"
      : "GENERAL";

    // ── Store in agent's private inbox (org-scoped) ──
    const inboxMsg = await db.agentInboxMessage.create({
      data: {
        agentId: agent.id,
        orgId,
        from: senderEmail,
        subject,
        preview: emailContent.slice(0, 500),
        type: emailType,
        status: "UNREAD",
        metadata: {
          source: _source || "direct",
          contentLength: emailContent.length,
          hasAttachments: !!(body.attachments?.length),
          hasCalendar: isCalendarInvite,
        },
      },
    });

    let processedAs: string | null = null;
    let linkedId: string | null = null;

    // ── Route: Calendar Invitation ──
    if (isCalendarInvite && activeProject) {
      const dtStartMatch = emailContent.match(/DTSTART[^:]*:(\d{8}T\d{6})/);
      const dtEndMatch = emailContent.match(/DTEND[^:]*:(\d{8}T\d{6})/);
      const locationMatch = emailContent.match(/LOCATION[^:]*:([^\r\n]+)/);

      const parseICalDate = (s: string) =>
        new Date(s.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6Z"));

      const startTime = dtStartMatch ? parseICalDate(dtStartMatch[1]) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endTime = dtEndMatch ? parseICalDate(dtEndMatch[1]) : null;

      const event = await db.calendarEvent.create({
        data: {
          orgId,
          projectId: activeProject.id,
          agentId: agent.id,
          title: subject.replace(/^(Re:|Fwd?:|Invitation:|Accepted:|Tentative:|Declined:)\s*/gi, "").trim(),
          description: `Meeting invitation from ${senderEmail}`,
          startTime,
          endTime,
          location: locationMatch?.[1]?.trim() || null,
          source: "EMAIL",
          attendees: [{ name: senderEmail, email: senderEmail }],
        },
      });

      processedAs = "calendar_event";
      linkedId = event.id;

      await db.agentActivity.create({
        data: {
          agentId: agent.id,
          type: "meeting",
          summary: `Received meeting invitation: "${subject}" from ${senderEmail}`,
        },
      });
    }

    // ── Route: Meeting Notes / Transcript ──
    else if (isMeetingNotes && activeProject && emailContent.length > 100) {
      const meeting = await db.meeting.create({
        data: {
          title: subject.replace(/^(Re:|Fwd?:)\s*/gi, "").trim(),
          orgId,
          projectId: activeProject.id,
          agentId: agent.id,
          platform: "email",
          rawTranscript: emailContent,
          status: "COMPLETED",
        },
      });

      processedAs = "meeting";
      linkedId = meeting.id;

      // Auto-process if credits available
      if (agent.org.creditBalance >= 5) {
        try {
          const { processMeetingTranscript } = await import("@/lib/agents/meeting-processor");
          await processMeetingTranscript(meeting.id);

          const { CreditService } = await import("@/lib/credits/service");
          await CreditService.deduct(orgId, 5, `Auto-processed meeting notes: ${subject}`);
        } catch (e) {
          console.error("[Inbound Email] Auto-process failed:", e);
        }
      }

      await db.agentActivity.create({
        data: {
          agentId: agent.id,
          type: "meeting",
          summary: `Received meeting notes via email: "${subject}" from ${senderEmail}`,
        },
      });
    }

    // ── Route: Status Update ──
    else if (isStatusUpdate && activeProject && emailContent.length > 200) {
      const meeting = await db.meeting.create({
        data: {
          title: `Email Update: ${subject}`,
          orgId,
          projectId: activeProject.id,
          agentId: agent.id,
          platform: "email",
          rawTranscript: emailContent,
          status: "COMPLETED",
          summary: `Status update received from ${senderEmail}.`,
        },
      });

      processedAs = "meeting";
      linkedId = meeting.id;

      await db.agentActivity.create({
        data: {
          agentId: agent.id,
          type: "document",
          summary: `Email update received: "${subject}" from ${senderEmail}`,
        },
      });
    }

    // ── Route: General ──
    else {
      processedAs = "activity_log";

      await db.agentActivity.create({
        data: {
          agentId: agent.id,
          type: "chat",
          summary: `Email received: "${subject}" from ${senderEmail}`,
          metadata: { preview: emailContent.slice(0, 200) },
        },
      });
    }

    // Update inbox message with processing result
    await db.agentInboxMessage.update({
      where: { id: inboxMsg.id },
      data: {
        status: processedAs ? "PROCESSED" : "UNREAD",
        processedAs,
        linkedId,
      },
    });

    return NextResponse.json({ status: "processed", type: emailType, processedAs });
  } catch (e: any) {
    console.error("[Inbound Email] Webhook error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
