import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_TYPES = [
  "slack",
  "teams",
  "jira",
  "asana",
  "monday",
  "google_calendar",
  "discord",
  "email",
  "webhook",
  "n8n",
] as const;

// ---------------------------------------------------------------------------
// GET /api/integrations — list all integrations for the user's org
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId)
    return NextResponse.json({ error: "No org" }, { status: 403 });

  const integrations = await db.integration.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: integrations });
}

// ---------------------------------------------------------------------------
// POST /api/integrations — create a new integration
// body: { type, name, config }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId)
    return NextResponse.json({ error: "No org" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { type, name, config } = body as {
    type: string;
    name: string;
    config?: Record<string, unknown>;
  };

  if (!type || !name)
    return NextResponse.json(
      { error: "type and name are required" },
      { status: 400 },
    );

  if (!VALID_TYPES.includes(type as any))
    return NextResponse.json(
      { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );

  // For slack / webhook, test the connection by sending a HEAD request to the
  // webhook URL provided in config.
  let status: string = "disconnected";
  let errorMessage: string | null = null;

  // n8n: mark as connected if at least one workflow URL is provided
  if (type === "n8n" && config?.workflows) {
    const workflows = config.workflows as Record<string, string>;
    const hasUrl = Object.values(workflows).some((url) => typeof url === "string" && url.startsWith("http"));
    status = hasUrl ? "connected" : "disconnected";
  }

  if ((type === "slack" || type === "webhook") && config?.webhookUrl) {
    try {
      const res = await fetch(config.webhookUrl as string, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok || res.status === 405) {
        // 405 is common for webhooks that only accept POST
        status = "connected";
      } else {
        status = "error";
        errorMessage = `Webhook returned ${res.status}`;
      }
    } catch (err: any) {
      status = "error";
      errorMessage = err?.message ?? "Failed to reach webhook URL";
    }
  }

  const integration = await db.integration.create({
    data: {
      orgId,
      type,
      name,
      config: (config ?? {}) as any,
      status,
      errorMessage,
    },
  });

  return NextResponse.json({ data: integration }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PATCH /api/integrations — update an integration
// body: { id, name?, config?, status? }
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId)
    return NextResponse.json({ error: "No org" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { id, name, config, status } = body as {
    id: string;
    name?: string;
    config?: Record<string, unknown>;
    status?: string;
  };

  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Ensure the integration belongs to this org
  const existing = await db.integration.findFirst({
    where: { id, orgId },
  });

  if (!existing)
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (config !== undefined) updateData.config = config;
  if (status !== undefined) updateData.status = status;

  const updated = await db.integration.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ data: updated });
}

// ---------------------------------------------------------------------------
// DELETE /api/integrations?id=xxx — delete an integration
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId)
    return NextResponse.json({ error: "No org" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });

  // Ensure the integration belongs to this org
  const existing = await db.integration.findFirst({
    where: { id, orgId },
  });

  if (!existing)
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });

  await db.integration.delete({ where: { id } });

  return NextResponse.json({ data: { deleted: true, id } });
}
