/**
 * Clarification Session System
 *
 * Before generating artefacts, the agent identifies exactly what information
 * it needs, checks the knowledge base, then conducts a focused conversational
 * Q&A with the user for anything missing.
 *
 * Every answer the user provides is immediately stored to the KB as a HIGH_TRUST
 * fact — so subsequent artefact generations, reports, and agent cycles all benefit.
 *
 * Flow:
 *   1. [generatePhaseArtefacts called]
 *   2. startClarificationSession() — Claude identifies gaps, posts questions to chat
 *   3. [User replies in Chat with Agent]
 *   4. processSessionResponse() — Claude extracts facts → KB, asks follow-ups
 *   5. When complete → generatePhaseArtefacts() runs with enriched KB
 *
 * Session state is stored as a KnowledgeBaseItem (tag: "clarification_session").
 */

import { db } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuestionType =
  | "text"       // free text — name, venue, description
  | "choice"     // single select from a list of options
  | "multi"      // pick several from a list
  | "yesno"      // simple yes / no
  | "number"     // numeric value (budget, count, etc.)
  | "date";      // a specific date

export interface ClarificationQuestion {
  id: string;                // e.g. "q1", "q2"
  artefact: string;          // which artefact this is for
  field: string;             // human-readable field name
  question: string;          // the actual question to ask the user
  type: QuestionType;        // determines how it is rendered
  options?: string[];        // for "choice" and "multi" types
  answered: boolean;
  answer?: string;
}

export interface ClarificationSession {
  sessionId: string;
  agentId: string;
  projectId: string;
  artefactNames: string[];
  questions: ClarificationQuestion[];
  startedAt: string;
  completedAt?: string;
  status: "active" | "complete" | "abandoned";
  currentQuestionIndex: number; // index into questions[] of the live question
}

// ─── Session persistence ──────────────────────────────────────────────────────

const SESSION_TITLE = "__clarification_session__";

async function saveSession(agentId: string, projectId: string, orgId: string, session: ClarificationSession): Promise<void> {
  const content = JSON.stringify(session);
  const existing = await db.knowledgeBaseItem.findFirst({
    where: { agentId, projectId, title: SESSION_TITLE },
    select: { id: true },
  });
  if (existing) {
    await db.knowledgeBaseItem.update({
      where: { id: existing.id },
      data: { content, updatedAt: new Date(), tags: ["clarification_session", session.status] },
    });
  } else {
    await db.knowledgeBaseItem.create({
      data: {
        orgId, agentId, projectId,
        layer: "PROJECT", type: "TEXT",
        title: SESSION_TITLE,
        content,
        trustLevel: "STANDARD",
        tags: ["clarification_session", session.status],
      },
    });
  }
}

export async function getActiveSession(agentId: string, projectId: string): Promise<ClarificationSession | null> {
  const item = await db.knowledgeBaseItem.findFirst({
    where: { agentId, projectId, title: SESSION_TITLE, tags: { has: "active" } },
    select: { content: true },
  });
  if (!item) return null;
  try {
    const session = JSON.parse(item.content) as ClarificationSession;
    return session.status === "active" ? session : null;
  } catch {
    return null;
  }
}

// ─── Fact storage ─────────────────────────────────────────────────────────────

/**
 * Stores a confirmed user fact into the KB as a HIGH_TRUST item.
 * Every piece of information the user confirms becomes permanent agent memory.
 */
export async function storeFactToKB(
  agentId: string,
  projectId: string,
  orgId: string,
  title: string,
  content: string,
  tags: string[],
): Promise<void> {
  const existing = await db.knowledgeBaseItem.findFirst({
    where: { agentId, projectId, title },
    select: { id: true },
  });

  const data = {
    content: `[User confirmed ${new Date().toLocaleDateString("en-GB")}] ${content}`,
    updatedAt: new Date(),
    tags: ["user_confirmed", "project_fact", ...tags],
    trustLevel: "HIGH_TRUST" as const,
  };

  if (existing) {
    await db.knowledgeBaseItem.update({ where: { id: existing.id }, data });
  } else {
    await db.knowledgeBaseItem.create({
      data: {
        orgId, agentId, projectId,
        layer: "PROJECT", type: "TEXT",
        title, trustLevel: "HIGH_TRUST",
        tags: ["user_confirmed", "project_fact", ...tags],
        content: data.content,
        metadata: { source: "user_clarification", confirmedAt: new Date().toISOString() } as any,
      },
    });
  }
}

// ─── Question generation ──────────────────────────────────────────────────────

/**
 * Uses Claude to identify exactly what information each artefact needs
 * that isn't already in the project description or KB.
 * Returns a prioritised list of questions — most critical first.
 */
async function generateQuestions(
  project: any,
  artefactNames: string[],
  kbContext: string,
): Promise<ClarificationQuestion[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const category = (project.category || "general").toLowerCase();
  const isTravel = category === "travel" || (project.name || "").toLowerCase().includes("trip");

  const prompt = `You are a senior Project Manager about to generate the following project documents for "${project.name}":
${artefactNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

PROJECT DESCRIPTION: ${project.description || "No description provided"}
BUDGET: £${(project.budget || 0).toLocaleString()}
DATES: ${project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "TBD"} → ${project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "TBD"}
CATEGORY: ${category}

${kbContext ? `ALREADY KNOWN (do NOT ask about these):\n${kbContext}\n` : ""}

Your task: identify the SPECIFIC pieces of information you need from the user to populate these documents accurately. Only ask about things NOT already in the description or KB above.

QUESTION TYPE RULES — choose the most helpful type for each question:
- "text"   → open-ended: names, venue names, descriptions, free details
- "choice" → single select: use when there are 3–6 clear standard options (include an "Other" option). Examples: travel class, accommodation type, project methodology, meeting format
- "multi"  → multi-select: when the user may pick several items. Examples: which documents are ready, which stakeholders are already engaged
- "yesno"  → yes/no: simple confirmed/not confirmed questions. Examples: "Have flights been booked?", "Is a visa required?"
- "number" → numeric value: budget splits, number of people, days
- "date"   → a specific date: departure date, deadline, milestone date

For "choice" and "multi" questions, provide realistic options tailored to the project. ALWAYS include "Other (please specify)" as the last option.

${isTravel ? `TRAVEL PROJECT QUESTION HINTS — prioritise these types of questions:
- Accommodation type (choice: Hotel / Serviced Apartment / Airbnb / Other)
- Flight class (choice: Economy / Premium Economy / Business / First)
- Have flights been booked? (yesno)
- Have hotels been booked? (yesno)
- Transfer/transport preference (choice: Private transfer / Taxi/Uber / Public transport / Car hire / Other)
- Number of travellers (number)
- Purpose of trip (choice: Business meetings / Leisure / Both)
- Any visa requirements confirmed? (yesno)` : `PROJECT QUESTION HINTS:
- Project methodology (choice: PRINCE2 / Agile / Waterfall / SAFe / Hybrid / Other)
- Has a project sponsor been identified? (yesno)
- Team size (number)
- Key delivery approach (choice: Phased / Big bang / Iterative / Pilot then rollout / Other)
- Is there an existing budget approval? (yesno)`}

Ask only the questions that are genuinely needed — typically 3-12 depending on how much detail the project description already provides. A detailed description may only need 2-3 questions; a vague one-liner may need 10-12. Never pad with unnecessary questions but never skip a question that would prevent a [TBC] marker in the final documents. Prioritise fields that appear across multiple documents.
Do NOT ask about things already in the description or KB above.

Return ONLY a JSON array in this exact format — no preamble, no explanation:
[
  {
    "id": "q1",
    "artefact": "Detailed Trip Plan",
    "field": "accommodation_type",
    "question": "What type of accommodation have you arranged or are planning to book?",
    "type": "choice",
    "options": ["Hotel", "Serviced Apartment", "Airbnb / Vacation Rental", "Company guesthouse", "Other (please specify)"]
  },
  {
    "id": "q2",
    "artefact": "Detailed Trip Plan",
    "field": "flights_booked",
    "question": "Have the flights been booked yet?",
    "type": "yesno"
  },
  {
    "id": "q3",
    "artefact": "Detailed Trip Plan",
    "field": "hotel_name",
    "question": "What is the name and area of the hotel or accommodation you will be staying at?",
    "type": "text"
  },
  {
    "id": "q4",
    "artefact": "Budget Tracker",
    "field": "num_travellers",
    "question": "How many people are travelling on this trip?",
    "type": "number"
  }
]`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const text = (data.content?.[0]?.text || "").trim();

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const raw = JSON.parse(match[0]) as any[];
    return raw.map(q => ({
      id: q.id || `q${Math.random()}`,
      artefact: q.artefact || artefactNames[0],
      field: q.field || "unknown",
      question: q.question || "",
      type: (["text", "choice", "multi", "yesno", "number", "date"].includes(q.type) ? q.type : "text") as QuestionType,
      options: Array.isArray(q.options) && q.options.length > 0 ? q.options : undefined,
      answered: false,
    })).filter(q => q.question.length > 10);
  } catch (e) {
    console.error("[clarification-session] question generation failed:", e);
    return [];
  }
}

// ─── Session start ────────────────────────────────────────────────────────────

/**
 * Main entry point — called from generatePhaseArtefacts when KB is sparse.
 * Generates targeted questions, posts them to the chat, saves session state.
 * Returns true if a session was started (generation should be deferred),
 * false if KB already has enough information (generation should proceed).
 */
export async function startClarificationSession(
  agentId: string,
  projectId: string,
  orgId: string,
  artefactNames: string[],
): Promise<boolean> {
  // Don't start a new session if one is already active
  const existing = await getActiveSession(agentId, projectId);
  if (existing) return true;

  // Load project + KB context
  const [project, kbItems] = await Promise.all([
    db.project.findUnique({ where: { id: projectId } }),
    db.knowledgeBaseItem.findMany({
      where: { projectId, agentId, trustLevel: "HIGH_TRUST", tags: { has: "user_confirmed" } },
      select: { title: true, content: true },
      take: 20,
    }),
  ]);
  if (!project) return false;

  // If we already have 10+ confirmed facts, KB is probably rich enough — generate directly
  if (kbItems.length >= 10) return false;

  const kbContext = kbItems.map(i => `${i.title}: ${i.content}`).join("\n");
  const questions = await generateQuestions(project, artefactNames, kbContext);

  // If Claude found nothing to ask, proceed with generation
  if (questions.length === 0) return false;

  // Build the session
  const session: ClarificationSession = {
    sessionId: `cs_${Date.now()}`,
    agentId,
    projectId,
    artefactNames,
    questions,
    startedAt: new Date().toISOString(),
    status: "active",
    currentQuestionIndex: 0,
  };

  await saveSession(agentId, projectId, orgId, session);

  // Post the FIRST question as a structured chat message.
  // The chat UI renders this as an interactive card widget — NOT markdown text.
  // Subsequent questions are posted by answerQuestionInSession() after each answer.
  await db.chatMessage.create({
    data: {
      agentId,
      role: "agent",
      content: `__CLARIFICATION_SESSION__`,           // sentinel — UI detects this
      metadata: {
        type: "clarification_question",
        sessionId: session.sessionId,
        questionIndex: 0,
        totalQuestions: questions.length,
        artefactNames,
        question: questions[0],
        intro: true,                                  // show intro text on first card
      } as any,
    },
  }).catch(() => {});

  await db.agentActivity.create({
    data: {
      agentId,
      type: "chat",
      summary: `Clarification session started — ${questions.length} questions sent before generating ${artefactNames.length} artefact(s)`,
    },
  }).catch(() => {});

  // Notify org admins
  try {
    const admins = await db.user.findMany({
      where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true },
    });
    for (const admin of admins) {
      await db.notification.create({
        data: {
          userId: admin.id,
          type: "AGENT_ALERT",
          title: `Agent has questions before generating documents`,
          body: `${questions.length} quick questions to answer before your ${artefactNames.length} project documents are generated. Open Chat with Agent.`,
          actionUrl: `/agents/${agentId}/chat`,
          metadata: { agentId, alertType: "clarification_needed" } as any,
        },
      }).catch(() => {});
    }
  } catch {}

  return true; // session started — defer generation
}

// ─── Interactive answer handler ──────────────────────────────────────────────

/**
 * Called from the dedicated /clarification/answer API endpoint.
 * Stores one answer to KB, advances the session, posts the next question card.
 * Zero credits — does not touch the chat stream or CreditService.
 */
export async function answerQuestionInSession(
  agentId: string,
  projectId: string,
  orgId: string,
  questionId: string,
  answer: string,
): Promise<{
  status: "next" | "complete";
  nextQuestion?: ClarificationQuestion;
  progress: { current: number; total: number; artefactNames: string[] };
}> {
  const session = await getActiveSession(agentId, projectId);
  if (!session) return { status: "complete", progress: { current: 0, total: 0, artefactNames: [] } };

  const question = session.questions.find(q => q.id === questionId);
  if (!question) return { status: "next", progress: { current: session.currentQuestionIndex, total: session.questions.length, artefactNames: session.artefactNames } };

  // Store fact to KB — include full question context so Claude can use it
  const isTBC = /^tbc$/i.test(answer.trim()) || /not (yet|sure|know)/i.test(answer);
  const humanTitle = question.question.replace(/\?$/, "").trim();
  if (isTBC) {
    await storeFactToKB(agentId, projectId, orgId,
      `TBC: ${humanTitle}`,
      `User confirmed this is not yet known: "${question.question}" — to be filled in later.`,
      [question.artefact.toLowerCase().replace(/\s+/g, "_"), "tbc"],
    ).catch(() => {});
  } else {
    await storeFactToKB(agentId, projectId, orgId,
      humanTitle,
      `Q: ${question.question}\nA: ${answer}\n(For artefact: ${question.artefact})`,
      [question.artefact.toLowerCase().replace(/\s+/g, "_"), "user_answer", "user_confirmed"],
    ).catch(() => {});
  }

  // Mark question answered
  question.answered = true;
  question.answer = isTBC ? "TBC" : answer;

  // Advance to next unanswered
  const nextQuestion = session.questions.find(q => !q.answered) ?? null;
  const answeredCount = session.questions.filter(q => q.answered).length;
  const nextIndex = nextQuestion ? session.questions.indexOf(nextQuestion) : session.questions.length;

  session.currentQuestionIndex = nextIndex;

  if (!nextQuestion) {
    // Session complete
    session.status = "complete";
    session.completedAt = new Date().toISOString();
    await saveSession(agentId, projectId, orgId, session);

    // Post completion card to chat
    await db.chatMessage.create({
      data: {
        agentId,
        role: "agent",
        content: `__CLARIFICATION_COMPLETE__`,
        metadata: {
          type: "clarification_complete",
          sessionId: session.sessionId,
          artefactNames: session.artefactNames,
          answeredCount,
          totalCount: session.questions.length,
        } as any,
      },
    }).catch(() => {});

    await db.agentActivity.create({
      data: {
        agentId,
        type: "document",
        summary: `Clarification complete — ${answeredCount}/${session.questions.length} questions answered. Regenerating ${session.artefactNames.length} artefact(s) with your answers...`,
      },
    }).catch(() => {});

    // Auto-regenerate artefacts now that the KB is enriched with user answers.
    // The initial artefacts were generated with [TBC] markers; delete them so
    // generatePhaseArtefacts creates fresh versions using the real KB data.
    (async () => {
      try {
        const deployment = await db.agentDeployment.findFirst({
          where: { agentId, isActive: true },
          select: { projectId: true, currentPhase: true },
        });
        if (deployment?.projectId) {
          // Delete existing DRAFT artefacts for this phase so they get regenerated
          const targetNames = session.artefactNames.map(n => n.toLowerCase());
          const drafts = await db.agentArtefact.findMany({
            where: { projectId: deployment.projectId, agentId, status: "DRAFT" },
            select: { id: true, name: true },
          });
          const toDelete = drafts.filter(a => targetNames.includes(a.name.toLowerCase()));
          if (toDelete.length > 0) {
            await db.agentArtefact.deleteMany({
              where: { id: { in: toDelete.map(a => a.id) } },
            });
          }

          const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
          const result = await generatePhaseArtefacts(agentId, deployment.projectId, deployment.currentPhase ?? undefined);
          if (result.generated > 0) {
            await db.chatMessage.create({
              data: {
                agentId,
                role: "agent",
                content: `I've regenerated ${result.generated} artefact(s) using your answers — they should now have real details instead of [TBC] markers. Head to the **Artefacts** tab to review them.`,
              },
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.error("[clarification] auto-regenerate after session complete failed:", e);
      }
    })();

    return {
      status: "complete",
      progress: { current: answeredCount, total: session.questions.length, artefactNames: session.artefactNames },
    };
  }

  // More questions remain — save progress and post next question card
  await saveSession(agentId, projectId, orgId, session);

  await db.chatMessage.create({
    data: {
      agentId,
      role: "agent",
      content: `__CLARIFICATION_SESSION__`,
      metadata: {
        type: "clarification_question",
        sessionId: session.sessionId,
        questionIndex: nextIndex,
        totalQuestions: session.questions.length,
        artefactNames: session.artefactNames,
        question: nextQuestion,
        intro: false,
      } as any,
    },
  }).catch(() => {});

  return {
    status: "next",
    nextQuestion,
    progress: { current: answeredCount, total: session.questions.length, artefactNames: session.artefactNames },
  };
}

// ─── Response processing (legacy fallback) ────────────────────────────────────

/**
 * Called from the chat stream route whenever a user message arrives and
 * there is an active clarification session.
 *
 * Uses Claude to:
 *   1. Extract structured facts from the user's natural language answer
 *   2. Store each fact to the KB as HIGH_TRUST
 *   3. Update the session (mark questions answered)
 *   4. Determine if session is complete
 *   5. If complete → trigger artefact generation
 *
 * Returns a supplementary note for the chat response (empty if nothing extracted).
 * Runs non-blocking — errors are caught so they never block the chat stream.
 */
export async function processSessionResponse(
  agentId: string,
  projectId: string,
  orgId: string,
  userMessage: string,
): Promise<void> {
  try {
    const session = await getActiveSession(agentId, projectId);
    if (!session) return;

    if (!process.env.ANTHROPIC_API_KEY) return;

    const unanswered = session.questions.filter(q => !q.answered);
    if (unanswered.length === 0) return;

    const optionLetters = ["a", "b", "c", "d", "e", "f", "g", "h"];

    // Claude extracts structured facts from the user's reply
    // Include the full question + options context so it can resolve "3b" → "Airbnb / Vacation Rental"
    const questionsContext = session.questions.map(q => {
      let ctx = `Q${q.id} (${q.type}): ${q.question} — for: ${q.artefact}`;
      if ((q.type === "choice" || q.type === "multi") && q.options) {
        ctx += "\n  Options: " + q.options.map((o, i) => `(${optionLetters[i]}) ${o}`).join(" | ");
      }
      return ctx;
    }).join("\n");

    const extractPrompt = `You are extracting project facts from a user's message.

The user was asked these questions (with options where provided):
${questionsContext}

The user replied:
"${userMessage}"

IMPORTANT: If the user selected an option by letter (e.g. "3b", "q2a", "(b)"), resolve it to the full option text from the list above.

Extract every fact the user confirmed. For each fact:
- title: short descriptive key (e.g. "Accommodation Type", "Flights Booked", "Hotel Name")
- value: the resolved full value (not just the letter — use the full option text if letter selected)
- questionId: the Q id this answers (e.g. "q1")
- artefact: which artefact it belongs to
- isTBC: true if the user said TBC, don't know, unknown, unsure, not yet, or similar

Return ONLY a JSON array:
[
  { "title": "Accommodation Type", "value": "Hotel", "questionId": "q1", "artefact": "Detailed Trip Plan", "isTBC": false },
  { "title": "Flights Booked", "value": "Yes", "questionId": "q2", "artefact": "Detailed Trip Plan", "isTBC": false },
  { "title": "Hotel Name", "value": "TBC", "questionId": "q3", "artefact": "Detailed Trip Plan", "isTBC": true }
]

If the user's message doesn't answer any questions, return [].`;

    const extractResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: extractPrompt }],
      }),
    });

    if (!extractResponse.ok) return;
    const extractData = await extractResponse.json();
    const extractText = (extractData.content?.[0]?.text || "").trim();
    const match = extractText.match(/\[[\s\S]*\]/);
    if (!match) return;

    const extracted: { title: string; value: string; questionId: string; artefact: string; isTBC: boolean }[] = JSON.parse(match[0]);

    // Store each non-TBC fact to KB
    for (const fact of extracted) {
      if (fact.isTBC || !fact.value || fact.value.toUpperCase() === "TBC") {
        // Store TBC as a placeholder so the agent knows it's deliberately unknown
        await storeFactToKB(agentId, projectId, orgId,
          `TBC: ${fact.title}`,
          `User confirmed this is not yet known: ${fact.title} for ${fact.artefact}. To be filled in later.`,
          [fact.artefact.toLowerCase().replace(/\s+/g, "_"), "tbc"],
        ).catch(() => {});
      } else {
        await storeFactToKB(agentId, projectId, orgId,
          fact.title,
          fact.value,
          [fact.artefact.toLowerCase().replace(/\s+/g, "_"), "user_answer"],
        ).catch(() => {});
      }

      // Mark question as answered in session
      const q = session.questions.find(sq => sq.id === fact.questionId);
      if (q) {
        q.answered = true;
        q.answer = fact.isTBC ? "TBC" : fact.value;
      }
    }

    // Also mark any question as answered if the user used its number directly
    for (const q of session.questions) {
      const num = q.id.replace("q", "");
      if (new RegExp(`^\\s*${num}[.):>]?\\s+\\S`, "m").test(userMessage)) {
        q.answered = true;
      }
    }

    // Check completion: all questions answered OR user says "generate"/"that's all"
    const answeredCount = session.questions.filter(q => q.answered).length;
    const totalCount = session.questions.length;
    const userWantsToGenerate = /\b(generate|proceed|go ahead|that'?s all|done|ready|create|build|make)\b/i.test(userMessage);
    const sessionComplete = answeredCount === totalCount || userWantsToGenerate || answeredCount >= Math.ceil(totalCount * 0.7);

    if (sessionComplete) {
      session.status = "complete";
      session.completedAt = new Date().toISOString();
      await saveSession(agentId, projectId, orgId, session);

      // Log learning
      await db.agentActivity.create({
        data: {
          agentId,
          type: "document",
          summary: `Clarification complete — ${answeredCount}/${totalCount} questions answered. Generating ${session.artefactNames.length} artefact(s) now.`,
        },
      }).catch(() => {});

      // Trigger artefact generation with the now-enriched KB
      // Use a small delay so the chat response reaches the user first
      setTimeout(async () => {
        try {
          const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
          const deployment = await db.agentDeployment.findFirst({
            where: { agentId, projectId, isActive: true },
            select: { id: true, currentPhase: true },
          });
          await generatePhaseArtefacts(agentId, projectId, deployment?.currentPhase ?? undefined);

          // Notify user that documents are ready
          await db.chatMessage.create({
            data: {
              agentId,
              role: "agent",
              content: `✅ I've now generated your ${session.artefactNames.length} document${session.artefactNames.length !== 1 ? "s" : ""} using all the information you confirmed. Head to the **Artefacts** tab to review them. Any fields you marked as TBC are clearly highlighted — you can update them there whenever you have the details.`,
            },
          }).catch(() => {});
        } catch (e) {
          console.error("[clarification-session] post-session generation failed:", e);
        }
      }, 3000);

    } else {
      // Session still active — update progress
      await saveSession(agentId, projectId, orgId, session);

      // Log partial progress
      if (extracted.length > 0) {
        await db.agentActivity.create({
          data: {
            agentId,
            type: "chat",
            summary: `Learnt ${extracted.length} fact${extracted.length !== 1 ? "s" : ""} from user — ${answeredCount}/${totalCount} clarification questions answered`,
          },
        }).catch(() => {});
      }
    }

  } catch (e) {
    console.error("[clarification-session] processSessionResponse failed:", e);
  }
}

/**
 * Returns a summary of active session progress for injection into the
 * Claude system prompt — so the agent knows which questions are still open
 * and can ask intelligent follow-ups.
 */
export async function getSessionContextForPrompt(agentId: string, projectId: string): Promise<string> {
  const session = await getActiveSession(agentId, projectId);
  if (!session) return "";

  const answered = session.questions.filter(q => q.answered);
  const unanswered = session.questions.filter(q => !q.answered);

  const lines = [
    "━━━ ACTIVE CLARIFICATION SESSION ━━━",
    `You are in the middle of a clarification Q&A with the user before generating: ${session.artefactNames.join(", ")}`,
    `Progress: ${answered.length}/${session.questions.length} questions answered.`,
    "",
  ];

  if (answered.length > 0) {
    lines.push("Already confirmed by user:");
    for (const q of answered) {
      lines.push(`  ✓ ${q.field}: ${q.answer || "confirmed"}`);
    }
    lines.push("");
  }

  const optionLetters = ["a", "b", "c", "d", "e", "f", "g", "h"];

  if (unanswered.length > 0) {
    lines.push("Still needed (ask these next — show options where provided):");
    for (const q of unanswered) {
      let qLine = `  • [${q.type.toUpperCase()}] Q${q.id}: ${q.question}`;
      if ((q.type === "choice" || q.type === "multi") && q.options) {
        qLine += "\n    Options: " + q.options.map((o, i) => `(${optionLetters[i]}) ${o}`).join(" | ");
      } else if (q.type === "yesno") {
        qLine += " → Yes / No / TBC";
      }
      lines.push(qLine);
    }
    lines.push("");
  }

  lines.push(
    "INSTRUCTIONS FOR THIS RESPONSE:",
    "- Warmly acknowledge every fact the user just confirmed (name them specifically)",
    "- If questions remain, show the NEXT unanswered question with its full options (if any)",
    "- For choice/multi questions, always display the lettered options so the user can just reply with a letter",
    "- Remind them: 'If you don't know yet, just say TBC — I'll leave it blank for now'",
    "- Do NOT ask more than 2 questions per response — keep it conversational",
    "- When all answered (or user says 'generate'), confirm you're generating the documents now",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  return lines.join("\n");
}
