import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/meetings/[meetingId]/transcript-snippet?text=...
 *
 * Returns a ~3-line snippet of the raw transcript surrounding the first
 * occurrence of the given text. Used by the PendingDecisionCard's
 * "View source" expander so users can see the context of an extracted
 * decision before confirming it.
 *
 * Falls back gracefully when no exact match is found — uses keyword
 * overlap to pick the most-likely-matching paragraph.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { id: agentId, meetingId } = await params;
  const text = (req.nextUrl.searchParams.get("text") || "").toLowerCase().trim();
  if (!text) return NextResponse.json({ data: { snippet: "" } });

  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, orgId, agentId },
    select: { rawTranscript: true },
  });
  if (!meeting?.rawTranscript) return NextResponse.json({ data: { snippet: "(no transcript on file)" } });

  const lines = meeting.rawTranscript.split(/\r?\n/);
  const lower = lines.map((l) => l.toLowerCase());

  // Try exact substring first.
  let hitIdx = lower.findIndex((l) => l.includes(text));

  // Fall back to keyword overlap if no exact match (e.g. paraphrased decision).
  if (hitIdx < 0) {
    const tokens = text.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    if (tokens.length > 0) {
      let bestScore = 0;
      let bestIdx = -1;
      for (let i = 0; i < lower.length; i++) {
        const hits = tokens.filter((t) => lower[i].includes(t)).length;
        if (hits > bestScore) {
          bestScore = hits;
          bestIdx = i;
        }
      }
      if (bestScore >= Math.min(2, Math.ceil(tokens.length * 0.5))) hitIdx = bestIdx;
    }
  }

  if (hitIdx < 0) {
    return NextResponse.json({ data: { snippet: "(no matching snippet found in transcript)" } });
  }

  const start = Math.max(0, hitIdx - 1);
  const end = Math.min(lines.length, hitIdx + 2);
  const snippet = lines.slice(start, end).join("\n").trim();
  return NextResponse.json({ data: { snippet, hitLine: hitIdx } });
}
