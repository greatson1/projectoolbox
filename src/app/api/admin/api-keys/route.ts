import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { randomBytes, createHash } from "crypto";

export const dynamic = "force-dynamic";

// GET /api/admin/api-keys — List org's API keys
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const keys = await db.apiKey.findMany({
    where: { orgId },
    select: { id: true, name: true, lastFour: true, lastUsed: true, expiresAt: true, revokedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: keys });
}

// POST /api/admin/api-keys — Generate new API key
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const name = body.name || "API Key";

  // Generate key
  const rawKey = `ptx_live_${randomBytes(24).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const lastFour = rawKey.slice(-4);

  const apiKey = await db.apiKey.create({
    data: { orgId, name, keyHash, lastFour },
  });

  // Audit log
  await db.auditLog.create({
    data: { orgId, userId: session.user.id, action: "Generated API key", target: name },
  });

  // Return the full key ONCE — it won't be shown again
  return NextResponse.json({
    data: { ...apiKey, fullKey: rawKey },
  }, { status: 201 });
}
