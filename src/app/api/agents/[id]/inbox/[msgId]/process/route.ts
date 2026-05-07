/**
 * POST /api/agents/[id]/inbox/[msgId]/process
 *
 * Manually trigger KB extraction from an inbox message.
 * Calls Claude to extract decisions, risks, action items, and key facts
 * from the full email content and writes them to KnowledgeBaseItem.
 *
 * Called from the Inbox tab "Process into KB" button.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId, msgId } = await params;

  // Verify agent belongs to caller's org
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { orgId: true, name: true },
  });
  if (!agent || agent.orgId !== caller.orgId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Find the inbox message (org-scoped)
  const msg = await db.agentInboxMessage.findFirst({
    where: { id: msgId, agentId, orgId: caller.orgId },
  });
  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  // Get the full email content — inbox only stores 500-char preview
  // Use preview as source; for meeting notes emails the preview is usually sufficient
  const content = (msg.metadata as any)?.fullContent || msg.preview;

  if (!content?.trim()) {
    return NextResponse.json({ error: "No content to process" }, { status: 400 });
  }

  // Get active project for this agent
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });
  const projectId = deployment?.projectId ?? null;

  // Extract KB items via Claude
  const extracted = await extractFromEmail(content, msg.subject, msg.from);

  const saved: { title: string; type: string }[] = [];
  for (const item of extracted) {
    await db.knowledgeBaseItem.create({
      data: {
        orgId: caller.orgId,
        agentId,
        projectId,
        layer: "PROJECT",
        type: item.type as any,
        title: item.title,
        content: item.content,
        trustLevel: item.trustLevel as any,
        tags: item.tags,
        metadata: { source: "email", from: msg.from, subject: msg.subject, msgId },
      },
    });
    saved.push({ title: item.title, type: item.type });
  }

  // Mark message as processed
  await db.agentInboxMessage.update({
    where: { id: msgId },
    data: { status: "PROCESSED", processedAs: "kb_extraction" },
  });

  // Promote any budget / date / sponsor mentions in the extracted facts to
  // the canonical tables so the dashboard reflects the email's update
  // immediately. allowOverwrite=true because the user clicked "Process into
  // KB" — that's an explicit acknowledgement that they want the email's
  // facts applied. Without this, an email saying "Budget reduced to £8k"
  // would land in KB but project.budget would stay at the old value and
  // the Cost / EVM pages would show the wrong number.
  if (projectId && saved.length > 0) {
    try {
      const { promoteKBFactToCanonical } = await import("@/lib/agents/clarification-promote");
      for (const item of extracted) {
        await promoteKBFactToCanonical({
          projectId,
          title: item.title,
          content: item.content,
          allowOverwrite: true,
        });
      }
    } catch (e) {
      console.error("[inbox/process] canonical promote failed:", e);
    }
  }

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Processed email into knowledge base: "${msg.subject}" — ${saved.length} item${saved.length !== 1 ? "s" : ""} extracted`,
    },
  });

  return NextResponse.json({ data: { extracted: saved.length, items: saved } });
}

// ─── Email KB Extractor ────────────────────────────────────────────────────────

interface KbItem {
  title: string;
  content: string;
  type: string;
  trustLevel: string;
  tags: string[];
}

async function extractFromEmail(
  content: string,
  subject: string,
  from: string,
): Promise<KbItem[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Fallback — store as plain text
    return [{
      title: `Email: ${subject}`,
      content: content.slice(0, 4000),
      type: "EMAIL",
      trustLevel: "STANDARD",
      tags: ["email", "manual"],
    }];
  }

  const prompt = `You are an AI Project Manager. Extract structured knowledge from this project email.

FROM: ${from}
SUBJECT: ${subject}

CONTENT:
${content.slice(0, 20_000)}

Return ONLY valid JSON (no markdown):
{
  "summary": "1-2 sentence summary of what this email says",
  "decisions": [{ "title": "short title", "content": "full decision with context" }],
  "action_items": [{ "title": "task title", "content": "task description with owner/deadline if mentioned" }],
  "risks": [{ "title": "risk title", "content": "risk description" }],
  "key_facts": [{ "title": "fact title", "content": "important fact, constraint, or preference" }]
}

Rules:
- Only extract what is explicitly stated
- decisions: formal agreements, approvals, sign-offs
- action_items: specific tasks with an owner
- risks: blockers, concerns, uncertainties flagged
- key_facts: dates, budgets, constraints, stakeholder preferences
- If minimal content, return just the summary`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}`);

    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim()
      .replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(text);

    const items: KbItem[] = [];

    if (parsed.summary) {
      items.push({
        title: `Email summary: ${subject}`,
        content: parsed.summary,
        type: "EMAIL",
        trustLevel: "STANDARD",
        tags: ["email", "summary"],
      });
    }
    for (const d of (parsed.decisions || [])) {
      items.push({ title: d.title, content: d.content, type: "DECISION", trustLevel: "HIGH_TRUST", tags: ["email", "decision"] });
    }
    for (const a of (parsed.action_items || [])) {
      items.push({ title: a.title, content: a.content, type: "TEXT", trustLevel: "STANDARD", tags: ["email", "action-item"] });
    }
    for (const r of (parsed.risks || [])) {
      items.push({ title: r.title, content: r.content, type: "TEXT", trustLevel: "STANDARD", tags: ["email", "risk"] });
    }
    for (const f of (parsed.key_facts || [])) {
      items.push({ title: f.title, content: f.content, type: "TEXT", trustLevel: "STANDARD", tags: ["email", "key-fact"] });
    }

    return items.length > 0 ? items : [{
      title: `Email: ${subject}`,
      content: content.slice(0, 4000),
      type: "EMAIL",
      trustLevel: "STANDARD",
      tags: ["email", "manual"],
    }];
  } catch {
    return [{
      title: `Email: ${subject}`,
      content: content.slice(0, 4000),
      type: "EMAIL",
      trustLevel: "STANDARD",
      tags: ["email", "manual"],
    }];
  }
}
