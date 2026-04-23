/**
 * Sentiment Correction API — user feedback that a detected sentiment was wrong.
 *
 * POST { sourceType, sourceId, correctedLabel }
 * Updates the source record and logs a SentimentHistory entry with source="correction"
 * so future calibration can learn from systematic errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VALID_LABELS = ["positive", "neutral", "concerned", "negative"];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const body = await req.json();
  const { sourceType, sourceId, correctedLabel } = body;

  if (!sourceType || !sourceId || !correctedLabel) {
    return NextResponse.json({ error: "sourceType, sourceId, correctedLabel required" }, { status: 400 });
  }
  if (!VALID_LABELS.includes(correctedLabel)) {
    return NextResponse.json({ error: `Invalid label. Valid: ${VALID_LABELS.join(", ")}` }, { status: 400 });
  }

  const correctedScore =
    correctedLabel === "positive" ? 0.7 :
    correctedLabel === "neutral" ? 0 :
    correctedLabel === "concerned" ? -0.4 : -0.8;

  // 1. Update the source record
  try {
    if (sourceType === "approval") {
      await db.approval.update({
        where: { id: sourceId },
        data: { sentiment: correctedLabel, sentimentScore: correctedScore, sentimentConfidence: 1.0 },
      });
    } else if (sourceType === "chat") {
      const existing = await db.chatMessage.findUnique({ where: { id: sourceId }, select: { metadata: true } });
      const meta = (existing?.metadata as any) || {};
      await db.chatMessage.update({
        where: { id: sourceId },
        data: {
          metadata: { ...meta, sentiment: correctedLabel, sentimentScore: correctedScore, userCorrected: true } as any,
        },
      });
    } else if (sourceType === "email") {
      await db.agentInboxMessage.update({
        where: { id: sourceId },
        data: { sentiment: correctedLabel, sentimentScore: correctedScore },
      });
    }
  } catch (e) {
    console.error("[sentiment/correct] source update failed:", e);
  }

  // 2. Log the correction in SentimentHistory
  try {
    await db.sentimentHistory.create({
      data: {
        orgId,
        subjectType: sourceType,
        subjectId: sourceId,
        sentiment: correctedLabel,
        score: correctedScore,
        source: "correction",
        sourceRef: sourceId,
      },
    });
  } catch {}

  // 3. Store a calibration insight for future ML improvement
  try {
    await db.mLInsight.create({
      data: {
        orgId,
        kind: "sentiment_correction",
        subjectType: sourceType,
        subjectId: sourceId,
        score: correctedScore,
        confidence: 1.0,
        data: { correctedLabel, sourceType, correctedBy: (session.user as any).id } as any,
      },
    });
  } catch {}

  return NextResponse.json({ data: { ok: true, label: correctedLabel, score: correctedScore } });
}
