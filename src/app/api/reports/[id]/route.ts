import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/reports/[id] — Report detail with versions
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const report = await db.report.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" }, take: 20 },
    },
  });

  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data: report });
}

// PATCH /api/reports/[id] — Update report content + create version
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { content, comment, status: newStatus } = body;

  const report = await db.report.findUnique({ where: { id }, include: { versions: true } });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Create version from current content before updating
  if (content && report.content) {
    const nextVersion = (report.versions.length || 0) + 1;
    await db.documentVersion.create({
      data: {
        reportId: id,
        version: nextVersion,
        content: report.content,
        editedBy: session.user.name || session.user.email || "Unknown",
        comment: comment || `Version ${nextVersion}`,
      },
    });
  }

  // Update report
  const updated = await db.report.update({
    where: { id },
    data: {
      ...(content && { content }),
      ...(newStatus && { status: newStatus as any }),
      editedAt: new Date(),
      editedBy: session.user.name || session.user.email,
      ...(newStatus === "PUBLISHED" && { publishedAt: new Date() }),
    },
  });

  // Audit log
  const orgId = (session.user as any).orgId;
  if (orgId) {
    await db.auditLog.create({
      data: {
        orgId,
        userId: session.user.id,
        action: content ? "document_edited" : `document_${newStatus?.toLowerCase() || "updated"}`,
        target: report.title,
        details: { reportId: id, comment },
      },
    });
  }

  return NextResponse.json({ data: updated });
}

// DELETE /api/reports/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Delete versions first
  await db.documentVersion.deleteMany({ where: { reportId: id } });
  await db.report.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
