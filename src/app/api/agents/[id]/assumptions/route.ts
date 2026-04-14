import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/agents/[id]/assumptions — Confirm or reject an assumption
 * Body: { assumptionId, action: "confirm" | "reject", value?: string, reason?: string }
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { assumptionId, action, value, reason } = body;

  if (!assumptionId || !action) {
    return NextResponse.json({ error: "assumptionId and action required" }, { status: 400 });
  }

  if (action === "confirm") {
    const { confirmAssumption } = await import("@/lib/agents/assumptions");
    const result = await confirmAssumption(assumptionId, value || "confirmed");
    return NextResponse.json({
      data: {
        ...result,
        message: result.changed
          ? `Assumption revised. ${result.affectedArtefacts.length} artefact(s) flagged for update.`
          : "Assumption confirmed as correct.",
      },
    });
  }

  if (action === "reject") {
    const { rejectAssumption } = await import("@/lib/agents/assumptions");
    await rejectAssumption(assumptionId, reason || "Rejected by user");
    return NextResponse.json({
      data: { message: "Assumption rejected. Affected artefacts flagged for revision." },
    });
  }

  return NextResponse.json({ error: "Invalid action. Use 'confirm' or 'reject'" }, { status: 400 });
}
