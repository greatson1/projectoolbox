/**
 * ML Training Cron — retrains all models nightly.
 *
 * Schedule via Vercel cron: 0 3 * * * (3 AM UTC daily)
 * Protected by CRON_SECRET. Also accepts ?orgId=... to train a single org
 * for testing / on-demand refresh.
 */

import { NextRequest, NextResponse } from "next/server";
import { trainAllOrgs, trainOrgModels } from "@/lib/ml/trainer";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — embeddings for many projects can be slow

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Allow session users to trigger a refresh for their own org
  const url = new URL(req.url);
  const orgParam = url.searchParams.get("orgId");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Not the cron. Check if user is authenticated and requesting their own org.
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userOrgId = (session.user as any).orgId;
    if (!userOrgId) return NextResponse.json({ error: "No org" }, { status: 403 });
    if (orgParam && orgParam !== userOrgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const report = await trainOrgModels(userOrgId);
    return NextResponse.json({ data: { reports: [report] } });
  }

  if (orgParam) {
    const report = await trainOrgModels(orgParam);
    return NextResponse.json({ data: { reports: [report] } });
  }

  const reports = await trainAllOrgs();
  return NextResponse.json({ data: { reports, totalOrgs: reports.length } });
}

export async function POST(req: NextRequest) { return GET(req); }
