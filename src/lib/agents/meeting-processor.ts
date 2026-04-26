import { db } from "@/lib/db";

/**
 * Processes a meeting transcript (text) with AI to extract:
 * - Summary
 * - Topics
 * - Sentiment
 * - Speaker breakdown
 * - Action items
 * - Decisions
 * - Risks
 */
export async function processMeetingTranscript(meetingId: string): Promise<void> {
  const meeting = await db.meeting.findUnique({
    where: { id: meetingId },
    include: { project: { select: { name: true, methodology: true } }, agent: { select: { name: true } } },
  });

  if (!meeting?.rawTranscript) throw new Error("No transcript to process");

  const prompt = buildTranscriptPrompt(meeting.rawTranscript, meeting.title, meeting.project?.name);
  let result: TranscriptAnalysis;

  // Try Anthropic first
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.content[0]?.text || "";
        result = parseAnalysis(text);
      } else {
        result = fallbackAnalysis(meeting.rawTranscript, meeting.title);
      }
    } catch {
      result = fallbackAnalysis(meeting.rawTranscript, meeting.title);
    }
  } else {
    result = fallbackAnalysis(meeting.rawTranscript, meeting.title);
  }

  // Update meeting with analysis
  await db.meeting.update({
    where: { id: meetingId },
    data: {
      summary: result.summary,
      topics: result.topics,
      sentiment: result.sentiment,
      speakers: result.speakers,
      decisions: result.decisions,
      risks: result.risks,
      confidence: result.confidence,
      status: "COMPLETED",
      processedAt: new Date(),
    },
  });

  // Create action items
  if (result.actionItems.length > 0) {
    await db.meetingActionItem.createMany({
      data: result.actionItems.map(a => ({
        meetingId,
        text: a.text,
        assignee: a.assignee || null,
        deadline: a.deadline || null,
        status: "PENDING",
      })),
    });
  }

  // Log agent activity if agent is assigned
  if (meeting.agentId) {
    await db.agentActivity.create({
      data: {
        agentId: meeting.agentId,
        type: "meeting",
        summary: `Processed meeting transcript: "${meeting.title}" — ${result.actionItems.length} actions, ${result.decisions.length} decisions, ${result.risks.length} risks extracted`,
        metadata: {
          meetingId,
          actionsCount: result.actionItems.length,
          decisionsCount: result.decisions.length,
          risksCount: result.risks.length,
          sentiment: result.sentiment,
        },
      },
    });

    // Write granular KB items so each fact is individually weighted and searchable
    const kbWrites: Promise<any>[] = [];
    const sharedBase = {
      orgId: meeting.orgId,
      agentId: meeting.agentId,
      projectId: meeting.projectId,
      layer: "PROJECT",
      metadata: { meetingId, meetingTitle: meeting.title, sentiment: result.sentiment },
    };

    // 1. Meeting summary (STANDARD trust — good reference)
    kbWrites.push(db.knowledgeBaseItem.create({
      data: {
        ...sharedBase,
        type: "TEXT",
        title: `Meeting summary: ${meeting.title}`,
        content: result.summary,
        trustLevel: "STANDARD",
        tags: ["meeting", "summary"],
      },
    }));

    // 2. Each decision — trust level + tags driven by certainty so a passing
    // hedge ("we should be fine on the visa") doesn't get promoted to
    // HIGH_TRUST and then acted on as an explicit approval downstream.
    //   • definite     → HIGH_TRUST, no review needed (clear factual claim)
    //   • probable     → HIGH_TRUST + pending_user_confirmation (used only after user confirms)
    //   • tentative    → STANDARD + pending_user_confirmation (excluded from prompts until reviewed)
    // pending_user_confirmation is already filtered out of artefact-generation
    // prompts by getProjectKnowledgeContext.
    const hedgePattern = /\b(probably|possibly|maybe|might|could|should|tentative|hopeful|likely|i think|i believe|seems|may|hopefully|fingers crossed)\b/i;
    // Track decisions that need follow-up so we can post per-decision cards
    // AFTER all KB writes settle (we need the KB row IDs).
    const pendingDecisions: {
      text: string; by: string; reason: string;
      certainty: "probable" | "tentative";
      createPromise: Promise<{ id: string }>;
    }[] = [];
    const definiteDecisions: { text: string; by: string }[] = [];
    for (const d of result.decisions) {
      const declaredCertainty = (d.certainty as "definite" | "probable" | "tentative" | undefined) || undefined;
      const looksHedged = hedgePattern.test(d.text);
      const certainty: "definite" | "probable" | "tentative" =
        declaredCertainty
          ? declaredCertainty
          : looksHedged
            ? "probable"
            : "definite";
      const trust = certainty === "tentative" ? "STANDARD" : "HIGH_TRUST";
      const needsReview = certainty !== "definite";
      const tags = ["meeting", "decision", `decision_certainty:${certainty}`];
      if (needsReview) tags.push("pending_user_confirmation", "needs_review");
      const createPromise = db.knowledgeBaseItem.create({
        data: {
          ...sharedBase,
          type: "DECISION",
          title: d.text.slice(0, 120),
          content: `Decision: ${d.text}\nMade by: ${d.by}\nRationale: ${d.rationale}\nCertainty: ${certainty}${needsReview ? "\nFlagged for confirmation — not used for artefact generation until reviewed." : ""}`,
          trustLevel: trust,
          tags,
        },
        select: { id: true },
      });
      kbWrites.push(createPromise);
      if (needsReview) {
        pendingDecisions.push({
          text: d.text,
          by: d.by,
          reason: certainty === "tentative" ? "speculative wording" : "qualified language",
          certainty: certainty as "probable" | "tentative",
          createPromise,
        });
      } else {
        definiteDecisions.push({ text: d.text, by: d.by });
      }
    }

    // 3. Each risk identified — STANDARD trust
    for (const r of result.risks) {
      kbWrites.push(db.knowledgeBaseItem.create({
        data: {
          ...sharedBase,
          type: "TEXT",
          title: `Risk identified: ${r.title}`,
          content: `${r.description} (Severity: ${r.severity})`,
          trustLevel: "STANDARD",
          tags: ["meeting", "risk"],
        },
      }));
    }

    // 4. Action items — STANDARD trust
    if (result.actionItems.length > 0) {
      kbWrites.push(db.knowledgeBaseItem.create({
        data: {
          ...sharedBase,
          type: "TEXT",
          title: `Action items: ${meeting.title}`,
          content: result.actionItems.map(a =>
            `- ${a.text}${a.assignee ? ` → ${a.assignee}` : ""}${a.deadline ? ` (by ${a.deadline})` : ""}`
          ).join("\n"),
          trustLevel: "STANDARD",
          tags: ["meeting", "action-item"],
        },
      }));
    }

    // 5. Raw transcript — REFERENCE_ONLY (agent uses for lookup, not as authoritative fact)
    kbWrites.push(db.knowledgeBaseItem.create({
      data: {
        ...sharedBase,
        type: "TRANSCRIPT",
        title: `Transcript: ${meeting.title}`,
        content: (meeting.rawTranscript || "").slice(0, 50_000),
        trustLevel: "REFERENCE_ONLY",
        tags: ["meeting", "transcript", "raw"],
      },
    }));

    await Promise.allSettled(kbWrites);

    // ── B: Per-decision PendingDecisionCard for each flagged item ──
    // Render one interactive card per flagged decision so the user can
    // [Confirm]/[Discard] inline without leaving chat.
    if (pendingDecisions.length > 0) {
      // Header summary so the cards have context.
      await db.chatMessage.create({
        data: {
          agentId: meeting.agentId,
          role: "agent",
          content: `Meeting **"${meeting.title}"** processed. ${pendingDecisions.length} decision${pendingDecisions.length !== 1 ? "s" : ""} need your confirmation before I'll act on them:`,
        },
      }).catch(() => {});

      for (const pd of pendingDecisions) {
        // The KB-write promise was registered earlier; await it so we have
        // the row id to address from the card. allSettled has already run
        // so this resolves immediately from cache.
        let kbItemId: string | null = null;
        try { kbItemId = (await pd.createPromise).id; } catch { /* skip */ }
        if (!kbItemId) continue;

        await db.chatMessage.create({
          data: {
            agentId: meeting.agentId,
            role: "agent",
            content: "__PENDING_DECISION__",
            metadata: {
              type: "pending_decision",
              kbItemId,
              decisionText: pd.text,
              by: pd.by,
              reason: pd.reason,
              certainty: pd.certainty,
              meetingTitle: meeting.title,
            } as any,
          },
        }).catch(() => {});
      }
    }

    // ── C: Per-suggestion ActionSuggestionCard for each definite-decision
    // → open-work-item match. Same one-click pattern, no auto-apply.
    if (meeting.projectId && definiteDecisions.length > 0) {
      try {
        const [openTasks, openRisks] = await Promise.all([
          db.task.findMany({
            where: { projectId: meeting.projectId, status: { not: "DONE" } },
            select: { id: true, title: true, status: true },
            take: 200,
          }),
          db.risk.findMany({
            where: { projectId: meeting.projectId, status: { in: ["OPEN", "MITIGATING"] } },
            select: { id: true, title: true, status: true },
            take: 100,
          }),
        ]);

        const STOPWORDS = new Set(["the", "a", "an", "of", "for", "to", "and", "is", "are", "was", "were", "be", "in", "on", "at", "by", "or", "we", "i", "they", "you", "he", "she", "it", "this", "that", "with", "from", "have", "has", "had", "will", "should", "can", "do", "does"]);
        const tokenise = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOPWORDS.has(t));

        const suggestions: { decision: string; type: "task" | "risk"; itemTitle: string; itemId: string }[] = [];
        for (const d of definiteDecisions) {
          const dTokens = new Set(tokenise(d.text));
          if (dTokens.size === 0) continue;

          for (const t of openTasks) {
            const tTokens = tokenise(t.title || "");
            if (tTokens.length === 0) continue;
            const overlap = tTokens.filter(tok => dTokens.has(tok)).length;
            if (overlap >= Math.min(2, Math.ceil(tTokens.length * 0.4))) {
              suggestions.push({ decision: d.text, type: "task", itemTitle: t.title || "", itemId: t.id });
              break; // one match per decision is enough
            }
          }
          for (const r of openRisks) {
            const rTokens = tokenise(r.title || "");
            if (rTokens.length === 0) continue;
            const overlap = rTokens.filter(tok => dTokens.has(tok)).length;
            if (overlap >= Math.min(2, Math.ceil(rTokens.length * 0.4))) {
              suggestions.push({ decision: d.text, type: "risk", itemTitle: r.title || "", itemId: r.id });
              break;
            }
          }
        }

        if (suggestions.length > 0) {
          await db.chatMessage.create({
            data: {
              agentId: meeting.agentId,
              role: "agent",
              content: `I noticed ${suggestions.length} decision${suggestions.length !== 1 ? "s" : ""} from this meeting match open work items. One click to apply:`,
            },
          }).catch(() => {});

          for (const s of suggestions.slice(0, 8)) {
            await db.chatMessage.create({
              data: {
                agentId: meeting.agentId,
                role: "agent",
                content: "__ACTION_SUGGESTION__",
                metadata: {
                  type: "action_suggestion",
                  projectId: meeting.projectId,
                  decisionText: s.decision,
                  itemType: s.type,
                  itemId: s.itemId,
                  itemTitle: s.itemTitle,
                } as any,
              },
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.error("[meeting-processor] decision→task/risk matching failed:", e);
      }
    }
  }
}

interface TranscriptAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  speakers: { name: string; minutes: number; percentage: number }[];
  actionItems: { text: string; assignee?: string; deadline?: string }[];
  decisions: { text: string; by: string; rationale: string; certainty?: "definite" | "probable" | "tentative" }[];
  risks: { title: string; description: string; severity: string }[];
  confidence: number;
}

function buildTranscriptPrompt(transcript: string, title: string, projectName?: string | null): string {
  return `You are an enterprise project management AI. Analyse this meeting transcript and extract structured intelligence.

MEETING: ${title}${projectName ? ` (Project: ${projectName})` : ""}

TRANSCRIPT:
${transcript}

Respond with VALID JSON only (no markdown, no code fences). Use this exact structure:

{
  "summary": "2-3 paragraph executive summary of the meeting",
  "topics": ["topic1", "topic2"],
  "sentiment": "positive|neutral|concerned|negative",
  "speakers": [{"name": "Speaker Name", "minutes": 10, "percentage": 25}],
  "actionItems": [{"text": "action description", "assignee": "Person Name", "deadline": "timeframe"}],
  "decisions": [{"text": "decision made", "by": "Person Name", "rationale": "why", "certainty": "definite|probable|tentative"}],
  "risks": [{"title": "risk title", "description": "risk details", "severity": "HIGH|MEDIUM|LOW"}],
  "confidence": 85
}

Rules:
- Extract EVERY action item mentioned (tasks, follow-ups, commitments)
- Flag ALL risks (delays, blockers, dependencies, concerns)
- Capture ALL decisions with who made them AND a certainty rating:
    • "definite"  — explicit, unhedged statement of fact ("the visa IS approved", "we have approved the budget", "the contract IS signed")
    • "probable"  — leaning yes but qualified ("the visa should be approved soon", "we'll likely sign this week", "I think we agreed to…")
    • "tentative" — speculative or hedge-heavy ("the visa might be approved", "probably going to", "could potentially", "I'm not 100% sure but…")
  Be CONSERVATIVE — when in doubt, downgrade. A wrongly-confident decision will be acted on as fact downstream.
- Identify speakers from the transcript (look for "Name:" or "[Name]" patterns)
- Estimate speaker time proportionally based on their text volume
- Set confidence based on transcript quality (clear/structured = 90+, messy/pasted = 70-85)
- Keep summary professional and fact-based
- If data is unclear, note it rather than guessing`;
}

function parseAnalysis(text: string): TranscriptAnalysis {
  // Strip code fences if present
  let clean = text.trim();
  clean = clean.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");

  try {
    const parsed = JSON.parse(clean);
    return {
      summary: parsed.summary || "",
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      sentiment: parsed.sentiment || "neutral",
      speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 80,
    };
  } catch {
    // If JSON parse fails, try to extract what we can
    return fallbackAnalysis(text, "Meeting");
  }
}

/**
 * Fallback: extract basic info from transcript without LLM
 */
function fallbackAnalysis(transcript: string, title: string): TranscriptAnalysis {
  const lines = transcript.split("\n").filter(l => l.trim());

  // Detect speakers (patterns: "Name:", "[Name]", "SPEAKER:")
  const speakerMap: Record<string, number> = {};
  for (const line of lines) {
    const match = line.match(/^(?:\[([^\]]+)\]|([A-Z][a-zA-Z\s]+?)[\s]*[:\-])/);
    if (match) {
      const name = (match[1] || match[2]).trim();
      speakerMap[name] = (speakerMap[name] || 0) + 1;
    }
  }

  const totalLines = Object.values(speakerMap).reduce((s, c) => s + c, 0) || 1;
  const speakers = Object.entries(speakerMap).map(([name, count]) => ({
    name,
    minutes: Math.max(1, Math.round((count / totalLines) * 30)),
    percentage: Math.round((count / totalLines) * 100),
  }));

  // Extract action items (lines with "action", "TODO", "will", "need to", "should")
  const actionPatterns = /\b(action|todo|will\s+\w+|need\s+to|should\s+\w+|must\s+\w+|deadline|by\s+(monday|tuesday|wednesday|thursday|friday|next\s+week))\b/i;
  const actionItems = lines
    .filter(l => actionPatterns.test(l))
    .slice(0, 10)
    .map(l => ({
      text: l.replace(/^[\[\(]?[^\]\)]*[\]\)]?\s*[-:]?\s*/, "").trim().slice(0, 200),
      assignee: undefined as string | undefined,
      deadline: undefined as string | undefined,
    }));

  // Extract risks (lines with "risk", "concern", "blocker", "delay")
  const riskPatterns = /\b(risk|concern|blocker|delay|issue|problem|warning|threat|obstacle)\b/i;
  const risks = lines
    .filter(l => riskPatterns.test(l))
    .slice(0, 5)
    .map(l => ({
      title: l.replace(/^[\[\(]?[^\]\)]*[\]\)]?\s*[-:]?\s*/, "").trim().slice(0, 100),
      description: l.trim(),
      severity: "MEDIUM",
    }));

  // Extract decisions
  const decisionPatterns = /\b(decided|agreed|approved|decision|consensus|confirmed)\b/i;
  const decisions = lines
    .filter(l => decisionPatterns.test(l))
    .slice(0, 5)
    .map(l => ({
      text: l.replace(/^[\[\(]?[^\]\)]*[\]\)]?\s*[-:]?\s*/, "").trim().slice(0, 200),
      by: "Team",
      rationale: "",
    }));

  const wordCount = transcript.split(/\s+/).length;
  const estimatedMinutes = Math.max(5, Math.round(wordCount / 150)); // ~150 words/min

  return {
    summary: `Meeting "${title}" transcript processed. ${lines.length} lines analysed with ${speakers.length} speakers identified. ${actionItems.length} potential action items, ${decisions.length} decisions, and ${risks.length} risks were detected. Estimated meeting duration: ${estimatedMinutes} minutes.`,
    topics: [title.split("—")[0]?.trim() || title].filter(Boolean),
    sentiment: "neutral",
    speakers,
    actionItems,
    decisions,
    risks,
    confidence: 65, // lower confidence for fallback
  };
}

/**
 * Generate pre-meeting agenda/brief for an upcoming calendar event
 */
export async function generatePreMeetingBrief(eventId: string): Promise<string> {
  const event = await db.calendarEvent.findUnique({
    where: { id: eventId },
    include: {
      project: {
        include: {
          tasks: { where: { status: { in: ["IN_PROGRESS", "BLOCKED"] } }, take: 10 },
          risks: { where: { status: "OPEN" }, orderBy: { score: "desc" }, take: 5 },
          issues: { where: { status: "OPEN" }, take: 5 },
        },
      },
    },
  });

  if (!event) throw new Error("Event not found");

  // Build context from project data
  const project = event.project;
  let context = `Meeting: ${event.title}\n`;
  if (event.description) context += `Description: ${event.description}\n`;
  if (event.attendees) context += `Attendees: ${JSON.stringify(event.attendees)}\n`;

  if (project) {
    const activeTasks = project.tasks;
    const openRisks = project.risks;
    const openIssues = project.issues;

    context += `\nProject: ${project.name} (${project.methodology})\n`;
    context += `Active Tasks: ${activeTasks.map(t => `- ${t.title} (${t.status})`).join("\n")}\n`;
    context += `Open Risks: ${openRisks.map(r => `- [Score ${r.score}] ${r.title}`).join("\n")}\n`;
    context += `Open Issues: ${openIssues.map(i => `- [${i.priority}] ${i.title}`).join("\n")}\n`;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: `You are an AI project management assistant. Generate a concise pre-meeting brief for the following meeting. Include suggested agenda items, key talking points based on project status, and any items requiring attention.

${context}

Output as clean HTML (h3 for sections, ul/li for bullets, strong for emphasis). Keep it concise — max 300 words.`,
          }],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const brief = data.content[0]?.text || "";
        await db.calendarEvent.update({ where: { id: eventId }, data: { preAgenda: brief } });
        return brief;
      }
    } catch (e) {
      console.error("Pre-meeting brief generation failed:", e);
    }
  }

  // Fallback brief
  const fallback = `<h3>Pre-Meeting Brief: ${event.title}</h3>
<p><strong>Scheduled:</strong> ${event.startTime.toLocaleString()}</p>
${project ? `<h3>Project Status — ${project.name}</h3>
<ul>
<li><strong>${project.tasks.length}</strong> active tasks (${project.tasks.filter(t => t.status === "BLOCKED").length} blocked)</li>
<li><strong>${project.risks.length}</strong> open risks</li>
<li><strong>${project.issues.length}</strong> open issues</li>
</ul>
<h3>Suggested Agenda</h3>
<ul>
<li>Review blocked tasks and dependencies</li>
<li>Risk mitigation updates</li>
<li>Open issues requiring decisions</li>
<li>Next steps and action items</li>
</ul>` : "<p>No project linked — general meeting.</p>"}`;

  await db.calendarEvent.update({ where: { id: eventId }, data: { preAgenda: fallback } });
  return fallback;
}
