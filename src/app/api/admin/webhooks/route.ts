import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

// GET /api/admin/webhooks — List webhook endpoints
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const webhooks = await db.webhookEndpoint.findMany({
    where: { orgId },
    select: { id: true, url: true, events: true, isActive: true, lastFired: true, failCount: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: webhooks });
}

// POST /api/admin/webhooks — Register a webhook endpoint
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { url, events } = body;

  if (!url) return NextResponse.json({ error: "URL required" }, { status: 400 });

  // Generate HMAC signing secret
  const secret = `whsec_${randomBytes(24).toString("hex")}`;

  const webhook = await db.webhookEndpoint.create({
    data: {
      orgId,
      url,
      events: events || ["agent.activity", "approval.created", "phase.advanced"],
      secret,
      isActive: true,
    },
  });

  await db.auditLog.create({
    data: { orgId, userId: session.user.id, action: "Webhook created", target: url },
  });

  // Return the secret ONCE
  return NextResponse.json({
    data: { ...webhook, secret },
  }, { status: 201 });
}
