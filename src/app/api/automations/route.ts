import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/automations — list all automation rules for the user's org
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const rules = await db.automationRule.findMany({
    where: { orgId },
    include: { integration: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: rules });
}

// POST /api/automations — create a new automation rule
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const body = await req.json();
  const { name, trigger, action, integrationId, config, projectId } = body;

  if (!name || !trigger || !action) {
    return NextResponse.json({ error: "name, trigger, and action are required" }, { status: 400 });
  }

  const rule = await db.automationRule.create({
    data: {
      orgId,
      name,
      trigger,
      action,
      ...(integrationId && { integrationId }),
      ...(config && { config }),
      ...(projectId && { projectId }),
    },
    include: { integration: true },
  });

  return NextResponse.json({ data: rule }, { status: 201 });
}

// PATCH /api/automations — update an existing automation rule
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const body = await req.json();
  const { id, name, trigger, action, config, isActive, projectId, integrationId } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Verify the rule belongs to this org
  const existing = await db.automationRule.findFirst({
    where: { id, orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  const rule = await db.automationRule.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(trigger !== undefined && { trigger }),
      ...(action !== undefined && { action }),
      ...(config !== undefined && { config }),
      ...(isActive !== undefined && { isActive }),
      ...(projectId !== undefined && { projectId }),
      ...(integrationId !== undefined && { integrationId }),
    },
    include: { integration: true },
  });

  return NextResponse.json({ data: rule });
}

// DELETE /api/automations — delete an automation rule
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });
  }

  // Verify the rule belongs to this org
  const existing = await db.automationRule.findFirst({
    where: { id, orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  await db.automationRule.delete({ where: { id } });

  return NextResponse.json({ data: { id } });
}
