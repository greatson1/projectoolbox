import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/meetings/:id — Get single meeting with full details
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const meeting = await db.meeting.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, gradient: true } },
      actionItems: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data: meeting });
}

// PATCH /api/meetings/:id — Update meeting (e.g. add transcript, update action items)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const { id } = await params;
  const body = await req.json();

  // If uploading transcript to an existing meeting, process it
  if (body.rawTranscript) {
    const { CreditService } = await import("@/lib/credits/service");
    const hasCredits = await CreditService.checkBalance(orgId, 5);
    if (!hasCredits) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
    }

    await db.meeting.update({
      where: { id },
      data: { rawTranscript: body.rawTranscript, status: "COMPLETED" },
    });

    try {
      const { processMeetingTranscript } = await import("@/lib/agents/meeting-processor");
      await processMeetingTranscript(id);
      await CreditService.deduct(orgId, 5, `Meeting transcript processed`);
    } catch (e: any) {
      console.error("Transcript processing error:", e);
    }
  }

  // Update other fields
  const { rawTranscript: _, ...updateData } = body;
  if (Object.keys(updateData).length > 0) {
    await db.meeting.update({
      where: { id },
      data: {
        ...(updateData.title && { title: updateData.title }),
        ...(updateData.projectId !== undefined && { projectId: updateData.projectId }),
        ...(updateData.platform && { platform: updateData.platform }),
        ...(updateData.scheduledAt && { scheduledAt: new Date(updateData.scheduledAt) }),
        ...(updateData.attendees && { attendees: updateData.attendees }),
        ...(updateData.postUpdate && { status: "COMPLETED" }),
      },
    });
  }

  const updated = await db.meeting.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, gradient: true } },
      actionItems: true,
    },
  });

  return NextResponse.json({ data: updated });
}

// DELETE /api/meetings/:id
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await db.meetingActionItem.deleteMany({ where: { meetingId: id } });
  await db.meeting.delete({ where: { id } });

  return NextResponse.json({ data: { deleted: true } });
}
