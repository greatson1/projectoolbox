/**
 * Proactive Outreach — Agent reaches out to the user when information is needed.
 *
 * Called from any autonomous process (VPS cycle, artefact generation, sprint
 * planning, phase advancement) when a gap is detected. The agent:
 *
 *   1. Posts a structured question to the chat (visible on next visit)
 *   2. Sends a notification via all configured channels (in-app, email, Slack, Telegram)
 *   3. Logs the outreach in agent activity
 *   4. Blocks the specific action until the question is answered
 *
 * Questions are stored as ChatMessage with metadata.type = "proactive_question"
 * so the chat UI can render them as interactive cards.
 */

import { db } from "@/lib/db";

export interface ProactiveQuestion {
  question: string;
  context: string;       // what the agent was doing when it hit the gap
  urgency: "low" | "medium" | "high" | "blocking";
  category: "clarification" | "decision" | "approval" | "information";
  options?: string[];     // for choice questions
  defaultValue?: string;  // what the agent will assume if no answer within timeout
  timeoutHours?: number;  // auto-proceed with default after this many hours
  affectedAction: string; // what's blocked (e.g., "Generate Design phase artefacts")
}

/**
 * Post a proactive question to the user via all available channels.
 * Returns the chat message ID so the caller can track the response.
 */
export async function askUser(
  agentId: string,
  projectId: string,
  question: ProactiveQuestion,
): Promise<string> {
  // ── Idempotency guard ──
  // The VPS autonomous cycle (and any loop on the platform) calls askUser
  // every cycle. Without this guard the same "What is the total budget?"
  // gets posted every 40 min indefinitely, polluting chat AND triggering
  // a fresh sentiment-analyser Haiku per post.
  // Skip if there's an unanswered proactive question with the same
  // question text in the last 7 days.
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const existing = await db.chatMessage.findFirst({
      where: {
        agentId,
        role: "agent",
        createdAt: { gte: sevenDaysAgo },
        metadata: {
          path: ["type"],
          equals: "proactive_question",
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const meta = (existing.metadata as any) || {};
      // Match by exact question text — different questions are not deduped.
      if (typeof meta.question === "string" && meta.question === question.question && meta.answered !== true) {
        // Already pending. Refresh askedAt so the timeout resets, but DON'T post a duplicate.
        return existing.id;
      }
    }
  } catch (e) {
    console.error("[proactive-outreach] idempotency check failed:", e);
  }

  // Get agent and org context
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { name: true, orgId: true, gradient: true },
  });
  if (!agent) return "";

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });

  // 1. Post to chat as a structured message
  const chatMsg = await db.chatMessage.create({
    data: {
      agentId,
      role: "agent",
      content: formatQuestionForChat(question, agent.name, project?.name || "Project"),
      metadata: {
        type: "proactive_question",
        question: question.question,
        context: question.context,
        urgency: question.urgency,
        category: question.category,
        options: question.options,
        defaultValue: question.defaultValue,
        timeoutHours: question.timeoutHours,
        affectedAction: question.affectedAction,
        askedAt: new Date().toISOString(),
        answered: false,
      } as any,
    },
  });

  // 2. Create in-app notification for all org admins
  try {
    const admins = await db.user.findMany({
      where: { orgId: agent.orgId, role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true, email: true },
    });

    for (const admin of admins) {
      await db.notification.create({
        data: {
          userId: admin.id,
          type: "AGENT_ALERT",
          title: `${agent.name} needs your input`,
          body: question.question,
          actionUrl: `/agents/chat?agentId=${agentId}`,
          metadata: { agentId, urgency: question.urgency, category: question.category } as any,
        },
      }).catch(() => {});
    }

    // 3. Send via configured notification channels (email, Slack, Telegram)
    const deployment = await db.agentDeployment.findFirst({
      where: { agentId, isActive: true },
      select: { config: true },
    });
    const config = (deployment?.config as any) || {};

    if (config.notifEmail) {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const emails = admins.map(a => a.email).filter(Boolean) as string[];
        if (emails.length > 0) {
          const urgencyBadge = question.urgency === "blocking" ? "BLOCKING"
            : question.urgency === "high" ? "URGENT"
            : "";

          const html = `
            <div style="font-family:'Segoe UI',Calibri,Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:linear-gradient(135deg,#1e3a5f,#4f46e5);padding:24px 32px;border-radius:12px 12px 0 0;">
                <h1 style="color:white;font-size:16px;margin:0;">${agent.name} needs your input</h1>
                <p style="color:rgba(255,255,255,0.7);font-size:12px;margin:4px 0 0;">${project?.name || "Project"} ${urgencyBadge ? `· ${urgencyBadge}` : ""}</p>
              </div>
              <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
                <p style="font-size:14px;color:#1a1a2e;font-weight:600;margin:0 0 8px;">${question.question}</p>
                <p style="font-size:13px;color:#64748b;margin:0 0 16px;line-height:1.5;">${question.context}</p>
                ${question.options ? `<p style="font-size:12px;color:#64748b;">Options: ${question.options.join(", ")}</p>` : ""}
                ${question.defaultValue ? `<p style="font-size:12px;color:#94a3b8;">If no response within ${question.timeoutHours || 24}h, I'll proceed with: <strong>${question.defaultValue}</strong></p>` : ""}
                <a href="${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}/agents/chat?agentId=${agentId}"
                  style="display:inline-block;margin-top:12px;background:#4f46e5;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
                  Reply in Chat →
                </a>
              </div>
            </div>
          `;

          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json", "User-Agent": "Projectoolbox/1.0" },
            body: JSON.stringify({
              from: `Projectoolbox <notifications@projectoolbox.com>`,
              to: emails,
              subject: `${urgencyBadge ? urgencyBadge + ": " : ""}${agent.name} needs your input — ${project?.name || "Project"}`,
              html,
            }),
          }).catch(() => {});
        }
      }
    }

    // Slack webhook
    if (config.notifSlack && config.slackWebhookUrl) {
      await fetch(config.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*${agent.name} needs your input* — ${project?.name}\n\n${question.question}\n\n_${question.context}_\n\n<${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}/agents/chat?agentId=${agentId}|Reply in Chat>`,
        }),
      }).catch(() => {});
    }

    // Telegram
    if (config.notifTelegram && config.telegramBotToken && config.telegramChatId) {
      await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text: `*${agent.name} needs your input*\n${project?.name}\n\n${question.question}\n\n_${question.context}_`,
          parse_mode: "Markdown",
        }),
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[proactive-outreach] notification failed:", e);
  }

  // 4. Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "chat",
      summary: `Proactive question (${question.urgency}): ${question.question.slice(0, 80)}`,
    },
  }).catch(() => {});

  return chatMsg.id;
}

/**
 * Check if the user has answered a proactive question.
 * Called by the autonomous cycle to decide whether to proceed with default or wait.
 */
export async function isQuestionAnswered(chatMessageId: string): Promise<{ answered: boolean; answer?: string }> {
  const msg = await db.chatMessage.findUnique({
    where: { id: chatMessageId },
    select: { metadata: true },
  });
  const meta = (msg?.metadata as any) || {};
  return { answered: !!meta.answered, answer: meta.userAnswer };
}

/**
 * Check if any proactive questions have timed out and should auto-proceed.
 * Called from the agent-tick cron.
 */
export async function processTimedOutQuestions(agentId: string): Promise<number> {
  const pendingQuestions = await db.chatMessage.findMany({
    where: {
      agentId,
      role: "agent",
      metadata: { path: ["type"], equals: "proactive_question" },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  let processed = 0;
  for (const msg of pendingQuestions) {
    const meta = (msg.metadata as any) || {};
    if (meta.answered) continue;

    const askedAt = new Date(meta.askedAt || msg.createdAt);
    const timeoutMs = (meta.timeoutHours || 24) * 60 * 60 * 1000;
    if (Date.now() - askedAt.getTime() > timeoutMs && meta.defaultValue) {
      // Auto-proceed with default
      await db.chatMessage.update({
        where: { id: msg.id },
        data: {
          metadata: { ...meta, answered: true, userAnswer: meta.defaultValue, autoProceeded: true } as any,
        },
      });

      // Post a follow-up message
      await db.chatMessage.create({
        data: {
          agentId,
          role: "agent",
          content: `I waited ${meta.timeoutHours || 24} hours for your response to: "${meta.question}". Proceeding with the default: **${meta.defaultValue}**. You can change this anytime by telling me in chat.`,
        },
      });

      // If the deployment is still in "researching" or "awaiting_clarification",
      // advance it now so artefact generation can proceed.
      try {
        const deployment = await db.agentDeployment.findFirst({
          where: { agentId, isActive: true },
          select: { id: true, phaseStatus: true, projectId: true, currentPhase: true },
        });
        if (deployment && ["researching", "awaiting_clarification"].includes(deployment.phaseStatus ?? "")) {
          await db.agentDeployment.update({
            where: { id: deployment.id },
            data: {
              phaseStatus: "active",
              nextCycleAt: new Date(), // trigger a cycle immediately
            },
          });
          // Kick off artefact generation in the background
          if (deployment.projectId) {
            const { generatePhaseArtefacts } = await import("./lifecycle-init");
            generatePhaseArtefacts(agentId, deployment.projectId, deployment.currentPhase ?? undefined)
              .catch(e => console.error("[timeout-proceed] artefact generation failed:", e));
          }
        }
      } catch (e) {
        console.error("[processTimedOutQuestions] phase transition failed:", e);
      }

      processed++;
    }
  }
  return processed;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatQuestionForChat(q: ProactiveQuestion, agentName: string, projectName: string): string {
  const urgencyIcon = q.urgency === "blocking" ? "🔴" : q.urgency === "high" ? "🟠" : q.urgency === "medium" ? "🟡" : "🔵";

  let msg = `${urgencyIcon} **I need your input to continue**\n\n`;
  msg += `**${q.question}**\n\n`;
  msg += `_Context: ${q.context}_\n\n`;

  if (q.options && q.options.length > 0) {
    msg += `**Options:**\n`;
    q.options.forEach((opt, i) => { msg += `${i + 1}. ${opt}\n`; });
    msg += "\n";
  }

  if (q.defaultValue) {
    msg += `If I don't hear back within ${q.timeoutHours || 24} hours, I'll proceed with: **${q.defaultValue}**\n\n`;
  }

  msg += `_This is ${q.urgency === "blocking" ? "blocking" : "needed for"}: ${q.affectedAction}_`;

  return msg;
}
