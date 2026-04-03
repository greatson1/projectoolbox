import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// POST /api/meetings/:id/follow-up — Send meeting follow-up email
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const meeting = await db.meeting.findUnique({
    where: { id },
    include: { actionItems: true, project: { select: { name: true } } },
  });

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (!meeting.agentId) return NextResponse.json({ error: "No agent assigned" }, { status: 400 });
  if (!meeting.summary) return NextResponse.json({ error: "Meeting not processed yet" }, { status: 400 });

  // Get attendees from meeting data
  const attendees = (meeting.attendees as any[]) || [];
  const recipients = attendees
    .map((a: any) => a.email)
    .filter(Boolean);

  // If no attendees with emails, send to the requesting user
  if (recipients.length === 0 && session.user.email) {
    recipients.push(session.user.email);
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: "No recipients found" }, { status: 400 });
  }

  try {
    const { EmailService } = await import("@/lib/email");
    await EmailService.sendMeetingFollowUp(meeting.agentId, {
      meetingTitle: meeting.title,
      recipients,
      summary: meeting.summary,
      actionItems: meeting.actionItems.map(a => ({
        text: a.text,
        assignee: a.assignee || undefined,
        deadline: a.deadline || undefined,
      })),
      decisions: ((meeting.decisions as any[]) || []).map(d => ({ text: d.text, by: d.by })),
      projectUrl: meeting.project ? `https://projectoolbox.com/projects` : undefined,
    });

    return NextResponse.json({ data: { sent: true, recipients } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
