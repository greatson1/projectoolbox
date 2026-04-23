/**
 * Sentiment Recorder — one-call helper that analyzes text, stores result
 * on the source record, and writes a SentimentHistory entry for trend tracking.
 */

import { db } from "@/lib/db";
import { analyzeSentiment, SentimentResult } from "./analyzer";

export interface RecordSentimentArgs {
  orgId: string;
  text: string;
  subjectType: "approval" | "chat" | "email" | "meeting" | "comms" | "stakeholder";
  subjectId: string;        // record ID (Approval.id, ChatMessage.id, etc)
  associatedSubjectType?: string; // e.g. "stakeholder" when linking to a named person
  associatedSubjectId?: string;
  context?: string;         // hint for analyzer ("approval comment", "meeting transcript")
}

export interface RecordedSentiment extends SentimentResult {
  historyId?: string;
}

/** Analyze text and persist everywhere needed. Non-blocking caller can fire-and-forget. */
export async function recordSentiment(args: RecordSentimentArgs): Promise<RecordedSentiment> {
  const result = await analyzeSentiment(args.text, args.context);
  if (result.confidence < 0.1) return result; // too uncertain to persist

  // 1. Update source record
  try {
    switch (args.subjectType) {
      case "approval":
        await db.approval.update({
          where: { id: args.subjectId },
          data: {
            sentiment: result.label,
            sentimentScore: result.score,
            sentimentConfidence: result.confidence,
          },
        }).catch(() => {});
        break;
      case "chat":
        await db.chatMessage.update({
          where: { id: args.subjectId },
          data: {
            metadata: { sentiment: result.label, sentimentScore: result.score, sentimentConfidence: result.confidence } as any,
          },
        }).catch(() => {});
        break;
      case "email":
        await db.agentInboxMessage.update({
          where: { id: args.subjectId },
          data: { sentiment: result.label, sentimentScore: result.score },
        }).catch(() => {});
        break;
      case "comms":
        await db.commsLog.update({
          where: { id: args.subjectId },
          data: { sentiment: result.label, sentimentScore: result.score },
        }).catch(() => {});
        break;
      case "meeting":
        await db.meeting.update({
          where: { id: args.subjectId },
          data: { sentiment: result.label },
        }).catch(() => {});
        break;
    }
  } catch (e) {
    console.error(`[sentiment-recorder] failed to update ${args.subjectType}/${args.subjectId}:`, e);
  }

  // 2. Write SentimentHistory row (always at org+subject level so we can trend later)
  let historyId: string | undefined;
  try {
    const hist = await db.sentimentHistory.create({
      data: {
        orgId: args.orgId,
        subjectType: args.associatedSubjectType || args.subjectType,
        subjectId: args.associatedSubjectId || args.subjectId,
        sentiment: result.label,
        score: result.score,
        source: args.subjectType,
        sourceRef: args.subjectId,
      },
      select: { id: true },
    });
    historyId = hist.id;
  } catch (e) {
    console.error("[sentiment-recorder] history write failed:", e);
  }

  // 3. Fire automation trigger if sentiment is negative with high confidence
  if (result.label === "negative" && result.confidence >= 0.6) {
    fireAutomationTrigger(args.orgId, "negative_sentiment_detected", {
      subject: args.subjectType,
      subjectId: args.subjectId,
      sentiment: result.label,
      score: result.score,
      text: args.text.slice(0, 200),
    }).catch(() => {});
  }

  return { ...result, historyId };
}

/** Fire any active automation rules matching this trigger. */
async function fireAutomationTrigger(orgId: string, trigger: string, payload: any): Promise<void> {
  try {
    const rules = await db.automationRule.findMany({
      where: { orgId, trigger, isActive: true },
      include: { integration: true },
    });
    if (rules.length === 0) return;

    for (const rule of rules) {
      try {
        const integrationConfig = (rule.integration?.config as any) || {};
        const config = (rule.config as any) || {};
        const webhookUrl = integrationConfig.webhookUrl || config.webhookUrl || config.url;

        const body = {
          event: trigger,
          rule: rule.name,
          timestamp: new Date().toISOString(),
          ...payload,
        };

        if (webhookUrl) {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        }

        await db.automationRule.update({
          where: { id: rule.id },
          data: { fireCount: { increment: 1 }, lastFiredAt: new Date() },
        }).catch(() => {});
      } catch (e) {
        console.error(`[automation-rule] ${rule.name} failed:`, e);
      }
    }
  } catch (e) {
    console.error("[sentiment-recorder] automation trigger failed:", e);
  }
}
