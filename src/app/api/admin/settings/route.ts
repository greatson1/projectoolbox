import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/admin/settings — Get org profile
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: null });

  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: {
      id: true, name: true, slug: true, industry: true, companySize: true,
      website: true, timezone: true, billingEmail: true, logoUrl: true, plan: true,
      creditBalance: true, autoTopUp: true, globalHitlPolicy: true,
    },
  });

  return NextResponse.json({ data: org });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { name, industry, companySize, website, timezone, billingEmail, logoUrl, securityPolicy } = body;

  const org = await db.organisation.update({
    where: { id: orgId },
    data: {
      ...(name && { name }),
      ...(industry && { industry }),
      ...(companySize && { companySize }),
      ...(website && { website }),
      ...(timezone && { timezone }),
      ...(billingEmail && { billingEmail }),
      ...(logoUrl && { logoUrl }),
    },
  });

  return NextResponse.json({ data: org });
}