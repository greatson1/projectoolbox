/**
 * Lifecycle Init — Runs directly on Vercel (no VPS dependency).
 *
 * When an agent is deployed, this creates the DB phases and generates
 * the first set of artefacts for the Pre-Project / Sprint Zero phase.
 */

import { db } from "@/lib/db";
import { getMethodology } from "@/lib/methodology-definitions";
import { getPlaybook } from "./methodology-playbooks";
import { isSpreadsheetArtefact, getArtefactColumns } from "@/lib/artefact-types";
import { cleanMarkdownLeakage } from "./markdown-cleanup";
import { sanitiseArtefactContent } from "./sanitise-artefact-content";

/**
 * Generate artefacts for the current (or specified) phase of a project.
 * Safe to call on existing deployments — skips artefacts already in DB.
 * Returns { generated, skipped }.
 */
export async function generatePhaseArtefacts(
  agentId: string,
  projectId: string,
  phaseName?: string,
  /**
   * Optional reviewer feedback from prior REJECTED versions, keyed by
   * artefact name (case-insensitive on the key). When provided, the
   * generation prompt is augmented with "The previous version was rejected
   * with this feedback: …" so Claude addresses the rejection rather than
   * regenerating the same content.
   */
  priorFeedback?: Record<string, string>,
  /**
   * When provided with an allowed reason, skip the lifecycle gate that blocks
   * generation while the deployment is in `researching`/`awaiting_clarification`
   * or has an active clarification session. Allowed reasons:
   *   - "user_regenerate"   : caller is the user-initiated regenerate endpoint
   *   - "post_clarification": caller is the clarification-session-complete handler
   * Any other value is treated as the gate being active. Replaces the prior
   * `force?: boolean` which had no audit trail and was easy to mis-call.
   */
  bypassReason?: "user_regenerate" | "post_clarification",
): Promise<{ generated: number; skipped: number; phase: string; missing?: string[] }> {
  const force = bypassReason === "user_regenerate" || bypassReason === "post_clarification";
  const [agent, project] = await Promise.all([
    db.agent.findUnique({ where: { id: agentId } }),
    db.project.findUnique({ where: { id: projectId } }),
  ]);
  if (!agent || !project) throw new Error("Agent or project not found");

  const methodologyId = (project.methodology || "traditional").toLowerCase().replace("agile_", "");
  const methodology = getMethodology(methodologyId);

  // Determine target phase
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
  });
  const targetPhaseName = phaseName || deployment?.currentPhase || methodology.phases[0].name;

  // ── Load knowledge base context ─────────────────────────────────────────
  // Pull approved artefact facts + workspace policies before calling Claude
  const { getProjectKnowledgeContext } = await import("@/lib/agents/artefact-learning");
  const knowledgeContext = await getProjectKnowledgeContext(agentId, projectId, agent.orgId);
  const phaseDef = methodology.phases.find(p => p.name === targetPhaseName) || methodology.phases[0];

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  // Resolve Phase row early — it stores the user's artefact selections AND we need phaseId
  const phaseRow = await db.phase.findFirst({
    where: { projectId, name: targetPhaseName },
    select: { id: true, artefacts: true },
  });
  const phaseId = phaseRow?.id ?? null;

  // AI-generatable capability filter from methodology definition
  const aiGeneratableSet = new Set(phaseDef.artefacts.filter(a => a.aiGeneratable).map(a => a.name.toLowerCase()));

  // Required artefacts MUST always be generated regardless of the user's
  // wizard selections. Methodology marks WBS / Cost Management Plan / etc.
  // as required because they're prerequisites for downstream phases (no
  // Schedule means no delivery tasks; no Cost Plan means no budget burn).
  // If the user deselected one accidentally, force-include it.
  const requiredAiGeneratable = phaseDef.artefacts
    .filter(a => a.required && a.aiGeneratable)
    .map(a => a.name);

  // Phase.artefacts stores the user's selections (set during lifecycle init from deployment config).
  // Fall back to methodology defaults if the Phase row has no stored selections.
  // Then union in the required-by-methodology set so nothing essential is skipped.
  const userSelected = (phaseRow?.artefacts && (phaseRow.artefacts as string[]).length > 0)
    ? (phaseRow.artefacts as string[]).filter(n => aiGeneratableSet.has(n.toLowerCase()))
    : phaseDef.artefacts.filter(a => a.aiGeneratable).map(a => a.name);
  const seenLC = new Set(userSelected.map(n => n.toLowerCase()));
  const artefactNames: string[] = [
    ...userSelected,
    ...requiredAiGeneratable.filter(n => !seenLC.has(n.toLowerCase())),
  ];

  // Find which artefacts already exist for this project
  const existing = await db.agentArtefact.findMany({
    where: { projectId, agentId },
    select: { name: true },
  });
  const existingNames = new Set(existing.map(a => a.name.toLowerCase()));

  const toGenerate = artefactNames.filter(n => !existingNames.has(n.toLowerCase()));
  const skipped = artefactNames.length - toGenerate.length;

  if (toGenerate.length === 0) return { generated: 0, skipped, phase: targetPhaseName };

  // ── Hard gate: block generation if onboarding flow is incomplete ──────────
  // phaseStatus must NOT be "researching" or "awaiting_clarification".
  // These statuses mean the user hasn't completed the Research → Review →
  // Clarification flow yet. Only the clarification-complete handler or
  // the research-approve handler can unlock generation.
  // Skipped when force=true — user-initiated regenerate must work mid-flow.
  if (!force && deployment) {
    const blockingStatuses = ["researching", "awaiting_clarification"];
    if (deployment.phaseStatus && blockingStatuses.includes(deployment.phaseStatus)) {
      // Loud-failure: don't return 0 silently — log it so the missing artefacts
      // are visible in the activity feed instead of vanishing into a 0-count toast.
      console.warn(`[generatePhaseArtefacts] Blocked by phaseStatus=${deployment.phaseStatus} for agent=${agentId} phase=${targetPhaseName}, missing=${toGenerate.join(", ")}`);
      await db.agentActivity.create({
        data: {
          agentId,
          type: "document",
          summary: `${targetPhaseName}: generation blocked — phase is ${deployment.phaseStatus}. ${toGenerate.length} artefact(s) still pending: ${toGenerate.join(", ")}. Answer clarifications to unblock, or use Regenerate (Fresh) to override.`,
        },
      }).catch(() => {});
      return { generated: 0, skipped, phase: targetPhaseName, missing: toGenerate };
    }
  }

  // Also check for active clarification session (skipped when force=true)
  if (!force) {
    try {
      const { getActiveSession } = await import("@/lib/agents/clarification-session");
      const activeSession = await getActiveSession(agentId, projectId);
      if (activeSession) {
        console.warn(`[generatePhaseArtefacts] Blocked by active clarification session for agent=${agentId} phase=${targetPhaseName}, missing=${toGenerate.join(", ")}`);
        await db.agentActivity.create({
          data: {
            agentId,
            type: "document",
            summary: `${targetPhaseName}: generation blocked — active clarification session pending. ${toGenerate.length} artefact(s) waiting: ${toGenerate.join(", ")}. Finish answering questions, or use Regenerate (Fresh) to override.`,
          },
        }).catch(() => {});
        return { generated: 0, skipped, phase: targetPhaseName, missing: toGenerate };
      }
    } catch (e) {
      console.error("[generatePhaseArtefacts] clarification import failed:", e);
    }
  }

  // ── Research-approval gate ──
  // Generation must NOT proceed while research findings are still pending
  // user approval. Until the user has approved (or rejected) the bundle,
  // those facts sit in the KB tagged "pending_user_confirmation" — they
  // are excluded from the prompt by getProjectKnowledgeContext, so Claude
  // would draft artefacts on a stale knowledge base and the user would
  // see fabricated names because the real ones aren't visible yet.
  // Skipped on force=true so user-initiated regenerate after explicit
  // intent still works.
  if (!force) {
    try {
      const pendingResearchApprovals = await db.approval.count({
        where: {
          projectId,
          status: "PENDING",
          type: "CHANGE_REQUEST",
          impact: { path: ["subtype"], equals: "research_finding" },
        },
      });
      if (pendingResearchApprovals > 0) {
        console.warn(`[generatePhaseArtefacts] Blocked by ${pendingResearchApprovals} pending research-finding approval(s) for project=${projectId} phase=${targetPhaseName}`);
        await db.agentActivity.create({
          data: {
            agentId,
            type: "document",
            summary: `${targetPhaseName}: generation blocked — ${pendingResearchApprovals} research-finding approval${pendingResearchApprovals === 1 ? "" : "s"} awaiting your review. Approve or reject the research findings on the Approvals page before any artefacts can be drafted. ${toGenerate.length} artefact(s) waiting: ${toGenerate.join(", ")}.`,
          },
        }).catch(() => {});
        return { generated: 0, skipped, phase: targetPhaseName, missing: toGenerate };
      }
    } catch (e) {
      console.error("[generatePhaseArtefacts] research-approval gate check failed:", e);
    }
  }

  await db.agentActivity.create({
    data: { agentId, type: "document", summary: `Generating ${toGenerate.length} artefact(s) for ${targetPhaseName} (${skipped} already exist)` },
  });

  const spreadsheetNames = toGenerate.filter(n => isSpreadsheetArtefact(n));
  const proseNames = toGenerate.filter(n => !isSpreadsheetArtefact(n));

  const BATCH_SIZE = 3;
  let totalGenerated = 0;
  // Track which requested artefacts actually landed in the DB. A batch can silently
  // drop an artefact if the LLM response gets truncated at max_tokens or the section
  // header doesn't match — without this set we can't tell which are still missing.
  const generatedNormNames = new Set<string>();
  const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

  const allBatches: Array<{ names: string[]; isSheet: boolean }> = [];
  for (let i = 0; i < proseNames.length; i += BATCH_SIZE) allBatches.push({ names: proseNames.slice(i, i + BATCH_SIZE), isSheet: false });
  for (let i = 0; i < spreadsheetNames.length; i += BATCH_SIZE) allBatches.push({ names: spreadsheetNames.slice(i, i + BATCH_SIZE), isSheet: true });

  // Normalise the feedback map for case-insensitive lookup
  const feedbackByName = new Map<string, string>();
  if (priorFeedback) {
    for (const [name, fb] of Object.entries(priorFeedback)) {
      if (typeof fb === "string" && fb.trim().length > 0) {
        feedbackByName.set(name.toLowerCase(), fb.trim());
      }
    }
  }
  const feedbackBlockFor = (names: string[]) => {
    const lines: string[] = [];
    for (const n of names) {
      const fb = feedbackByName.get(n.toLowerCase());
      if (fb) lines.push(`- ${n}: ${fb}`);
    }
    if (lines.length === 0) return "";
    return `\n\n⚠️ PRIOR REJECTION FEEDBACK — the previous version of the following document(s) was rejected by the human reviewer. Address these issues directly in the new version:\n${lines.join("\n")}\n\nDo not silently regenerate the same content — make concrete changes that respond to the feedback above.`;
  };

  for (const { names: batch, isSheet } of allBatches) {
    const feedbackBlock = feedbackBlockFor(batch);
    const basePrompt = isSheet
      ? buildSpreadsheetPrompt(project, targetPhaseName, batch, methodology.name, knowledgeContext)
      : buildArtefactPrompt(project, targetPhaseName, batch, methodology.name, knowledgeContext);
    const prompt = feedbackBlock ? `${basePrompt}${feedbackBlock}` : basePrompt;

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
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        console.error(`[generatePhaseArtefacts] API error ${response.status}: ${await response.text().catch(() => "unknown")}`);
        continue;
      }

      const data = await response.json();
      const text = (data.content?.[0]?.text || "").trim();
      if (!text) continue;

      const sections = text.split(/^## ARTEFACT:\s*/im).filter(Boolean);
      for (const section of sections) {
        const lines = section.trim().split("\n");
        // Strip bold markers, version numbers, and parenthetical notes from title
        const title = lines[0]?.trim()
          .replace(/\*+/g, "")
          .replace(/\s*\(.*?\)/g, "")
          .replace(/\s+v?\d+(\.\d+)*\s*$/i, "")
          .trim();
        const content = lines.slice(1).join("\n").trim();

        if (title && content.length > 20) {
          const normTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          const matchingDef = artefactNames.find(a => {
            const normDef = a.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
            return normTitle.includes(normDef) || normDef.includes(normTitle) ||
              // Word-level prefix match — "project brief draft" matches "project brief"
              normTitle.startsWith(normDef.split(" ").slice(0, 2).join(" "));
          });
          const artName = matchingDef || title;
          // Skip if now already exists (race condition guard)
          if (existingNames.has(artName.toLowerCase())) continue;
          // Detect format: CSV for spreadsheets, HTML if content starts with tag, else markdown
          let detectedFmt = "markdown";
          let cleaned = content;
          if (isSheet) { detectedFmt = "csv"; }
          else if (content.trimStart().startsWith("<")) {
            detectedFmt = "html";
            cleaned = cleanMarkdownLeakage(content);
          }
          // Strip fabricated personal names from any Owner/Assigned-to column
          // before persisting. The Sonnet prompt forbids inventing names but
          // it still slips through; this is the last-mile guard.
          const sanitised = sanitiseArtefactContent(cleaned, detectedFmt);
          if (sanitised.replaced > 0) {
            console.log(`[generatePhaseArtefacts] sanitised ${sanitised.replaced} fabricated owner cell(s) in "${artName}"`);
          }
          // Resolve any [TBC — …] markers from the KB before saving so the artefact
          // never lands in DRAFT with stale placeholders for facts we already know.
          const { content: resolvedContent } = await autoResolveTBCsInContent(agentId, projectId, sanitised.content);

          // ── Fabricated-name validation ──
          // Scan the resolved content for proper-name tokens not in the
          // project's allowed-names registry. If found, persist the
          // violations to metadata.fabricatedNames so the approval API
          // and DocumentEditor banner can block / surface them. The
          // validator also covers prose names — not just the Owner-column
          // cells caught by sanitiseArtefactContent above.
          let fabricatedNameViolations: Array<{ name: string; context: string; occurrences: number }> = [];
          try {
            const { getAllowedNamesRegistry } = await import("@/lib/agents/allowed-names");
            const { validateArtefactNames } = await import("@/lib/agents/fabricated-names-validator");
            const registry = await getAllowedNamesRegistry(projectId);
            fabricatedNameViolations = validateArtefactNames({ content: resolvedContent, registry });
          } catch (e) {
            console.error(`[generatePhaseArtefacts] name-validator for "${artName}" failed:`, e);
          }

          const created = await db.agentArtefact.create({
            data: {
              agentId,
              projectId,
              name: artName,
              format: detectedFmt,
              content: resolvedContent,
              status: "DRAFT",
              version: 1,
              ...(phaseId ? { phaseId } : {}),
              ...(fabricatedNameViolations.length > 0 ? {
                metadata: {
                  fabricatedNames: fabricatedNameViolations,
                  fabricatedNamesCheckedAt: new Date().toISOString(),
                } as any,
              } : {}),
            },
          });

          if (fabricatedNameViolations.length > 0) {
            await db.agentActivity.create({
              data: {
                agentId,
                type: "document",
                summary: `⚠️ "${artName}" draft contains ${fabricatedNameViolations.length} fabricated name${fabricatedNameViolations.length === 1 ? "" : "s"} (${fabricatedNameViolations.slice(0, 3).map(v => v.name).join(", ")}${fabricatedNameViolations.length > 3 ? "…" : ""}) — approval blocked until resolved.`,
              },
            }).catch(() => {});
          }
          existingNames.add(artName.toLowerCase());
          generatedNormNames.add(normalizeName(artName));
          totalGenerated++;
          // Update scaffolded task progress
          try {
            const { onArtefactGenerated } = await import("@/lib/agents/task-scaffolding");
            await onArtefactGenerated(agentId, projectId, artName);
          } catch {}
          // Contradiction-detection pass (fire-and-forget). Compares the
          // fresh draft against the project's confirmed facts and writes
          // any divergences to artefact.metadata.contradictions. The
          // approval API blocks APPROVED transitions when this list is
          // non-empty unless the caller passes confirmIntentional=true.
          (async () => {
            try {
              const { detectContradictions, persistContradictions } = await import("@/lib/agents/contradiction-detector");
              const { contradictions, cacheKey } = await detectContradictions({
                projectId,
                artefactName: artName,
                draftContent: resolvedContent,
                artefactId: created.id,
              });
              await persistContradictions(created.id, contradictions, cacheKey || undefined);
              if (contradictions.length > 0) {
                await db.agentActivity.create({
                  data: {
                    agentId,
                    type: "document",
                    summary: `⚠️ "${artName}" draft contradicts ${contradictions.length} confirmed fact${contradictions.length === 1 ? "" : "s"} — flagged for user review before approval.`,
                  },
                }).catch(() => {});
              }
            } catch (e) {
              console.error(`[generatePhaseArtefacts] contradiction-detector for "${artName}" failed:`, e);
            }
          })();
        }
      }
    } catch (e) {
      console.error(`[generatePhaseArtefacts] Batch failed:`, e);
    }
  }

  // Retry pass — any requested artefact missing from the DB gets one more attempt
  // in its own API call (full 8192 token budget, no batch-mate competition).
  const missingAfterBatches = toGenerate.filter(n => !generatedNormNames.has(normalizeName(n)));
  for (const name of missingAfterBatches) {
    const isSheet = isSpreadsheetArtefact(name);
    const retryFeedback = feedbackBlockFor([name]);
    const baseRetryPrompt = isSheet
      ? buildSpreadsheetPrompt(project, targetPhaseName, [name], methodology.name, knowledgeContext)
      : buildArtefactPrompt(project, targetPhaseName, [name], methodology.name, knowledgeContext);
    const prompt = retryFeedback ? `${baseRetryPrompt}${retryFeedback}` : baseRetryPrompt;
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) {
        console.error(`[generatePhaseArtefacts] Retry API error for "${name}": ${response.status}`);
        continue;
      }
      const data = await response.json();
      const text = (data.content?.[0]?.text || "").trim();
      if (!text) continue;
      // Strip ARTEFACT header if present; otherwise treat whole response as the doc
      const stripped = text.replace(/^##\s*ARTEFACT:\s*[^\n]*\n/im, "").trim();
      if (stripped.length < 20) continue;
      let detectedFmt = "markdown";
      let cleanedRetry = stripped;
      if (isSheet) detectedFmt = "csv";
      else if (stripped.startsWith("<")) {
        detectedFmt = "html";
        cleanedRetry = cleanMarkdownLeakage(stripped);
      }
      if (existingNames.has(name.toLowerCase())) continue;
      const sanitisedRetry = sanitiseArtefactContent(cleanedRetry, detectedFmt);
      if (sanitisedRetry.replaced > 0) {
        console.log(`[generatePhaseArtefacts retry] sanitised ${sanitisedRetry.replaced} fabricated owner cell(s) in "${name}"`);
      }
      const { content: resolvedRetry } = await autoResolveTBCsInContent(agentId, projectId, sanitisedRetry.content);
      // Fabricated-name validation on retry path too.
      let fabricatedNameViolationsRetry: Array<{ name: string; context: string; occurrences: number }> = [];
      try {
        const { getAllowedNamesRegistry } = await import("@/lib/agents/allowed-names");
        const { validateArtefactNames } = await import("@/lib/agents/fabricated-names-validator");
        const registry = await getAllowedNamesRegistry(projectId);
        fabricatedNameViolationsRetry = validateArtefactNames({ content: resolvedRetry, registry });
      } catch {}
      const createdRetry = await db.agentArtefact.create({
        data: {
          agentId,
          projectId,
          name,
          format: detectedFmt,
          content: resolvedRetry,
          status: "DRAFT",
          version: 1,
          ...(phaseId ? { phaseId } : {}),
          ...(fabricatedNameViolationsRetry.length > 0 ? {
            metadata: {
              fabricatedNames: fabricatedNameViolationsRetry,
              fabricatedNamesCheckedAt: new Date().toISOString(),
            } as any,
          } : {}),
        },
      });
      existingNames.add(name.toLowerCase());
      generatedNormNames.add(normalizeName(name));
      totalGenerated++;
      try {
        const { onArtefactGenerated } = await import("@/lib/agents/task-scaffolding");
        await onArtefactGenerated(agentId, projectId, name);
      } catch {}
      // Same contradiction pass as the main loop (see comment above).
      (async () => {
        try {
          const { detectContradictions, persistContradictions } = await import("@/lib/agents/contradiction-detector");
          const { contradictions, cacheKey } = await detectContradictions({ projectId, artefactName: name, draftContent: resolvedRetry, artefactId: createdRetry.id });
          await persistContradictions(createdRetry.id, contradictions, cacheKey || undefined);
        } catch {}
      })();
    } catch (e) {
      console.error(`[generatePhaseArtefacts] Retry failed for "${name}":`, e);
    }
  }

  // Honest summary: report which requested artefacts still haven't been produced.
  const stillMissing = toGenerate.filter(n => !generatedNormNames.has(normalizeName(n)));

  if (totalGenerated > 0) {
    try {
      const { CreditService } = await import("@/lib/credits/service");
      await CreditService.deduct(agent.orgId, Math.max(5, totalGenerated * 2), `Generated ${targetPhaseName} artefacts for "${project.name}"`, agentId);
    } catch {}
    const missingNote = stillMissing.length > 0
      ? ` — ${stillMissing.length} still pending (${stillMissing.join(", ")})`
      : "";
    await db.agentActivity.create({
      data: { agentId, type: "document", summary: `${targetPhaseName}: ${totalGenerated} artefact(s) generated — ready for review${missingNote}` },
    });

    // Collect TBC items across all newly-generated artefacts and ask the user to confirm them
    try {
      const newArtefacts = await db.agentArtefact.findMany({
        where: { projectId, agentId },
        select: { name: true, content: true },
        orderBy: { createdAt: "desc" },
        take: totalGenerated,
      });
      const tbcItems = extractTBCItems(newArtefacts);
      await createClarificationMessage(agentId, projectId, agent.orgId, tbcItems);
    } catch (e) {
      console.error("[generatePhaseArtefacts] TBC extraction failed:", e);
    }
  } else if (toGenerate.length > 0) {
    // Generation attempted but produced nothing — don't go silent.
    await db.agentActivity.create({
      data: { agentId, type: "document", summary: `${targetPhaseName}: artefact generation failed for ${toGenerate.length} document(s) (${stillMissing.join(", ")}) — please retry from the Artefacts tab` },
    }).catch(() => {});
  }

  return { generated: totalGenerated, skipped, phase: targetPhaseName, missing: stillMissing };
}

/**
 * Initialise the project lifecycle: create Phase rows, set currentPhase,
 * and generate initial artefacts via Claude.
 */
export async function runLifecycleInit(agentId: string, deploymentId: string) {
  const deployment = await db.agentDeployment.findUnique({
    where: { id: deploymentId },
    include: { project: true, agent: true },
  });
  if (!deployment) throw new Error("Deployment not found");

  const project = deployment.project;
  const agent = deployment.agent;
  const methodologyId = (project.methodology || "traditional").toLowerCase().replace("agile_", "");
  const methodology = getMethodology(methodologyId);
  const playbook = getPlaybook(methodologyId);

  // ── Step 1: Create Phase rows in DB ──
  await db.agentActivity.create({
    data: { agentId, type: "deployment", summary: `Initialising ${methodology.name} lifecycle for "${project.name}"` },
  });

  // Read user's artefact selections from deployment config (set during Deploy Wizard Step 3)
  const deploymentConfig = deployment.config as Record<string, any> | null;
  const configPhases: Array<{ name: string; artefacts: Array<{ name: string; required: boolean }> }> =
    Array.isArray(deploymentConfig?.phases) ? deploymentConfig.phases : [];

  const existingPhases = await db.phase.findMany({ where: { projectId: project.id } });
  if (existingPhases.length === 0) {
    for (let i = 0; i < methodology.phases.length; i++) {
      const phase = methodology.phases[i];
      // Use user's wizard selections if present; fall back to methodology defaults
      const phaseConfig = configPhases.find(p => p.name === phase.name);
      // Store ALL aiGeneratable artefacts in Phase.artefacts (required + optional).
      // generatePhaseArtefacts() reads this list — if only required ones are stored,
      // optional artefacts are never generated on subsequent cycles.
      const aiGeneratableNames = new Set(phase.artefacts.filter(a => a.aiGeneratable).map(a => a.name));
      const selectedArtefacts = phaseConfig
        ? phaseConfig.artefacts.filter(a => aiGeneratableNames.has(a.name)).map(a => a.name)
        : phase.artefacts.filter(a => a.aiGeneratable).map(a => a.name);
      await db.phase.create({
        data: {
          projectId: project.id,
          name: phase.name,
          order: i,
          status: i === 0 ? "ACTIVE" : "PENDING",
          criteria: phase.gate.criteria,
          artefacts: selectedArtefacts,
          approvalReq: phase.gate.preRequisites.some(p => p.requiresHumanApproval),
        },
      });
    }
  }

  // ── Step 2: Set current phase ──
  // phaseStatus = "researching" blocks ALL generation paths (cron, self-heal,
  // generatePhaseArtefacts) until the user completes the onboarding flow:
  // Research → Review → Clarification → Generate.
  // nextCycleAt is set far in the future so the cron doesn't interfere.
  const firstPhase = methodology.phases[0];
  await db.agentDeployment.update({
    where: { id: deploymentId },
    data: {
      currentPhase: firstPhase.name,
      phaseStatus: "researching",
      lastCycleAt: new Date(),
      nextCycleAt: new Date(Date.now() + 24 * 60 * 60_000), // 24h — no cron interference
    },
  });

  // ── Step 2b: Scaffold comprehensive PM task list across all phases ──
  try {
    const { scaffoldProjectTasks } = await import("@/lib/agents/task-scaffolding");
    const phaseRows = await db.phase.findMany({
      where: { projectId: project.id },
      select: { id: true, name: true, order: true },
      orderBy: { order: "asc" },
    });
    await scaffoldProjectTasks(agentId, project.id, phaseRows, { ...project, methodology: project.methodology });
  } catch (e) {
    console.error("[lifecycle-init] task scaffolding failed:", e);
  }

  // ── Step 3: Feasibility research → Clarification questions → Generate artefacts ──
  // The agent researches the project context FIRST, then asks informed questions,
  // then generates artefacts with full knowledge. Artefacts are NOT generated
  // until clarification is complete (the session-complete handler triggers generation).

  if (process.env.ANTHROPIC_API_KEY) {
    // Build the AI-generatable set from the methodology definition (capability filter)
    const aiGeneratableSet = new Set(firstPhase.artefacts.filter(a => a.aiGeneratable).map(a => a.name.toLowerCase()));

    const firstPhaseConfig = configPhases.find(p => p.name === firstPhase.name);
    const artefactNames = firstPhaseConfig
      ? firstPhaseConfig.artefacts.filter(a => a.required && aiGeneratableSet.has(a.name.toLowerCase())).map(a => a.name)
      : firstPhase.artefacts.filter(a => a.aiGeneratable).map(a => a.name);

    if (artefactNames.length > 0) {
      // ── 3a: Feasibility research via Perplexity AI ──
      let researchSummary = "";
      let researchFacts = 0;
      let researchSections: Array<{ label: string; content: string }> = [];
      let researchFactsList: Array<{ title: string; content: string }> = [];
      try {
        const { runFeasibilityResearch } = await import("@/lib/agents/feasibility-research");
        const research = await runFeasibilityResearch(agentId, project.id, agent.orgId);
        researchSummary = research.summary;
        researchFacts = research.factsDiscovered;
        researchSections = research.sections || [];
        researchFactsList = research.facts || [];
      } catch (e) {
        console.error("[runLifecycleInit] feasibility research failed:", e);
        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: "Feasibility research unavailable — proceeding with clarification questions" },
        }).catch(() => {});
      }

      // ── 3a.5: Promote research findings to canonical tables ────────────
      // Risks, issues, and cost estimates that research surfaced get lifted
      // out of KB and into their dedicated tables so the Risk Register,
      // Issues page, and Cost page populate immediately. All extractors are
      // idempotent (each tags processed KB items so re-runs are no-ops).
      // Risk extractor runs first so the AI scorer downstream has rows to
      // operate on. Issue + cost extractors run in parallel.
      try {
        const { promoteKBRisksToCanonical } = await import("@/lib/agents/risk-extractor");
        const riskResult = await promoteKBRisksToCanonical(project.id);
        if (riskResult.created > 0) {
          await db.agentActivity.create({
            data: {
              agentId,
              type: "risk",
              summary: `Promoted ${riskResult.created} research-identified risk${riskResult.created === 1 ? "" : "s"} to the Risk Register for "${project.name}"`,
            },
          }).catch(() => {});

          // Score with Haiku so the Risk Register reads with realistic
          // probability/impact + mitigation, not 3×3 placeholders. Fire-and-
          // forget so the lifecycle isn't blocked by the LLM round-trip.
          (async () => {
            try {
              const { scoreRisksWithAI } = await import("@/lib/agents/risk-ai-scorer");
              const scored = await scoreRisksWithAI({ projectId: project.id });
              if (scored.scored > 0) {
                await db.agentActivity.create({
                  data: {
                    agentId,
                    type: "risk",
                    summary: `AI-scored ${scored.scored} risk${scored.scored === 1 ? "" : "s"} with project-aware probability/impact + mitigation suggestions`,
                  },
                }).catch(() => {});
              }
            } catch (e) {
              console.error("[runLifecycleInit] risk AI scoring failed:", e);
            }
          })();
        }
      } catch (e) {
        console.error("[runLifecycleInit] risk promotion failed:", e);
      }

      // Issues + costs + milestones in parallel — independent of each
      // other and of risk. Each extractor is idempotent, so retries on a
      // re-deploy are safe.
      Promise.all([
        (async () => {
          try {
            const { promoteKBIssuesToCanonical } = await import("@/lib/agents/issue-extractor");
            const r = await promoteKBIssuesToCanonical(project.id);
            if (r.created > 0) {
              await db.agentActivity.create({
                data: { agentId, type: "issue", summary: `Logged ${r.created} active issue${r.created === 1 ? "" : "s"} from research findings` },
              }).catch(() => {});
            }
          } catch (e) { console.error("[runLifecycleInit] issue promotion failed:", e); }
        })(),
        (async () => {
          try {
            const { promoteResearchCostsToCanonical } = await import("@/lib/agents/cost-extractor");
            const r = await promoteResearchCostsToCanonical(project.id);
            if (r.created > 0) {
              await db.agentActivity.create({
                data: { agentId, type: "cost_planning", summary: `Captured ${r.created} cost estimate${r.created === 1 ? "" : "s"} from research findings` },
              }).catch(() => {});
            }
          } catch (e) { console.error("[runLifecycleInit] cost promotion failed:", e); }
        })(),
        (async () => {
          try {
            const { promoteResearchMilestonesToTasks } = await import("@/lib/agents/milestone-extractor");
            const r = await promoteResearchMilestonesToTasks(project.id);
            if (r.created > 0) {
              await db.agentActivity.create({
                data: { agentId, type: "document", summary: `Scaffolded ${r.created} milestone task${r.created === 1 ? "" : "s"} from research lead-time hints` },
              }).catch(() => {});
            }
          } catch (e) { console.error("[runLifecycleInit] milestone promotion failed:", e); }
        })(),
      ]).catch(() => {});

      // ── 3b: Present research findings as enterprise card ──
      if (researchFacts > 0) {
        await db.chatMessage.create({
          data: {
            agentId,
            role: "agent",
            content: "__RESEARCH_FINDINGS__",
            metadata: {
              type: "research_findings",
              projectName: project.name,
              factsCount: researchFacts,
              sections: researchSections.map(s => ({ label: s.label, content: s.content.slice(0, 3000) })),
              facts: researchFactsList.slice(0, 30).map(f => ({ title: f.title, content: f.content.slice(0, 300) })),
            } as any,
          },
        }).catch(() => {});
      }

      // ── 3c: Strict-sequencing checkpoint ──
      // The user explicitly chose: research must be APPROVED before
      // clarification questions are posted. Check whether the research
      // run created any pending research-finding approvals. If yes, hold
      // here — clarification will be kicked off by the research-approval
      // handler when the user clears the queue. If no (e.g. research
      // returned zero facts, or the approval was somehow auto-cleared),
      // fall through to the original clarification flow.
      const pendingResearchApprovals = await db.approval.count({
        where: {
          projectId: project.id,
          status: "PENDING",
          type: "CHANGE_REQUEST",
          impact: { path: ["subtype"], equals: "research_finding" },
        },
      }).catch(() => 0);

      if (pendingResearchApprovals > 0) {
        await db.agentDeployment.update({
          where: { id: deploymentId },
          data: { phaseStatus: "awaiting_research_approval" },
        });
        await db.chatMessage.create({
          data: {
            agentId,
            role: "agent",
            content: [
              `## Research is in — your turn`,
              ``,
              `I've completed ${researchFacts > 0 ? `**${researchFacts}** research findings` : "research"} for **${project.name}** and posted ${pendingResearchApprovals === 1 ? "a single approval" : `${pendingResearchApprovals} approval bundles`} on the Approvals page.`,
              ``,
              `Once you've reviewed and approved the findings (so I know which facts to trust), I'll post clarification questions to fill any remaining gaps before drafting the ${firstPhase.name} artefacts.`,
              ``,
              `[Open Approvals](/approvals)`,
            ].join("\n"),
          },
        }).catch(() => {});
        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: `Research complete (${researchFacts} facts) — awaiting your approval on ${pendingResearchApprovals} research finding bundle${pendingResearchApprovals === 1 ? "" : "s"} before clarification can begin.` },
        }).catch(() => {});
        return;
      }

      // No pending research approvals → continue with original flow.
      await db.agentDeployment.update({
        where: { id: deploymentId },
        data: { phaseStatus: "awaiting_clarification" },
      });

      // ── 3d: Start clarification session (informed by research) ──
      // Discriminated outcome — replaces the boolean return that allowed
      // silent fall-through on API failures (the original Birmingham-class
      // bug). Each branch is handled explicitly; "failed" never proceeds.
      const { startClarificationSession } = await import("@/lib/agents/clarification-session");
      const { markClarificationSkipped } = await import("@/lib/agents/phase-next-action");
      let sessionStarted = false;
      let clarificationOutcome: Awaited<ReturnType<typeof startClarificationSession>> | null = null;
      try {
        clarificationOutcome = await startClarificationSession(agentId, project.id, agent.orgId, artefactNames, researchSummary);
      } catch (e: any) {
        clarificationOutcome = { outcome: "failed", reason: `Threw: ${e?.message || "unknown"}` };
      }

      if (clarificationOutcome.outcome === "started" || clarificationOutcome.outcome === "already_active") {
        sessionStarted = true;
        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: `Research complete (${researchFacts} facts). Clarification questions posted — artefacts will generate after you answer.` },
        }).catch(() => {});
      } else if (clarificationOutcome.outcome === "no_questions") {
        // Genuine "nothing to ask" — record the skip with the reason so the
        // resolver knows clarification is legitimately complete for this
        // phase. THIS is the only path that's allowed to proceed without
        // user input.
        await markClarificationSkipped(project.id, firstPhase.name, "no_questions_needed");
        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: `Clarification skipped: ${clarificationOutcome.reason} — proceeding to generation.` },
        }).catch(() => {});
        // Fall through to assumption-approval card so user can still review
        // before generation starts.
      } else {
        // outcome === "failed" — DO NOT silently fall through. Surface the
        // failure to the user and require an explicit retry. Artefact
        // generation is blocked until clarification is either completed or
        // skipped via the explicit user action.
        console.error(`[runLifecycleInit] clarification session FAILED: ${clarificationOutcome.reason}`);
        await db.chatMessage.create({
          data: {
            agentId,
            role: "agent",
            content: [
              `## Clarification setup hit a snag`,
              ``,
              `I couldn't generate clarification questions for **${project.name}** automatically. Reason: \`${clarificationOutcome.reason}\``,
              ``,
              `**Two options:**`,
              `1. Reply with anything you'd like me to know about the project (budget, timeline, attendees, constraints) and I'll save it as a fact.`,
              `2. Reply **"Skip questions and generate"** if you'd rather I draft documents using only what I already know — every gap will be marked **[TBC]** for you to fill in afterwards.`,
              ``,
              `I won't generate until you choose one — I'd rather pause than draft on incomplete info.`,
            ].join("\n"),
            metadata: {
              type: "clarification_failed",
              reason: clarificationOutcome.reason,
              phase: firstPhase.name,
            } as any,
          },
        }).catch(() => {});
        await db.agentDeployment.update({
          where: { id: deploymentId },
          data: { phaseStatus: "awaiting_clarification" },
        }).catch(() => {});
        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: `Clarification FAILED (${clarificationOutcome.reason}) — user prompted to retry or explicitly skip` },
        }).catch(() => {});
        return;
      }

      // ── 3e: If clarification didn't start (no_questions branch), present
      // assumptions and ask for approval. Started/active branches return
      // earlier — only the "no_questions" path falls through here.
      if (!sessionStarted) {
        // Fetch what the agent knows from KB to present as assumptions
        const kbItems = await db.knowledgeBaseItem.findMany({
          where: { agentId, projectId: project.id, NOT: { title: { startsWith: "__" } } },
          orderBy: [{ trustLevel: "desc" }, { updatedAt: "desc" }],
          select: { title: true, content: true, trustLevel: true },
          take: 20,
        });

        const assumptionsList = kbItems.length > 0
          ? kbItems.map(i => `- **${i.title}** [${i.trustLevel}]: ${i.content.replace(/^\[Research.*?\]\s*/i, "").slice(0, 200)}`).join("\n")
          : "- No specific assumptions — I'll use only the project details you provided.";

        const artefactList = artefactNames.map(n => `- ${n}`).join("\n");

        await db.chatMessage.create({
          data: {
            agentId,
            role: "agent",
            content: [
              `## Ready to Generate Documents`,
              ``,
              `I've completed my research on **"${project.name}"** and I'm ready to generate the following **${firstPhase.name}** phase artefacts:`,
              ``,
              artefactList,
              ``,
              `### Assumptions I'll use:`,
              assumptionsList,
              ``,
              `> **Please review the above.** If anything needs correcting or if you have additional information, let me know now. Otherwise, reply **"Go ahead"** or **"Generate"** and I'll create these documents for you.`,
            ].join("\n"),
          },
        }).catch(() => {});

        // Keep status as awaiting_clarification — artefacts will be generated
        // when the user replies with approval (handled by chat response logic)
        await db.agentDeployment.update({
          where: { id: deploymentId },
          data: { phaseStatus: "awaiting_clarification" },
        });

        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: `Research complete — assumptions presented, awaiting user approval before generating ${artefactNames.length} artefact(s)` },
        }).catch(() => {});
      } // end if (!sessionStarted)
    }
  }

  // ── Step 4: Risk Register starts empty ──
  // Previously seeded universal placeholders ("Budget overrun" referencing
  // a £0 budget when project.budget was null, etc.). That misled the user
  // into thinking the agent had analysed the project at deploy time when
  // no facts had been confirmed yet. Real risks now flow from research
  // findings, artefact action items (Charter / PMP), and user input.

  // ── Step 5: Create gate approval request — BUT ONLY if artefacts exist ──
  // Premature gates (zero artefacts) were flooding the approvals queue. A phase
  // gate is only meaningful when there's something to review.
  const preCheckArtefactCount = await db.agentArtefact.count({ where: { projectId: project.id, agentId } });
  if (preCheckArtefactCount === 0) {
    await db.agentActivity.create({
      data: {
        agentId,
        type: "system",
        summary: `Skipped phase gate creation for ${firstPhase.name} — 0 artefacts exist yet. Gate will be created after artefacts are generated.`,
      },
    }).catch(() => {});
    // Early exit from Step 5 — no gate
    return;
  }

  const existingGate = await db.approval.findFirst({
    where: { projectId: project.id, type: "PHASE_GATE", status: "PENDING" },
  });
  if (existingGate) {
    // Gate already exists (VPS created it) — update with accurate counts
    const [ac, rc, tc] = await Promise.all([
      db.agentArtefact.count({ where: { projectId: project.id, agentId } }),
      db.risk.count({ where: { projectId: project.id, status: "OPEN" } }),
      db.task.count({ where: { projectId: project.id } }),
    ]);
    await db.approval.update({
      where: { id: existingGate.id },
      data: { description: `Agent ${agent.name} has completed the ${firstPhase.name} phase. Generated ${ac} artefact(s), identified ${rc} risk(s), scaffolded ${tc} task(s). Review and approve to advance.` },
    });
  } else {
  const orgOwner = await db.user.findFirst({
    where: { orgId: agent.orgId, role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  // Calculate real impact scores for the phase gate
  const [artefactCount, riskCount, taskCount] = await Promise.all([
    db.agentArtefact.count({ where: { projectId: project.id, agentId } }),
    db.risk.count({ where: { projectId: project.id, status: "OPEN" } }),
    db.task.count({ where: { projectId: project.id } }),
  ]);
  const budget = project.budget || 0;
  // Schedule: 1 if early phases, 2 if mid, 3 if late phases have dependencies
  const scheduleImpact = methodology.phases.length > 3 ? 2 : 1;
  // Cost: based on budget size
  const costImpact = budget > 100000 ? 3 : budget > 10000 ? 2 : 1;
  // Scope: based on artefact count (more docs = more scope defined)
  const scopeImpact = artefactCount > 8 ? 2 : 1;
  // Stakeholder: based on risk count (more risks = more stakeholder concern)
  const stakeholderImpact = riskCount > 5 ? 3 : riskCount > 2 ? 2 : 1;

  // Guarded create — refuses if the phase isn't actually advance-ready.
  // Without this lifecycle-init was raising a gate on every first-phase
  // bootstrap regardless of whether artefacts/PM tasks/clarification
  // were complete, which is exactly the misalignment the user reported.
  const { createPhaseGateApprovalIfReady } = await import("./phase-gate-guard");
  const nextPhaseDef = methodology.phases[1];
  const outcome = await createPhaseGateApprovalIfReady({
    projectId: project.id,
    phaseName: firstPhase.name,
    nextPhaseName: nextPhaseDef ? nextPhaseDef.name : "next phase",
    agentId,
    description: `Agent ${agent.name} has completed the ${firstPhase.name} phase. Generated ${artefactCount} artefact(s), identified ${riskCount} risk(s), scaffolded ${taskCount} task(s). Review and approve to advance.`,
    urgency: costImpact >= 3 || stakeholderImpact >= 3 ? "HIGH" : "MEDIUM",
  });
  if (outcome.skipped) {
    console.log(`[lifecycle-init] gate not raised (${outcome.reason}): ${outcome.blockers.join("; ")}`);
    await db.agentActivity.create({
      data: {
        agentId,
        type: "approval",
        summary: `Phase gate not yet raised — ${outcome.blockers.slice(0, 2).join("; ") || "phase not advance-ready"}. Will fire once readiness checks pass.`,
      },
    }).catch(() => {});
  } else {
    await db.agentActivity.create({
      data: { agentId, type: "approval", summary: `Phase gate approval requested: ${firstPhase.name} → awaiting review` },
    });
  }
  } // end else (no existing gate)

  // Mark the job as completed if it exists
  try {
    await db.agentJob.updateMany({
      where: { agentId, type: "lifecycle_init", status: { in: ["PENDING", "FAILED"] } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch {}

  return { phases: methodology.phases.length, currentPhase: firstPhase.name };
}

function buildSpreadsheetPrompt(project: any, phaseName: string, artefactNames: string[], methodologyName: string, knowledgeContext = ""): string {
  const category = (project.category || "other").toLowerCase();
  const isTravel = category === "travel" || (project.name || "").toLowerCase().includes("trip") || (project.name || "").toLowerCase().includes("holiday");
  const isNigeria = (project.name || "").toLowerCase().includes("nigeria") || (project.name || "").toLowerCase().includes("lagos");
  const today = new Date().toLocaleDateString("en-GB");
  const startDate = project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "TBD";
  const endDate = project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "TBD";
  const budget = project.budget || 0;
  const budgetStr = budget.toLocaleString();

  const artefactInstructions = artefactNames.map(name => {
    const cols = getArtefactColumns(name);
    const headerRow = cols.length > 0 ? cols.join(",") : "ID,Description,Owner,Status,Notes";
    const lname = name.toLowerCase();
    let dataInstructions = "";

    if (lname.includes("schedule") || lname.includes("wbs") || lname.includes("work breakdown") || lname.includes("schedule baseline")) {
      const taskCategories = isTravel
        ? "Pre-Departure Planning, Bookings & Reservations, Documentation & Visas, Health Preparation, Packing, Day-by-Day Itinerary, Post-Trip"
        : "Project Setup, Requirements, Design, Build, Test, Deploy, Closure";
      const nigeriaTaskDetails = isNigeria ? `
MANDATORY TRAVEL TASKS TO INCLUDE (with realistic dates):
- Research Nigeria / Lagos trip (Pre-Departure Planning)
- Book return flights LHR→LOS (Bookings)
- Apply for Nigerian visa — allow 6+ weeks (Documentation & Visas)
- Obtain yellow fever vaccination certificate — MANDATORY FOR ENTRY — book GP appt (Health Preparation)
- Malaria prophylaxis prescription — GP appointment 6+ weeks before travel (Health Preparation)
- Book accommodation in Victoria Island or Ikoyi (Bookings)
- Arrange airport transfer from MMIA (Bookings)
- Purchase travel insurance with medical & repatriation cover (Documentation)
- Register trip with FCDO TravelAware website (Documentation)
- Get local Nigerian SIM card details / research Airtel or MTN (Pre-Departure)
- Pack and pre-departure checklist review (Packing)
- Day-by-day itinerary activities (Day-by-Day)
- Post-trip expense reconciliation (Post-Trip)` : "";
      dataInstructions = `Generate 15-25 specific task rows.
Task categories: ${taskCategories}
${nigeriaTaskDetails}
⚠️ DATE RULES — CRITICAL:
- The project START date is ${startDate}. The FIRST task must begin on exactly ${startDate}.
- All subsequent tasks must cascade forward from ${startDate} — no task may have a Planned Start before ${startDate}.
- Spread tasks across the full project timeline up to ${endDate}.
- Tasks are a PLAN — they have no actual start/end yet. Leave Actual Start and Actual End columns blank.
Assign each task to a ROLE TITLE only (e.g. "Project Manager", "Travel Booker") — NEVER invent personal names; use "TBD" if the person is unknown.
⚠️ STATUS RULES — CRITICAL:
- Set ALL tasks to Status "Not Started" and % Complete = 0.
- Do NOT infer completion from dates. You have NO knowledge of what has actually been done.
- Do NOT mark any task "Complete" or set % Complete > 0 — the user updates actuals as work happens.
- RAG column: set ALL tasks to "Green" as the baseline plan.
- Critical Path: Yes/No — identify which tasks must not slip.
Quote any fields containing commas.`;
    } else if (lname.includes("risk")) {
      const riskRows = isTravel ? (isNigeria ? `"R001","Logistics","Flight cancellation or severe delay","Return flight LHR-LOS cancelled or delayed >6hrs disrupting entire itinerary","2","4","8","HIGH","Traveller","Book flexible/refundable fares. Comprehensive travel insurance with cancellation cover","Rebook next available flight. Claim insurance","4","Open","${today}"
"R002","Documentation","Lost or stolen passport","Passport lost or stolen preventing travel or return to UK","1","5","5","MEDIUM","Traveller","Digital copies in cloud. Note British High Commission Lagos: +234 (0)1 277-0780","Emergency travel document via British High Commission","2","Open","${today}"
"R003","Documentation","Visa delays or refusal","Nigerian visa application delayed or refused preventing travel","2","5","10","HIGH","Traveller","Apply minimum 8 weeks in advance. Use reputable visa service. Monitor application","Rebook travel. Contact High Commission directly","5","Open","${today}"
"R004","Health","Yellow fever entry refusal","Entry to Nigeria refused — yellow fever vaccination certificate (yellow card) mandatory with NO exceptions","1","5","5","MEDIUM","Traveller","Book GP appointment immediately. Allow 10+ days for vaccination. Keep certificate in hand luggage","No contingency — must obtain certificate before travel","2","Open","${today}"
"R005","Health","Malaria risk","Nigeria is high-risk malaria country. Illness without prophylaxis can be severe","2","5","10","HIGH","Traveller","GP appointment for prophylaxis prescription (Doxycycline or Malarone). Start per GP guidance","Emergency medical insurance with repatriation cover","4","Open","${today}"
"R006","Security","Crime and safety risk in Lagos","FCO advises high awareness in Lagos. Petty crime, scams, and road safety incidents elevated","3","4","12","HIGH","Project Manager","Stay in recommended areas (Victoria Island/Ikoyi/Lekki). Pre-arrange trusted airport transfer. Brief on common scams","Emergency evacuation insurance. Register with FCDO TravelAware","6","Open","${today}"
"R007","Financial","Naira exchange rate volatility","NGN/GBP rate volatile. Parallel market rate 30-60% different from official rate. Budget variance risk HIGH","3","3","9","MEDIUM","Project Manager","Research current rates before travel. Take mixed GBP/USD cash + cards. Use reliable exchange services","15% contingency buffer in budget","5","Open","${today}"
"R008","Operational","Power outages (NEPA)","Frequent power cuts across Nigeria lasting hours. Hotel facilities impacted","4","2","8","MEDIUM","Traveller","Book hotels with generator backup confirmed. Carry power bank. Download offline maps/content","Flexible daily schedule. Generator hotels only","4","Open","${today}"
"R009","Operational","Internet and connectivity issues","4G may be patchy. UK data roaming expensive or unavailable","3","2","6","LOW","Traveller","Purchase local SIM on arrival (Airtel/MTN). Pre-download offline maps and documents","Offline backups of all itinerary and booking documents","2","Open","${today}"
"R010","Financial","Budget overrun","Actual trip spend exceeds planned budget of £${budgetStr}","2","3","6","MEDIUM","Project Manager","Track all spend in budget tracker. 10% variance triggers review. Maintain contingency reserve","Reduce discretionary activities. Apply contingency reserve","3","Open","${today}"
"R011","Health","Medical emergency abroad","Illness or injury requiring hospital treatment in Nigeria","2","4","8","HIGH","Traveller","Comprehensive travel insurance with medical and repatriation cover. Research nearest international hospital in Lagos (Eko Hospital, Lagos Island General)","Insurance emergency helpline. Repatriation if required","4","Open","${today}"
"R012","Logistics","Accommodation issues on arrival","Booked accommodation unavailable overbooked or below acceptable standard","1","3","3","LOW","Traveller","Book well-reviewed hotel. Keep confirmation email. Research backup hotels in same area","Relocate immediately. Claim via booking platform","1","Open","${today}"` : `"R001","Logistics","Flight cancellation or delay","Return flight cancelled or delayed >6hrs disrupting entire trip","2","4","8","HIGH","Traveller","Flexible fares. Travel insurance with cancellation cover","Rebook. Claim insurance","4","Open","${today}"
"R002","Documentation","Lost or stolen passport","Passport lost preventing travel or return","1","5","5","MEDIUM","Traveller","Digital copies in cloud. Note local embassy details","Emergency travel document via Embassy","2","Open","${today}"
"R003","Documentation","Visa delays","Visa application delayed beyond travel date","2","4","8","HIGH","Traveller","Apply 8+ weeks early. Monitor application","Rebook travel. Contact embassy","4","Open","${today}"
"R004","Financial","Budget overrun","Spend exceeds £${budgetStr} budget","3","3","9","MEDIUM","Project Manager","Weekly cost tracking. 10% variance triggers review","Apply contingency reserve","4","Open","${today}"
"R005","Health","Medical emergency abroad","Illness requiring medical attention","2","4","8","HIGH","Traveller","Comprehensive travel insurance. Research local hospitals","Insurance emergency line. Repatriation","4","Open","${today}"
"R006","Logistics","Accommodation issues","Accommodation unavailable or below standard","1","3","3","LOW","Traveller","Book with confirmed reviews. Keep confirmation","Relocate to backup","1","Open","${today}"`) : `"R001","Financial","Budget overrun","Project costs exceed planned budget of £${budgetStr}","3","4","12","HIGH","Project Manager","Weekly cost tracking. 10% variance triggers review. 20% triggers exception report","Descope lower priority work. Apply contingency","6","Open","${today}"
"R002","Schedule","Schedule slippage","Key milestones delayed due to dependency chains or resource issues","3","3","9","MEDIUM","Project Manager","Weekly progress reviews. Critical path monitoring. Escalation at 1-week slip","Replan remaining work. Escalate to sponsor","4","Open","${today}"
"R003","Stakeholder","Stakeholder unavailability","Key decision-makers unavailable for approvals causing delays","2","3","6","MEDIUM","Project Manager","Confirm availability at project start. Allow approval lead time in schedule","Delegate to nominated deputy","3","Open","${today}"
"R004","Scope","Scope creep","Additional requirements added without formal change control","3","3","9","MEDIUM","Project Manager","Strict change control. Documented scope baseline","Formal change request required","4","Open","${today}"
"R005","Resource","Key resource unavailability","Critical team member becomes unavailable","2","4","8","HIGH","Project Manager","Identify backup resources. Document knowledge","Bring in contractor. Replan affected tasks","4","Open","${today}"
"R006","Quality","Acceptance criteria not met","Deliverables fail to meet agreed acceptance criteria","2","4","8","HIGH","Project Manager","Clear acceptance criteria upfront. Regular quality reviews","Rework cycle. Lessons learned","4","Open","${today}"`;
      dataInstructions = `Use these exact data rows:
${riskRows}
Quote fields containing commas.`;
    } else if (lname.includes("stakeholder")) {
      const stRows = isTravel ? (isNigeria ? `"S001","Primary Traveller","Individual","Trip participant — makes all decisions and approvals","H","H","Champion","Champion","Direct","Daily","Self","Full ownership of all trip decisions"
"S002","Travel Agent / Booking Platform","Service Provider","Manages bookings. Key service delivery partner","M","L","Supportive","Supportive","Email/Phone","As needed","Primary Traveller","Booking confirmation and changes"
"S003","Airline (LHR-LOS route)","Service Provider","Transports traveller. Critical dependency for whole trip","H","L","Neutral","Neutral","App/Email","At booking and check-in","Primary Traveller","Flight bookings and changes"
"S004","Accommodation — Lagos","Service Provider","Provides lodging in destination. Safety and comfort critical","M","H","Neutral","Supportive","Email/App","Pre-arrival and during stay","Primary Traveller","Safety standards, generator backup, location"
"S005","Nigerian Host / Local Contact","Individual","Local knowledge, guidance, logistics support in Lagos","M","H","Supportive","Champion","WhatsApp/Phone","Daily during trip","Primary Traveller","Local knowledge, safety advice, local contacts"
"S006","British High Commission Lagos","Government","UK consular support in Nigeria. Emergency assistance","H","L","Neutral","Neutral","Emergency line / Website","Emergency only","Primary Traveller","Register on FCDO TravelAware. Emergency: +234 (0)1 277-0780"
"S007","Travel Insurance Provider","Service Provider","Financial protection against all trip disruptions. Medical cover essential","H","M","Neutral","Supportive","Phone/App","Claims as required","Primary Traveller","Policy coverage limits, claims process, emergency helpline"
"S008","GP / Travel Health Clinic","Healthcare Provider","Vaccination and health advice. Yellow fever cert and malaria prophylaxis essential","M","H","Neutral","Supportive","In-person/Phone","Pre-departure only","Primary Traveller","Yellow fever certificate, malaria prophylaxis, fitness to travel"
"S009","Emergency Contact (UK)","Individual","Family/friend. Notified of itinerary. Point of contact if traveller cannot be reached","M","H","Supportive","Champion","Phone/WhatsApp","Emergency + weekly check-in","Primary Traveller","Holds copy of all documents and itinerary"` : `"S001","Primary Traveller","Individual","Trip participant and decision-maker","H","H","Champion","Champion","Direct","Daily","Self","Full ownership"
"S002","Travel Agent / Booking Platform","Service Provider","Manages bookings","M","L","Supportive","Supportive","Email/Phone","As needed","Primary Traveller","Booking confirmation"
"S003","Airline","Service Provider","Core transport provider","H","L","Neutral","Neutral","App/Email","Booking and check-in","Primary Traveller","Flight bookings"
"S004","Accommodation Provider","Service Provider","Lodging at destination","M","H","Neutral","Supportive","Email/App","Pre-arrival","Primary Traveller","Safety and standards"
"S005","Travel Insurance Provider","Service Provider","Financial and medical protection","H","M","Neutral","Supportive","Phone/App","Claims","Primary Traveller","Policy coverage"
"S006","Emergency Contact (UK)","Individual","Home contact for emergencies","M","H","Supportive","Champion","Phone/WhatsApp","Emergency","Primary Traveller","Holds itinerary copy"`) : `"S001","Project Sponsor","Internal","Provides funding and strategic direction. Ultimate decision-maker and phase gate approver","H","H","Supportive","Champion","Meeting/Email","Weekly","PM","Budget approval, strategic direction, phase gate sign-off"
"S002","Project Manager (AI Agent)","Internal","Day-to-day project management delivery and reporting","H","H","Champion","Champion","All channels","Daily","Self","All project delivery and stakeholder management"
"S003","Delivery Team","Internal","Responsible for delivering project outputs to agreed quality","M","H","Supportive","Champion","Stand-up/Tools","Daily","PM","Task completion, quality, accurate estimation"
"S004","End Users / Clients","External","Will use or be directly affected by project outputs","M","H","Neutral","Supportive","Demo/Review","Bi-weekly","PM","Requirements validation, UAT participation, final acceptance"
"S005","Finance Department","Internal","Budget control, financial reporting, and payment approvals","H","M","Neutral","Supportive","Report/Meeting","Monthly","PM","Budget approval, actual cost tracking, variance authorisation"
"S006","External Suppliers","External","Provide contracted services or materials to the project","M","M","Neutral","Supportive","Email/Meeting","As needed","PM","On-time delivery, quality of contracted outputs"`;
      dataInstructions = `Use these EXACT data rows verbatim — do NOT modify them, do NOT add fabricated personal names:
${stRows}

⚠️ CRITICAL RULES FOR STAKEHOLDER REGISTER:
1. NEVER invent personal names like "Sarah Johnson", "Michael Chen", "James Smith". The Name/Role column MUST be a role title or relationship descriptor (e.g. "Primary Traveller", "Spouse", "Child 1", "Project Sponsor", "Finance Director", "British High Commission Lagos").
2. For family/personal trips, use relationship titles: "Primary Traveller (self)", "Spouse", "Partner", "Child 1 (age TBC)", "Child 2 (age TBC)", "Parent", "Grandparent". DO NOT invent family member names.
3. For organisations/suppliers, use the actual organisation name only if factually known (e.g. "Emirates Airlines" is fine if flights are confirmed with Emirates; "[Airline — TBC]" otherwise).
4. If the user's clarification answers included specific names, you MAY use those exact names. Otherwise, use role titles.
5. The seeder will REJECT any stakeholder row that looks like a fabricated personal name. Do not waste rows on names that will be filtered out.
Quote fields containing commas.`;
    } else if (lname.includes("budget") || lname.includes("cost management")) {
      // Default percentage allocations — used as a STARTING POINT only.
      // The agent should override these with research-anchored numbers
      // when the feasibility research above (in knowledgeContext) provides
      // concrete unit prices for this destination/period.
      let percentageHints = "";
      if (isTravel && budget > 0) {
        const flights = Math.round(budget * 0.35);
        const accomm = Math.round(budget * 0.25);
        const transfers = Math.round(budget * 0.10);
        const meals = Math.round(budget * 0.12);
        const activities = Math.round(budget * 0.08);
        const health = Math.round(budget * 0.04);
        const docs = Math.round(budget * 0.02);
        const contingency = budget - flights - accomm - transfers - meals - activities - health - docs;
        percentageHints = `Default percentage skeleton (use ONLY when research has no concrete number for that line):
  • Flights ~35% (£${flights})
  • Accommodation ~25% (£${accomm})
  • Transfers ~10% (£${transfers})
  • Meals & Dining ~12% (£${meals})
  • Activities ~8% (£${activities})
  • Health & Vaccinations ~4% (£${health})
  • Documentation & Insurance ~2% (£${docs}) — typically covers visas, travel insurance, FCDO registration
  • Contingency Reserve ~${Math.round(contingency/budget*100)}% (£${contingency}) — required, do not consume
`;
      } else {
        percentageHints = `Default category split (use ONLY when research has no concrete number for that line):
  • Labour 50-60% (per Resource Management Plan; reconcile against research day-rates if present)
  • External Services 15-25% (per contracts/procurement)
  • Materials & Equipment 10-20% (per WBS)
  • Travel & Expenses 2-5%
  • Contingency Reserve 10-15% (required, do not consume)

⚠️ LABOUR / HUMAN RESOURCE COSTS specifically:
The same selection rule applies. The IT/software and training feasibility research queries explicitly ASK for current day-rates by seniority — look for them in the KB. Then:
  - **If the user has confirmed roles/team size** in clarification (e.g. "we have 2 developers and 1 PM"): multiply role × research day-rate × project duration. Notes: "Research-anchored: 2 × Senior Dev @ £600/day × 60 days = £72,000 (also considered: contract market £750/day, offshore £200/day)".
  - **If the Resource Management Plan artefact exists in approved KB** (source D): use the FTE/rates from there. Notes: "Per approved Resource Management Plan: 3 FTEs over 6 months".
  - **If neither is available**: use the percentage default with Notes "Default-percentage — TBC: confirm team composition and rates".
  - Always cite the alternative seniority/sourcing options when research surfaces them so the user can flex the cost model.
`;
      }

      dataInstructions = `Generate the budget rows for this project's Cost Management Plan.

⚠️ HOW TO ESTIMATE EACH LINE — read this carefully:

1. RESEARCH FIRST. Scan the PROJECT KNOWLEDGE BASE above for any feasibility research, phase research, or KB facts that contain CONCRETE PRICES for the line you're writing. Examples:
   - "Atlantis The Palm — £350/night" → use this for Accommodation
   - "Return flights LHR-DXB May 2026 — £450-£700 economy" → use the midpoint × number of travellers for Flights
   - "UAE eVisa for UK passport holders — £75 per person" → use this × travellers for Documentation & Insurance
   - "Airport transfer Dubai — £40-£80" → use a midpoint for Transfers
${isTravel ? `   For TRAVEL projects: the feasibility research at deploy time WAS ASKED to surface accommodation cost ranges, transport costs, and visa fees as of the current year. If it produced numbers, USE THEM.` : ""}

2. IF RESEARCH HAS NO CONCRETE NUMBER for that line, fall back to the percentage skeleton below. Mark the row's Notes with "Default-percentage — TBC".

3. IF THE USER HAS CONFIRMED A SPECIFIC NUMBER (look for user_confirmed KB items), use that and mark Notes with "User-confirmed: <citation>".

4. THE NOTES COLUMN MUST BE PREFIXED with the source for traceability:
   - "Research-anchored: <quoted figure / source if cited>" when from feasibility/phase research
   - "User-confirmed: <quoted answer>" when from clarification answers
   - "Default-percentage — TBC" when neither source has a concrete number
   - "Reserved — do not consume" for the Contingency line

⚠️ SELECTION RULE WHEN RESEARCH OFFERS MULTIPLE OPTIONS:
The research often surfaces a range or a list (e.g. "4-star Dubai £200, 5-star £450, 7-star £1200" / "Emirates £700, BA £650, FlyDubai £500"). Use this priority:

  a. **User-confirmed wins absolutely.** If the user named a specific supplier/price/class in clarification (e.g. "we want Atlantis", "premium economy"), use that exact one — even if it's expensive — and mark "User-confirmed".
  b. **Otherwise pick the option that fits the budget envelope.** Compute the per-line target from the percentage skeleton (e.g. Accommodation = 25% × £${budget} = £${Math.round(budget*0.25)}). Divide by trip duration × rooms/people to get a per-night/per-person target. Pick the research option closest to that target. Don't default to the cheapest (false economy) or the most expensive (overspend).
  c. **List the rejected alternatives in Notes.** Always cite the chosen option AND list 1-2 nearby alternatives the user could swap to. Format: "Research-anchored: <chosen> @ £X/unit (also considered: <alt1> £Y, <alt2> £Z)". This lets the user see at a glance what their other options are without going to chat.
  d. **If the research is genuinely ambiguous** (e.g. no flight quotes for the specific date) flag it in Notes as "Research-thin — TBC: <what's missing>" and use the percentage default for the number.

${percentageHints}
Total Planned Cost across all rows MUST sum to approximately £${budgetStr}.
Output 7-9 rows for travel/event projects, 5-7 for general projects.
Quote any field containing commas. Use real numbers, not placeholders, in the Planned Cost column.`;
    } else {
      dataInstructions = `Generate 8-15 relevant data rows specific to this project (${project.name}).
Use real dates between ${startDate} and ${endDate}.
Assign each row to a ROLE TITLE (e.g. "Project Manager", "Finance Lead") — NEVER invent personal names.
⚠️ TBC RULE: For any cell where the specific value is not known from the project description, write: TBC — [plain description of what is needed]. Do NOT invent venue names, supplier names, contact details, prices, or specific action items.
Set ALL Status fields to "Not Started" or "TBC" — never infer completion from dates.
Quote fields containing commas.`;
    }

    return `## ARTEFACT: ${name}
Output ONLY a CSV. Header row (use exactly these columns):
${headerRow}
Then add data rows — ${dataInstructions}
RULES: comma-separated, quote any field containing a comma with double-quotes, NO markdown, NO extra text, NO explanatory notes — ONLY the header row followed immediately by data rows.`;
  }).join("\n\n");

  return `You are an AI Project Manager generating structured spreadsheet data for a project.

⚠️ ABSOLUTE RULE — READ BEFORE ANYTHING ELSE:
NEVER invent personal names (e.g. "John Doe", "Sarah Mitchell"). Use ROLE TITLES only (e.g. "Project Manager", "Executive Sponsor") or "TBC". NEVER invent company names, vendor names, contact details, or booking references. Use "TBC" for ANY fact not in the project description below.

⚠️ UNIVERSAL SOURCE-PREFIX RULE (applies to EVERY artefact you generate):
On EVERY row, the rationale-column MUST start with one of the prefixes below. Use the row's most narrative column — pick the first that exists in the artefact's header:
  Notes → Comments → Notes/Key Concerns → Mitigations → Mitigation Strategy → Description → Acceptance Criteria
This is non-negotiable — the UI parses the prefix to render the source badge and the "Why this number?" / "Why this row?" expansion.

  • "Research-anchored: <reasoning> (also considered: <alt1>, <alt2>)"
      Use when the value is drawn from feasibility/phase research in the
      knowledge base above. ALWAYS list 1–2 nearby alternatives the user
      could swap to so they can see the trade-offs without leaving the page.

  • "User-confirmed: <quoted answer>"
      Use when the value comes from a user_confirmed clarification answer.
      Quote the user's words.

  • "Default-template — TBC: <what's needed>"
      Use when neither research nor user input exists for this row.
      Name the specific gap so the user knows what to confirm to refine it.

  • "Research-thin — TBC: <what's missing>"
      Use when research was attempted but couldn't surface a concrete value
      (e.g. no quotes for a specific date / niche destination).

  • "Reserved — do not consume"
      Reserved-for-emergency lines (Contingency Reserve, Buffer, etc).

When research surfaces multiple options for a single row (e.g. three vendors,
three risk severity bands, three engagement strategies), apply this priority:
  a. User-confirmed wins absolutely.
  b. Otherwise pick the option that fits the project envelope (budget /
     timeline / risk appetite). Don't default to the cheapest or the most
     expensive without a reason.
  c. ALWAYS cite the chosen option AND 1–2 rejected alternatives.

TODAY'S DATE: ${today}

PROJECT: ${project.name}
DESCRIPTION: ${project.description || "No description provided"}
BUDGET: £${budgetStr}
TIMELINE: ${startDate} to ${endDate}
CATEGORY: ${category}
METHODOLOGY: ${methodologyName}
PHASE: ${phaseName}
${isTravel ? `\nTRAVEL PROJECT: Use travel-specific terminology. Real destination-specific tasks and risks.` : ""}
${isNigeria ? `DESTINATION: Nigeria / Lagos — include yellow fever requirements, malaria, NGN currency, FCO advisory, connectivity, safety.` : ""}

⚠️ CRITICAL — NO HALLUCINATION RULE ⚠️
NEVER invent or fabricate personal names (e.g. "James Hartley", "Sarah Mitchell", "David Okafor").
- For any person whose actual name is not known: use "TBD" in the Name column
- For owner/responsible columns: use the ROLE TITLE only (e.g. "Project Manager", "Finance Approver", "Executive Sponsor")
- Only use a real name if it appears explicitly in the project description above
- Roles and job titles ARE acceptable; invented full names are NOT
- Format unknown names as: TBD — [Role description] (e.g. "TBD — Dubai Partner", "TBD — Hotel Staff")

${knowledgeContext ? knowledgeContext : ""}Generate the following artefacts as CSV data. Each must be SPECIFIC to this project.
Start each with "## ARTEFACT: <name>" on its own line, then output the CSV immediately — no other text.

${artefactInstructions}`;
}

function buildArtefactPrompt(project: any, phaseName: string, artefactNames: string[], methodologyName: string, knowledgeContext = ""): string {
  const category = (project.category || "other").toLowerCase();
  const isTravel = category === "travel" || (project.name || "").toLowerCase().includes("trip") || (project.name || "").toLowerCase().includes("holiday");
  const isNigeria = (project.name || "").toLowerCase().includes("nigeria") || (project.name || "").toLowerCase().includes("lagos");

  const today = new Date().toLocaleDateString("en-GB");
  const startDt = project.startDate ? new Date(project.startDate) : null;
  const endDt = project.endDate ? new Date(project.endDate) : null;
  const daysRemaining = endDt ? Math.ceil((endDt.getTime() - Date.now()) / 86_400_000) : null;
  const totalDays = (startDt && endDt) ? Math.ceil((endDt.getTime() - startDt.getTime()) / 86_400_000) : null;
  const budget = (project.budget || 0).toLocaleString();

  const domainContext = isTravel
    ? `TRAVEL PROJECT: Frame ALL documents in travel PM terms — itinerary, bookings, logistics, visa/health requirements, safety planning, destination-specific risks. Do NOT use software development language.`
    : "";

  const destinationContext = isNigeria
    ? `DESTINATION — NIGERIA / LAGOS. Include these specifics in ALL relevant documents:
FCO Travel Advisory: currently advises high vigilance in Lagos.
Yellow Fever Vaccination Certificate: MANDATORY for entry.
Malaria prophylaxis: REQUIRED (Doxycycline or Malarone).
Currency: Nigerian Naira (NGN). Take mixed GBP cash + USD + cards.
Local transport: Bolt and Uber recommended. Safe areas: Victoria Island, Ikoyi, Lekki.
Emergency: British High Commission Lagos: +234 (0)1 277-0780`
    : "";

  const artefactSections = artefactNames.map(n => {
    const guidance = getArtefactGuidance(n, project, isTravel, isNigeria, today);
    return `## ARTEFACT: ${n}\n${guidance}`;
  }).join("\n\n");

  return `You are a senior AI Project Manager producing enterprise-grade project management documents.

⚠️ ABSOLUTE RULE — READ BEFORE ANYTHING ELSE:
NEVER invent personal names (e.g. "John Doe", "Sarah Mitchell"). Use ROLE TITLES only (e.g. "Project Manager", "Executive Sponsor"). NEVER invent company names, vendor names, contact details, booking references, venue names, or addresses. Use [TBC — description] for ANY fact not in the project description below. A document full of [TBC] markers is correct; a document with invented details is WRONG.

⚠️ MANDATORY APPENDIX — "Sources & Assumptions"
EVERY prose document you produce MUST end with a final section titled "Sources & Assumptions" (rendered as <h3>Sources & Assumptions</h3>) immediately before the closing "Items Awaiting Confirmation" section (if present).

The appendix is a <table> with these exact columns: Claim · Source · Reasoning · Alternatives Considered

Populate one row per significant claim, decision, or specific number used in the document above (e.g. budget figures, dates, supplier names, risk severities, recommended approach). For EACH row use one of these source labels in the Source column:

  • Research-anchored — drawn from feasibility/phase research in the knowledge base above. The Reasoning column should quote the relevant research finding. Alternatives Considered MUST list 1–2 nearby options the agent could have picked.
  • User-confirmed — comes from a user_confirmed clarification answer. Quote the user's words in the Reasoning column.
  • Default-template — a standard methodology default (e.g. PMI risk catalogue, percentage-of-budget skeleton). Reasoning explains why the default fits.
  • Research-thin — research was attempted but couldn't surface a concrete value. Reasoning names what's missing; Alternatives Considered is "—".
  • Reserved — reserved-for-emergency / contingency / buffer items.

This appendix is the prose-document equivalent of the Notes-column source prefix used in spreadsheet artefacts. The UI surfaces both so the user can audit the "why" behind every claim. Skipping the appendix or leaving the Reasoning/Alternatives columns blank is a failure.

TODAY: ${today} | PHASE: ${phaseName} | PROJECT: ${project.name}
METHODOLOGY: ${methodologyName} | BUDGET: £${budget}
DURATION: ${startDt ? startDt.toLocaleDateString("en-GB") : "TBD"} → ${endDt ? endDt.toLocaleDateString("en-GB") : "TBD"}${totalDays ? ` (${totalDays} days)` : ""}${daysRemaining !== null ? ` · ${daysRemaining} days remaining` : ""}
DESCRIPTION: ${project.description || "No description provided"}
${domainContext ? `\n${domainContext}` : ""}${destinationContext ? `\n${destinationContext}` : ""}

━━━ OUTPUT FORMAT — CRITICAL ━━━
You MUST output clean HTML only. Zero markdown. Zero exceptions.

REQUIRED HTML ELEMENTS:
• Headings: <h2> for document title, <h3> for major sections, <h4> for sub-sections
• Paragraphs: <p> for all body text
• Tables: <table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>
• Lists: <ul><li> for bullets, <ol><li> for numbered
• Bold labels: <strong>label:</strong> followed by text
• Status indicators: use text labels — ON TRACK / AT RISK / DELAYED (no emoji in tables)
• Horizontal rules: <hr> to separate major sections

DO NOT USE: # ## ### * ** __ - for bullets (use bullet char or <li>) | (pipe) for tables (use <table>)
Any asterisk, hash, or pipe character in prose output = FAILURE.

--- DOCUMENT STANDARDS ---
1. SPECIFIC — use "${project.name}", actual dates from the project, actual budget £${budget}
2. OWNED — every action, risk, and deliverable must have an owner; use ROLE TITLES only (e.g. "Project Manager", "Executive Sponsor") — NEVER invent personal names
3. CURRENT — as at ${today}; all items default to "Not Started" unless the project description explicitly states otherwise
4. HONEST — THIS IS THE MOST IMPORTANT RULE: use [TBC — <plain English description of what is needed>] for ANY specific fact not explicitly provided in the project description above OR in the Knowledge Base / Confirmed Facts above. BEFORE writing [TBC], scan the Knowledge Base AND any "USER-CONFIRMED FACTS" section for the same information under different wording (e.g. "visa processing time", "visa turnaround", "how long the visa takes" all refer to the same fact — if any is present, USE IT instead of [TBC]). It is BETTER to leave a field as [TBC] than to invent a plausible-sounding detail. Examples of facts that MUST be [TBC] if not in the description and not in the KB:
   • Venue names, addresses, room numbers, building names (e.g. "DIFC Gate District", "Marriott Al Jaddaf" — DO NOT invent these)
   • Specific meeting times, confirmation deadlines, action-by dates beyond the project end date
   • Supplier/vendor names, partner company names, contact persons, phone numbers
   • Confirmed prices, quotes, or costs beyond the overall budget figure
   • Policy reference numbers, booking references, confirmation numbers
   • Any "the host will confirm…" or "traveller to confirm by…" type statements — these are fabrications
5. PROFESSIONAL — British English (colour, organisation, prioritise, authorise)
6. Each document ends with an <h3>Agent Monitoring Protocol</h3> section
7. Each document ends with a second section: <h3>Items Awaiting Confirmation</h3> — a table listing every [TBC] item in the document, what information is needed, and who should confirm it. If there are no [TBC] items, write "None — all information confirmed."

⚠️ ANTI-HALLUCINATION RULES — NON-NEGOTIABLE:
1. Every specific detail you write must come directly from the project description above. If it is not in the description, write [TBC — <what is needed>]. Do NOT invent plausible details to make a document look complete. An incomplete document with honest [TBC] markers is FAR more valuable than a complete-looking document full of invented facts.
2. NEVER claim an action has been taken, is "in progress", "awaiting response", "submitted", "confirmed", or "booked" unless the project description explicitly says so. You are generating documents for the FIRST TIME — nothing has happened yet. All tasks must show status "Not Started" or "Planned". Writing "Flight upgrade request (waiting for airline response)" when no request was made is a CRITICAL hallucination.
3. NEVER fabricate progress. Kanban/board documents must show ALL items in "To Do" or "Planned" columns. NOTHING goes in "In Progress", "Waiting", or "Done" columns unless the project description explicitly confirms it happened.
4. You are a PLANNER, not a narrator. Describe what NEEDS to happen, not what supposedly already happened.
5. ⚠️ NEVER make DOMAIN/CONTEXT CLAIMS not supported by the Knowledge Base. This includes but is not limited to:
   • Weather / climate / seasonality statements ("May is ideal weather in X", "winter is peak season", "monsoon affects travel")
   • Peak/off-peak season claims, tourism trends, demand patterns
   • Market conditions, pricing trends, regulatory changes
   • Supplier reputation, availability, lead times
   • Cultural norms, local customs, language facts
   • Visa policies, embassy procedures, travel advisories
   If the Knowledge Base above does not explicitly contain a source for your claim, either OMIT the statement entirely or write "[RESEARCH REQUIRED: <topic>]" so it can be flagged for further research. DO NOT write plausible-sounding factual claims based on training data — your training data may be wrong or out of date. Use ONLY the research/facts provided above.
6. When citing a factual claim, reference the source: "According to the Knowledge Base research finding '<title>': <claim>". If you cannot cite a source, DO NOT make the claim.

━━━ DOCUMENT CONTROL HEADER (use this exact structure for every document) ━━━
<table>
  <thead><tr><th>Field</th><th>Detail</th></tr></thead>
  <tbody>
    <tr><td><strong>Document</strong></td><td>[Document Name]</td></tr>
    <tr><td><strong>Project</strong></td><td>${project.name}</td></tr>
    <tr><td><strong>Version</strong></td><td>1.0</td></tr>
    <tr><td><strong>Date</strong></td><td>${today}</td></tr>
    <tr><td><strong>Status</strong></td><td>DRAFT — Awaiting Approval</td></tr>
    <tr><td><strong>Owner</strong></td><td>[Role]</td></tr>
    <tr><td><strong>Methodology</strong></td><td>${methodologyName}</td></tr>
  </tbody>
</table>

${knowledgeContext ? knowledgeContext : ""}━━━ ARTEFACTS TO GENERATE ━━━
⚠️ The per-artefact guidance below uses markdown (# headings, | tables, **bold**)
for STRUCTURAL READABILITY ONLY. You MUST convert every markdown construct in
the guidance to its HTML equivalent in your output:
  • "## Section" → <h3>Section</h3>
  • "### Subsection" → <h4>Subsection</h4>
  • "| col | col |\\n|----|----|" tables → <table><thead>…</thead><tbody>…</tbody></table>
  • "**bold**" → <strong>bold</strong>
  • "- item" or "* item" → <ul><li>item</li></ul>
  • Do NOT echo the markdown guidance verbatim into a field value or paragraph.
${artefactSections}

━━━ SEPARATOR RULE ━━━
Start each artefact with exactly "## ARTEFACT: <name>" on its own line (this line only may use ##).
Everything inside the artefact body must be HTML. No preamble or commentary between artefacts.
Any #, ##, ###, *, **, or | character in the artefact BODY is a failure and the output will be rejected.`;
}

// cleanMarkdownLeakage lives in "@/lib/agents/markdown-cleanup" so it can be
// unit-tested in isolation (no Prisma client). Re-exported here for any
// callers that previously imported it from this module.
export { cleanMarkdownLeakage };

// ─── Per-artefact structural guidance ───

function getArtefactGuidance(name: string, project: any, isTravel: boolean, isNigeria: boolean, today: string): string {
  const n = name.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const startDate = project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "TBD";
  const endDate = project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "TBD";
  const budget = (project.budget || 0).toLocaleString();

  const agentProtocol = (docType: string) => `
## Agent Progress Tracking Protocol
This document is maintained as a **living artefact** by the AI agent. Updates occur when:
- Progress is reported via the project chat interface
- Scheduled review intervals are reached (see below)
- An exception or threshold breach is detected

**Update triggers for ${docType}:**
- Status fields updated immediately when progress is reported
- RAG (🟢/🟡/🔴) recalculated at each review
- Deviations beyond threshold trigger an Exception Report and escalation
- All changes logged with date and reason in the Document Control section`;

  // ── Project Brief ──
  if (n.includes("project brief")) {
    return `Generate a specific **Project Brief** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Project Brief |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft — Awaiting Sponsor Review |
| Owner | Project Manager |
| Next Review | [Phase Gate 1] |

## Project Overview
| Field | Detail |
|-------|--------|
| Project Name | ${project.name} |
| Sponsor | [Name / TBC] |
| Project Manager | AI Agent (supervised) |
| Start Date | ${startDate} |
| Target End Date | ${endDate} |
| Total Budget | £${budget} |
| Category | ${project.category || "General"} |
| Methodology | [methodology] |
| Current Phase | Pre-Project / Requirements |
| Overall Status | 🟢 Initiated |

## Purpose and Background
[Specific to ${project.name} — what is this project and why is it happening?]
${project.description ? `\n${project.description}` : ""}

## Objectives (SMART)
| # | Objective | Success Measure | Target Date | Owner | Status |
|---|-----------|----------------|-------------|-------|--------|
[3–5 SMART objectives specific to this project]

## Scope
**In Scope:**
[Bullet list — what IS included in this project, specific to ${project.name}]

**Out of Scope:**
[Explicit exclusions — what this project will NOT deliver]

## Key Deliverables
| # | Deliverable | Acceptance Criteria | Due Date | Owner | Status |
|---|-------------|-------------------|----------|-------|--------|
[All deliverables with specific, measurable acceptance criteria]

## Constraints
[Legal, time, budget £${budget}, resource, and other constraints specific to this project]

## Assumptions
[What we are assuming to be true for this project to succeed]

## Dependencies
[What this project depends on — internal and external]

## Key Stakeholders
| Name / Role | Interest | Influence | Engagement Required |
[Top 5 stakeholders — see Stakeholder Register for full list]

## Risks (Summary)
| Top Risk | Likelihood | Impact | Initial Mitigation |
[Top 3 risks — see Risk Register for full list]
${agentProtocol("Project Brief")}`;
  }

  // ── Outline Business Case ──
  if (n.includes("outline business case")) {
    return `Generate a concise **Outline Business Case** for ${project.name}. This is the LIGHTWEIGHT go/no-go document — maximum 2 pages. Do NOT expand it into a full Business Case.

## Document Control
| Field | Value |
|-------|-------|
| Document | Outline Business Case |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft — Awaiting Sponsor Approval |
| Decision Required | Go / No-Go to proceed to ${isTravel ? "full planning" : "Initiation phase"} |

## 1. Executive Summary
One paragraph: what the project is, why it is being pursued, and the recommendation.

## 2. Strategic Rationale
Why is this project worth doing? What problem or opportunity does it address?
${isTravel ? `\nFor this travel project: personal objectives, opportunity, timing rationale.` : ""}

## 3. Options Considered
| Option | Description | Estimated Cost | Key Benefit | Key Risk | Recommended? |
|--------|-------------|---------------|-------------|----------|-------------|
| Do Nothing | Status quo — do not proceed | £0 | None | Opportunity missed | ❌ No |
| Minimum Viable | [Scaled-down version] | £[lower] | [reduced benefit] | [higher risk] | [Y/N] |
| Full Scope (Recommended) | ${project.description || project.name} | £${budget} | [key benefit] | [key risk] | ✅ Yes |

## 4. Expected Benefits
[Bullet list of specific, measurable benefits — include £ value or quantified outcome where possible]

## 5. High-Level Cost Summary
| Category | Estimated Cost (£) | Notes |
|----------|--------------------|-------|
[Must total to approximately £${budget}]
| **TOTAL** | **£${budget}** | |

## 6. Top 3 Risks
| Risk | Likelihood | Impact | Initial Mitigation |
[Only the top 3 risks — full register developed in Phase 2]

## 7. Recommendation
**Decision: ✅ GO / ❌ NO-GO**
[One-sentence rationale. State conditions that must be met before proceeding.]

> ⚠️ Note: This is NOT the full Business Case. The full Business Case with NPV, ROI, and detailed analysis is produced in the next phase after this feasibility gate is approved.
${agentProtocol("Outline Business Case")}`;
  }

  // ── Requirements Specification ──
  if (n.includes("requirements specification") || n.includes("requirements spec")) {
    const travelCats = isTravel ? "Logistics, Documentation & Legal, Health & Safety, Accommodation, Activities & Itinerary, Financial, Contingency" : "Functional, Non-Functional, Data, Security, Performance, Compliance";
    const travelReqs = isNigeria ? `Must Have requirements to include:
- Return flights booked LHR ↔ LOS (or LHR ↔ ABV)
- Valid Nigerian visa obtained before departure
- Yellow fever vaccination certificate obtained (MANDATORY for entry)
- Malaria prophylaxis obtained and course started per GP advice
- Travel insurance secured — must include medical cover and repatriation
- Accommodation booked in safe area (Victoria Island, Ikoyi, or Lekki)
- Airport transfer arranged from MMIA
- FCDO TravelAware registration completed
- Emergency contacts briefed with full itinerary
- Local currency plan confirmed (NGN + GBP/USD cash + cards)` : "";
    return `Generate a **Requirements Specification** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Requirements Specification |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft |

## Purpose
Define all requirements that the project must satisfy in order to be considered successfully delivered.

## Functional Requirements
| Req ID | Category | Requirement | Priority (MoSCoW) | Source | Acceptance Criteria | Status |
|--------|----------|-------------|------------------|--------|-------------------|--------|
[Categories: ${travelCats}. Minimum 15 requirements. Use Must/Should/Could/Won't priorities.
${travelReqs}]

## Non-Functional Requirements
Quality, performance, safety, compliance, and reliability requirements specific to this project.

## Constraints and Assumptions
[What constraints apply? What assumptions have been made?]

## Requirements Traceability Matrix
| Req ID | Requirement Summary | Source | Linked Deliverable | Verification Method | Status |
|--------|-------------------|--------|-------------------|-------------------|--------|
${agentProtocol("Requirements Specification")}`;
  }

  // ── Feasibility Study ──
  if (n.includes("feasibility")) {
    return `Generate a **Feasibility Study** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Feasibility Study |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Conclusion | VIABLE / NOT VIABLE / VIABLE WITH CONDITIONS |

## Study Purpose
Assess whether ${project.name} is technically, financially, operationally, and schedule-feasible within the stated constraints (budget: £${budget}, timeline: ${startDate} → ${endDate}).

## Feasibility Summary
| Area | Verdict | Key Finding | Action Required |
|------|---------|-------------|----------------|
| Technical | 🟢/🟡/🔴 | [key finding] | [action] |
| Financial | 🟢/🟡/🔴 | [key finding] | [action] |
| Operational | 🟢/🟡/🔴 | [key finding] | [action] |
| Schedule | 🟢/🟡/🔴 | [key finding] | [action] |
| Risk | 🟢/🟡/🔴 | [key finding] | [action] |

## Technical Feasibility
[Is the project technically achievable? What capabilities, tools, and expertise are required? Are they available?]
${isTravel ? `\nFor this travel project: visa processing feasibility, flight availability, accommodation availability in safe areas, health requirements achievability within timeline.` : ""}

## Financial Feasibility
[Is the project affordable within £${budget}? High-level cost-benefit assessment.]

| Cost Category | Estimate | Confidence | Notes |
|---------------|---------|------------|-------|
[All costs must sum to ≤ £${budget}]

## Operational Feasibility
[Can this be delivered? Capacity, capability, timing considerations.]

## Schedule Feasibility
[Is the ${startDate} → ${endDate} timeline achievable? What are the schedule risks?]
${isTravel && isNigeria ? `\nNote: Nigerian visa processing typically takes 3-6 weeks. Yellow fever vaccination requires GP appointment + 10 days minimum. These are on the critical path.` : ""}

## Risk Feasibility
[Are the risks at an acceptable level? Summary of the top 5 risks and whether they can be adequately mitigated.]

## Conclusion
**VERDICT: VIABLE / NOT VIABLE / VIABLE WITH CONDITIONS**

[State clearly whether the project should proceed and any conditions that must be met first.]
${agentProtocol("Feasibility Study")}`;
  }

  // ── Project Charter ──
  if (n.includes("project charter") || n === "charter") {
    return `Generate a **Project Charter** for ${project.name}. This is the formal document that authorises the project and grants the Project Manager authority.

## Document Control
| Field | Value |
|-------|-------|
| Document | Project Charter |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | DRAFT — Awaiting Sponsor Signature |

## Project Authorisation
This charter formally authorises **${project.name}** and designates the AI Project Manager authority to apply project resources in accordance with this document.

| Field | Value |
|-------|-------|
| Project Name | ${project.name} |
| Project Sponsor | [Name — TBC] |
| Project Manager | AI Agent (supervised) |
| Authorisation Date | ${today} |
| Authorisation Status | DRAFT — Pending Sponsor Signature |
| Approved Budget | £${budget} |
| Start Date | ${startDate} |
| Target End Date | ${endDate} |

## Purpose and Justification
[Why is this project being initiated? What problem does it solve or opportunity does it capture?]

## Objectives (SMART)
| # | Objective | KPI | Target | Measurement |
|---|-----------|-----|--------|-------------|
[3–5 SMART objectives]

## High-Level Scope
**In Scope:** [specific deliverables and boundaries]
**Out of Scope:** [explicit exclusions]

## High-Level Milestone Plan
| Milestone | Target Date | Owner | Status |
|-----------|-------------|-------|--------|
[Key milestones between ${startDate} and ${endDate}]

## Approved Budget: £${budget}
| Category | Budget Allocation (£) | % of Total |
|----------|-----------------------|-----------|
[Budget breakdown by category]

## Top Risks
| Risk | Likelihood | Impact | Mitigation |
[Top 5 risks — full register in separate document]

## Project Organisation and Authority Levels
| Role | Name | Authority |
|------|------|-----------|
[Who can make what decisions]

## Approval and Signature
| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Sponsor | [Name] | _______________ | ________ |
| Project Manager | AI Agent | [Digital auth] | ${today} |
${agentProtocol("Project Charter")}`;
  }

  // ── Business Case (full) ──
  if (n.includes("business case") && !n.includes("outline")) {
    return `Generate a **full Business Case** for ${project.name}. This is the detailed document produced AFTER feasibility is confirmed. It must justify the investment of £${budget}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Business Case |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft — Awaiting Approval |

## Executive Summary
[One page — what the project is, why it is recommended, key financial metrics, risk level, and decision required]

## Strategic Context
[Why this project is necessary and how it aligns with strategic or personal goals]

## Options Analysis
| Option | Description | Total Cost | NPV/Value | Key Benefit | Key Risk | Recommended? |
|--------|-------------|-----------|---------|-------------|----------|-------------|
| 0 — Do Nothing | No action taken | £0 | [negative] | None | Opportunity lost | ❌ |
| 1 — Minimum | [Scaled-down version] | £[lower] | [value] | [benefit] | [risk] | Consider |
| 2 — Full Scope (Recommended) | ${project.description || project.name} | £${budget} | [value] | [main benefit] | [main risk] | ✅ |

## Financial Analysis
| Cost Category | Planned (£) | Actual (£) | Variance (£) | Notes |
[Detailed cost breakdown totalling £${budget}]

| Benefit | How Measured | Year 1 Value | Total Value |
[Quantify all benefits where possible]

**Financial Summary:**
- Total Investment: £${budget}
- Expected Return / Value: [£ or qualitative]
- Payback Period: [months/years]
- ROI / Benefit-Cost Ratio: [ratio]

## Non-Financial Benefits
[Qualitative benefits and how each will be measured or evidenced]

## Sensitivity Analysis
[What assumptions is this business case most sensitive to? What if key costs are 20% higher?]

## Risks and Assumptions
[Top 5 risks; full register in separate document]

## Recommendation
**RECOMMENDATION: ✅ PROCEED with Option 2 — Full Scope**
[Conditions, approvals required, and next steps]
${agentProtocol("Business Case")}`;
  }

  // ── Stakeholder Register ──
  if (n.includes("stakeholder register") || n.includes("initial stakeholder")) {
    const stakeholderTypes = isTravel
      ? "traveller, travel agent/booking platform, airline(s), accommodation provider(s), host contact in destination, emergency contact(s) at home, travel insurance provider, relevant high commission or embassy, health/vaccination provider, tour operators or activity providers"
      : "project sponsor, project manager, delivery team(s), end users/clients, IT/infrastructure, procurement, finance, external suppliers/vendors, regulatory/compliance bodies";
    return `Generate a **Stakeholder Register** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Stakeholder Register |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Total Stakeholders | [count] |

## Analysis Summary
| Quadrant | Stakeholders | Key Engagement Risk |
|----------|-------------|-------------------|
| Manage Closely (High Power, High Interest) | [names] | [risk] |
| Keep Satisfied (High Power, Low Interest) | [names] | [risk] |
| Keep Informed (Low Power, High Interest) | [names] | [risk] |
| Monitor (Low Power, Low Interest) | [names] | [risk] |

## Stakeholder Register
| ID | Name / Role | Organisation | Stake | Power | Interest | Current Engagement | Target Engagement | Channel | Frequency | Owner | Concerns |
|----|------------|-------------|-------|-------|---------|-------------------|------------------|---------|-----------|-------|---------|
[Identify ALL relevant stakeholders for this project. Types include: ${stakeholderTypes}]

## Engagement Strategies
For each "Manage Closely" stakeholder: specific 2–3 sentence engagement approach with named owner.

## Communication Schedule
| Stakeholder | Information Required | By When | Channel | Owner | Status |
${agentProtocol("Stakeholder Register")}`;
  }

  // ── Communication Plan ──
  if (n.includes("communication plan") || n.includes("communications plan")) {
    return `Generate a **Communication Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Communication Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Communication Objectives
[What the communication plan aims to achieve for ${project.name}]

## Communication Matrix
| # | Audience | Information / Message | Purpose | Channel | Format | Frequency | Owner | Timing |
|---|---------|----------------------|---------|---------|--------|-----------|-------|--------|
[Be specific: who gets what, when, how, from whom. Cover all stakeholders.]

## Escalation Path
| Trigger / Situation | Escalate To | Timeframe | Method | Expected Outcome |
|---------------------|------------|-----------|--------|----------------|
[Define what triggers escalation and to whom]

## Communication Calendar
| Date / Period | Event | Audience | Channel | Owner | Status |
[Map out the full communication schedule from ${startDate} to ${endDate}]

## Agent Communication Responsibilities
The AI agent will:
- Send scheduled status updates per the matrix above
- Generate and distribute Exception Reports when thresholds are breached
- Log all communications in the project activity feed
- Flag overdue communications for human follow-up
- Update stakeholder engagement status when responses are received
${agentProtocol("Communication Plan")}`;
  }

  // ── Risk Management Plan ──
  if (n.includes("risk management plan")) {
    return `Generate a **Risk Management Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Risk Management Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Risk Management Approach
Describe the methodology, tools, and processes for identifying, assessing, and managing risks on ${project.name}.

## Risk Appetite Statement
[What level of risk is acceptable for this project? Define specific thresholds.]

## Risk Categories
| Category | Description | Examples for This Project |
[List all applicable risk categories with project-specific examples]

## Probability and Impact Scales
| Score | Probability | Meaning | Impact | Meaning |
|-------|------------|---------|--------|---------|
| 1 | Very Low | <10% chance | Very Low | Negligible effect |
| 2 | Low | 10-30% | Low | Minor disruption |
| 3 | Medium | 30-50% | Medium | Significant disruption |
| 4 | High | 50-70% | High | Major impact on time/cost/quality |
| 5 | Very High | >70% | Very High | Project failure / safety risk |

## Risk Response Strategies
| Strategy | When to Use | Example for This Project |
|----------|------------|--------------------------|
| Avoid | Eliminate root cause | [example] |
| Transfer | Shift to third party | [example] |
| Mitigate | Reduce probability or impact | [example] |
| Accept | Tolerate residual risk | [example] |

## Risk Thresholds and Escalation
| Score | Rating | Required Action | Approver | Timeframe |
|-------|--------|----------------|----------|-----------|
| 1–5 | LOW | Monitor | PM | Monthly review |
| 6–10 | MEDIUM | Active mitigation | PM | Bi-weekly review |
| 11–19 | HIGH | Escalate + mitigation plan | Sponsor | Weekly review |
| 20–25 | CRITICAL | Immediate escalation | Sponsor + Board | Immediate |

## Review Schedule
| Review Type | Trigger / Frequency | Participants | Output |
[Define when risks are reviewed]

## Roles and Responsibilities
| Role | Risk Management Responsibility |
[PM, sponsor, risk owners, team members]
${agentProtocol("Risk Management Plan")}`;
  }

  // ── Quality Plan / Quality Management Plan ──
  if (n.includes("quality")) {
    return `Generate a **Quality Management Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Quality Management Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Quality Objectives
[Specific, measurable quality targets for ${project.name}]

## Quality Standards
[What standards must be met — regulatory, client, internal, industry-specific]

## Quality Assurance Activities
| Activity | Purpose | When | Owner | Method | Status |
|----------|---------|------|-------|--------|--------|
[Proactive activities to ensure quality is built in]

## Quality Control Activities
| Deliverable | Acceptance Criteria | Review Method | Reviewer | Sign-Off Required | Scheduled Date |
|-------------|-------------------|---------------|----------|-------------------|---------------|
[For every key deliverable — what does "good" look like and how is it verified]

## Defect / Issue Management
[How issues are identified, logged, prioritised, resolved, and closed]

## Quality Metrics
| Metric | Target | Current Value | Status | Measurement Method | Review Frequency |
${agentProtocol("Quality Management Plan")}`;
  }

  // ── Resource Plan / Resource Management Plan ──
  if (n.includes("resource plan") || n.includes("resource management")) {
    return `Generate a **Resource Management Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Resource Management Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Resource Summary
| Resource Type | Total Required | Available | Gap | Mitigation |
[Summary of all resource requirements]

## Resource Requirements
| Role | Name / TBD | Skills Required | Allocation % | Start Date | End Date | Source | Cost (£/day) | Status |
|------|-----------|----------------|-------------|------------|----------|--------|-------------|--------|
[All resources needed to deliver ${project.name}]

## RACI Matrix
| Deliverable / Task | [Role 1] | [Role 2] | [Role 3] | [Role 4] | Notes |
[R=Responsible, A=Accountable, C=Consulted, I=Informed. Cover all key deliverables.]

## Resource Calendar
| Resource | ${startDate} | [+1 week] | [+2 weeks] | ... | Notes |
[Show availability and allocation across the project timeline]

## Procurement Requirements
[Any external resources, services, or contractors that must be procured]

## Resource Risks
| Risk | Affected Resource | Mitigation | Contingency |
${agentProtocol("Resource Management Plan")}`;
  }

  // ── Change Control Plan ──
  if (n.includes("change control")) {
    return `Generate a **Change Control Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Change Control Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Purpose
[Why change control is necessary and how it protects ${project.name}'s baseline]

## Change Request Process
Step-by-step process from identification to implementation:
1. [Step 1 — Identify and document]
2. [Step 2 — Impact assessment]
3. [Step 3 — Submission to authority]
4. [Step 4 — Decision: Approve / Reject / Defer]
5. [Step 5 — Update baselines if approved]
6. [Step 6 — Communicate and implement]

## Change Authority Levels
| Change Type | Estimated Impact | Authority Level | Approver | Decision Timeframe |
|-------------|----------------|----------------|----------|-------------------|
| Minor | ≤5% time or cost | PM | Project Manager | 2 business days |
| Moderate | 5-15% time or cost | Sponsor | Project Sponsor | 5 business days |
| Major | >15% or scope change | Board | Project Board | 10 business days |
| Emergency | Safety/critical | Sponsor | Sponsor immediate | Same day |

## Change Log
| CR ID | Date | Requestor | Description | Impact | Decision | Approver | Date Closed | Status |
[Start with empty log — to be populated as changes arise]

## Agent Role in Change Control
The AI agent automatically raises change requests when:
- Schedule variance exceeds 10% of remaining duration
- Cost variance exceeds 10% of remaining budget
- A new scope requirement is identified in chat
- A risk score increases above HIGH threshold
All automatic CRs require human review before implementation.
${agentProtocol("Change Control Plan")}`;
  }

  // ── Design Document (travel-specific becomes Detailed Trip Plan) ──
  if (n.includes("design document") || n === "design doc") {
    if (isTravel) {
      return `Generate a **Detailed Trip Plan** for ${project.name}. For this travel project the "Design Document" is the master planning document covering the full itinerary, logistics, and operational design.

## Document Control
| Field | Value |
|-------|-------|
| Document | Detailed Trip Plan |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft — Planning in Progress |

## Trip Overview
| Field | Detail |
[Destination, dates, duration, purpose, total budget £${budget}, traveller(s)]

## Day-by-Day Itinerary
| Day | Date | Morning | Afternoon | Evening | Accommodation | Meals | Transport | Notes |
[Cover every day from ${startDate} to ${endDate}. Be specific — named venues, activities, logistics.]

## Logistics Plan
| Component | Details | Provider | Cost (£) | Booked? | Confirmation # |
| Outbound flight | [details] | [airline] | [cost] | ❌ No | — |
| Return flight | [details] | [airline] | [cost] | ❌ No | — |
| Accommodation | [hotel name, area] | [provider] | [cost/night] | ❌ No | — |
| Airport transfer | [MMIA → hotel] | [provider] | [cost] | ❌ No | — |
${isNigeria ? `| Local SIM card | Airtel or MTN — purchase on arrival at airport | Local telco | £10–15 | ❌ No | — |\n| Yellow fever cert | GP appointment required | GP/Travel clinic | £[cost] | ❌ No | — |` : ""}

## Budget Allocation by Day
| Date | Accommodation (£) | Meals (£) | Transport (£) | Activities (£) | Misc (£) | Daily Total (£) |
[Cover each day. Total must equal £${budget}]

## Health & Safety Plan
${isNigeria ? `| Requirement | Details | Status | Deadline |\n|-------------|---------|--------|----------|\n| Yellow fever vaccination | Mandatory for entry — no exceptions | ❌ Not done | ASAP — book GP |\n| Malaria prophylaxis | GP prescription required — Doxycycline or Malarone | ❌ Not done | 6 weeks before travel |\n| Travel insurance | Medical + repatriation cover essential | ❌ Not done | Before booking |\n| FCDO TravelAware registration | Register trip for emergency support | ❌ Not done | Before departure |\n| Emergency contacts | British High Commission Lagos: +234 (0)1 277-0780 | ✅ Noted | — |` : "[Health and safety requirements specific to destination]"}

## Communication Design
How the traveller stays connected and maintains emergency communications.
${agentProtocol("Detailed Trip Plan")}`;
    }
    return `Generate a **Design Document** for ${project.name}.

## Document Control
| Version | 1.0 DRAFT | Date | ${today} | Status | Draft |

## Solution Overview
[High-level description of the proposed solution or approach for ${project.name}]

## Design Decisions
| Decision Area | Options Considered | Selected Approach | Rationale | Owner | Date |
[Key design decisions with full rationale]

## Detailed Specifications
[Detailed specifications for each component or deliverable — specific to this project]

## Interface and Integration Design
[How components interact; dependencies on external systems or services]

## Constraints and Assumptions
[Design constraints and critical assumptions]
${agentProtocol("Design Document")}`;
  }

  // ── Work Breakdown Structure ──
  if (n.includes("work breakdown") || n === "wbs") {
    return `Generate a **Work Breakdown Structure** for ${project.name}.

## Document Control
| Version | 1.0 DRAFT | Date | ${today} | Status | Draft |

## WBS Summary
Total deliverables: [count] | Work packages: [count] | Project: ${project.name}

## WBS Hierarchy
| WBS Code | Deliverable / Work Package | Parent | Description | Owner | Est. Duration | Planned Start | Planned End | Dependencies | % Complete | Status |
|----------|--------------------------|--------|-------------|-------|--------------|--------------|-------------|-------------|-----------|--------|
| 1.0 | ${project.name} | — | Total project | PM | [total] | ${startDate} | ${endDate} | — | 0% | Not Started |
[Decompose to Level 3 or 4. Each Level 3 package should be 1–2 weeks of effort or a discrete deliverable.]

## Work Package Descriptions
For each Level 2 deliverable:
### [1.1 — Name]
- Description:
- Key deliverables:
- Acceptance criteria:
- Owner:
- Estimated cost: £
- Estimated duration:
- Dependencies:
${agentProtocol("Work Breakdown Structure")}`;
  }

  // ── Status Reports ──
  if (n.includes("status report")) {
    return `Generate an initial **Status Report** template for ${project.name}, pre-populated for the current state as at ${today}.

## Status Report #1 — ${today}
**Project:** ${project.name} | **Phase:** [Current Phase] | **Reporting Period:** [dates]

## Overall Status
| Dimension | Status | Trend | Notes |
|-----------|--------|-------|-------|
| Schedule | 🟢 On Track | → | [comment] |
| Budget | 🟢 On Track | → | Committed: £0 of £${budget} |
| Quality | 🟢 On Track | → | No quality issues identified |
| Risks | 🟡 Monitoring | → | [X] open risks, [Y] high/critical |
| Stakeholders | 🟢 Engaged | → | Key stakeholders briefed |

## Progress This Period
[What was accomplished since last report — specific tasks completed]

## Planned Next Period
[What is planned for the next reporting period — specific tasks and milestones]

## Issues and Exceptions
| Issue ID | Description | Impact | Owner | Resolution | Due Date |
[Any current issues requiring action]

## Risks (Top 3 This Period)
| Risk | Score | Status | Action |

## Decisions Required
| Decision | Owner | Deadline |
[Any decisions needed from sponsor/stakeholders]

## Budget Summary
| Budget | Committed | Actual Spent | Forecast EAC | Variance |
| £${budget} | £0 | £0 | £${budget} | £0 |
${agentProtocol("Status Reports")}`;
  }

  // ── Acceptance Certificate ──
  if (n.includes("acceptance certificate")) {
    return `Generate an **Acceptance Certificate** for ${project.name}.

## Project Acceptance Certificate
| Field | Value |
|-------|-------|
| Project | ${project.name} |
| Date of Acceptance | [TBC — to be completed at project close] |
| Project Manager | AI Agent (supervised) |
| Sponsor | [Name — TBC] |

## Deliverables Accepted
| # | Deliverable | Acceptance Criteria | Met? | Reviewer | Date | Notes |
[List all key deliverables and whether each acceptance criterion was met]

## Outstanding Items
[Any items not yet fully accepted — punch list with owners and deadlines]

## Sign-Off
I confirm that the deliverables listed above have been reviewed and meet the agreed acceptance criteria.

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Sponsor | [Name] | _______________ | ________ |
| Project Manager | AI Agent | [Digital] | ________ |
${agentProtocol("Acceptance Certificate")}`;
  }

  // ── End Project Report ──
  if (n.includes("end project report") || n.includes("end of project")) {
    return `Generate an **End Project Report** for ${project.name} (to be completed at close).

## End Project Report
**Project:** ${project.name} | **Date:** [Close Date] | **Status:** [Closed]

## Performance Against Baseline
| Dimension | Baseline | Actual | Variance | Assessment |
|-----------|---------|--------|---------|------------|
| Schedule | ${startDate} → ${endDate} | [actual dates] | [+/- days] | 🟢/🟡/🔴 |
| Budget | £${budget} | £[actual] | £[variance] | 🟢/🟡/🔴 |
| Scope | [baseline scope] | [delivered] | [changes] | 🟢/🟡/🔴 |
| Quality | [targets] | [achieved] | [gaps] | 🟢/🟡/🔴 |

## Benefits Realised
[Did the project deliver its expected benefits? Evidence?]

## Lessons Learned Summary
[Top 5 lessons — see full Lessons Learned document]

## Outstanding Risks/Issues
[Any residual risks or issues transferred to BAU/operations]

## Formal Closure
**Project ${project.name} is formally closed.** All deliverables accepted, lessons captured, resources released.
${agentProtocol("End Project Report")}`;
  }

  // ── Lessons Learned ──
  if (n.includes("lessons learned") || n.includes("lessons learnt")) {
    return `Generate a **Lessons Learned** document for ${project.name}.

## Lessons Learned Register
**Project:** ${project.name} | **Date:** ${today} | **Phase:** [All phases]

## What Went Well
| # | Area | What Worked | Recommendation for Future |
|---|------|-------------|--------------------------|
[Specific successes — what should be repeated on future projects?]

## What Could Be Improved
| # | Area | What Didn't Work | Root Cause | Recommendation |
|---|------|-----------------|------------|----------------|
[Honest reflection — what should be done differently?]

## Key Lessons by Phase
| Phase | Lesson | Recommendation | Priority |
[One or two key lessons from each phase of the project]

## Recommendations for Next Project
[Top 5 actionable recommendations for future projects of this type]
${agentProtocol("Lessons Learned")}`;
  }

  // ── Closure Report ──
  if (n.includes("closure report")) {
    return `Generate a **Closure Report** for ${project.name}.

## Project Closure Report
**Project:** ${project.name} | **Closure Date:** [TBC] | **Status:** CLOSED

## Project Summary
[Brief description of what was delivered and the overall outcome]

## Closure Confirmation Checklist
| Item | Status | Owner | Notes |
|------|--------|-------|-------|
| All deliverables formally accepted | ✅/❌ | PM | |
| Acceptance Certificate signed | ✅/❌ | Sponsor | |
| All contracts and POs closed | ✅/❌ | PM | |
| Resources released | ✅/❌ | PM | |
| Financial accounts closed | ✅/❌ | Finance | |
| All artefacts archived | ✅/❌ | PM | |
| Lessons Learned completed | ✅/❌ | PM | |
| Benefits handover arranged | ✅/❌ | Sponsor | |

## Financial Summary
| Budget | Actual Spend | Variance | % Under/Over |
| £${budget} | £[actual] | £[var] | [%] |

## Benefits Handover
[Who is responsible for realising ongoing benefits? How will they be tracked?]

## Formal Closure Statement
Project ${project.name} is hereby formally closed. All obligations have been met.

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Sponsor | [Name] | _______________ | ________ |
${agentProtocol("Closure Report")}`;
  }

  // ── Default for any other artefact ──
  return `Generate a complete, professional **${name}** for ${project.name}.

## Document Control
| Document | ${name} | Project | ${project.name} | Version | 1.0 DRAFT | Date | ${today} | Status | Draft |

## Required Content
This document must:
1. Be SPECIFIC to ${project.name} — actual dates between ${startDate} and ${endDate}, budget £${budget}, named stakeholders and owners
2. Include tables with Status (🟢/🟡/🔴 or Not Started/In Progress/Complete) wherever tasks, risks, or actions are listed
3. Assign a named owner or responsible role to every action, deliverable, or decision
4. Include a "Current Status as at ${today}" summary section
5. Use British English throughout

## Purpose and Scope
[What this document covers and why it is needed for ${project.name}]

## Main Content
[Produce the full, substantive content appropriate for a ${name}. Use tables, headings, and bullet points throughout.]

## Summary and Next Actions
| Action | Owner | Due Date | Status |
[Concrete next actions arising from this document]
${agentProtocol(name)}`;
}

// ─── TBC Extraction + Clarification Message ──────────────────────────────────

/**
 * Extracts every [TBC — ...] item from generated artefact content.
 * Works on both HTML and CSV content.
 * Returns deduplicated list of { artefactName, item } pairs.
 */
export function extractTBCItems(artefacts: { name: string; content: string }[]): { artefactName: string; item: string }[] {
  const results: { artefactName: string; item: string }[] = [];
  const seen = new Set<string>();

  // Match [TBC — ...] or [TBC - ...] or TBC — ... in a table cell
  const tbcPattern = /\[?TBC\s*[—–-]\s*([^\]<\n,]{5,120})\]?/gi;

  for (const { name, content } of artefacts) {
    let match: RegExpExecArray | null;
    tbcPattern.lastIndex = 0;
    while ((match = tbcPattern.exec(content)) !== null) {
      const item = match[1].trim().replace(/\s+/g, " ");
      const key = `${name}::${item.toLowerCase()}`;
      if (!seen.has(key) && item.length > 4) {
        seen.add(key);
        results.push({ artefactName: name, item });
      }
    }
  }

  return results;
}

/**
 * Scan Claude's freshly-generated artefact content for [TBC — …] markers and,
 * for each one whose topic is already covered in the KB (user_confirmed first,
 * then HIGH_TRUST research), replace it inline before the artefact is saved.
 * This stops the TBC → clarification → re-ask loop ever starting for facts the
 * agent already knew. Returns the (possibly mutated) content + count.
 */
export async function autoResolveTBCsInContent(
  agentId: string,
  projectId: string,
  content: string,
): Promise<{ content: string; autoFilled: number }> {
  const tbcPattern = /\[?TBC\s*[—–-]\s*([^\]<\n,]{5,120})\]?/gi;
  const topics = new Set<string>();
  let m: RegExpExecArray | null;
  tbcPattern.lastIndex = 0;
  while ((m = tbcPattern.exec(content)) !== null) {
    const topic = m[1].trim().replace(/\s+/g, " ");
    if (topic.length > 4) topics.add(topic);
  }
  if (topics.size === 0) return { content, autoFilled: 0 };

  let next = content;
  let autoFilled = 0;
  for (const topic of topics) {
    const value = await resolveTBCFromKB(agentId, projectId, topic);
    if (value) {
      const res = replaceTBCInContent(next, topic, value);
      if (res.changed) { next = res.content; autoFilled++; }
    }
  }
  return { content: next, autoFilled };
}

/**
 * Try to resolve a TBC topic from existing HIGH_TRUST / user_confirmed KB items.
 * Keyword-based match: if ≥60% of the topic's meaningful tokens appear in a
 * single KB item's title+content, that item is the answer. Stopwords ignored.
 *
 * Fixes the bug where Claude re-emits [TBC — visa turnaround] after the user
 * already answered "visa processing time": different wording, same topic.
 */
async function resolveTBCFromKB(
  agentId: string,
  projectId: string,
  topic: string,
): Promise<string | null> {
  const STOP = new Set([
    "the","a","an","of","for","to","and","is","are","what","when","how","where",
    "which","who","whom","why","current","about","as","on","in","at","by","or",
  ]);
  const tokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t));
  if (tokens.length === 0) return null;
  const threshold = Math.max(1, Math.ceil(tokens.length * 0.6));

  // 1. Prefer user_confirmed facts (highest authority)
  const confirmed = await db.knowledgeBaseItem.findMany({
    where: { agentId, projectId, tags: { has: "user_confirmed" } },
    select: { title: true, content: true },
    take: 100,
  }).catch(() => []);

  let best: { value: string; score: number } | null = null;
  for (const item of confirmed) {
    const hay = `${item.title} ${item.content}`.toLowerCase();
    const hits = tokens.filter(t => hay.includes(t)).length;
    if (hits >= threshold && (!best || hits > best.score)) {
      const cleaned = item.content.replace(/^\[User confirmed[^\]]*\]\s*/i, "").trim();
      best = { value: cleaned, score: hits };
    }
  }
  if (best) return best.value;

  // 2. Fall back to HIGH_TRUST research facts (stricter threshold to avoid noise)
  const research = await db.knowledgeBaseItem.findMany({
    where: { projectId, trustLevel: "HIGH_TRUST" },
    select: { title: true, content: true },
    take: 200,
  }).catch(() => []);
  const stricter = Math.max(2, Math.ceil(tokens.length * 0.75));
  for (const item of research) {
    const hay = `${item.title} ${item.content}`.toLowerCase();
    const hits = tokens.filter(t => hay.includes(t)).length;
    if (hits >= stricter && (!best || hits > best.score)) {
      best = { value: item.content.trim().slice(0, 400), score: hits };
    }
  }
  return best?.value ?? null;
}

/**
 * Replace every [TBC — <topic>] (and plain TBC variants) for a given topic in
 * the artefact's stored content with the resolved value. Returns true if the
 * content was mutated so the caller knows to persist.
 */
function replaceTBCInContent(content: string, topic: string, value: string): { content: string; changed: boolean } {
  // Build a pattern that matches the specific topic phrase inside any [TBC — …] marker.
  const escTopic = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[?TBC\\s*[—–-]\\s*${escTopic}[^\\]\\n]*\\]?`, "gi");
  const next = content.replace(re, value.replace(/\n+/g, " ").slice(0, 200));
  return { content: next, changed: next !== content };
}

/**
 * Creates a clarification session from [TBC] items found in generated artefacts.
 * BEFORE asking, tries to resolve each TBC from the KB (user_confirmed facts
 * first, then HIGH_TRUST research). Only unresolved TBCs become questions.
 * Resolved TBCs are patched directly into the artefact content.
 */
export async function createClarificationMessage(
  agentId: string,
  projectId: string,
  orgId: string,
  tbcItems: { artefactName: string; item: string }[],
): Promise<void> {
  if (tbcItems.length === 0) return;

  // Don't start a new session if one is already active
  try {
    const { getActiveSession, startTBCClarificationSession, phraseTBCQuestions } = await import("@/lib/agents/clarification-session");
    const existing = await getActiveSession(agentId, projectId);
    if (existing) return; // Session already active — don't stack

    // ── Phase 1: try to auto-resolve each TBC from the KB ──
    const unresolved: { artefactName: string; item: string }[] = [];
    const resolvedByArtefact = new Map<string, { item: string; value: string }[]>();

    for (const tbc of tbcItems) {
      const value = await resolveTBCFromKB(agentId, projectId, tbc.item);
      if (value) {
        const list = resolvedByArtefact.get(tbc.artefactName) ?? [];
        list.push({ item: tbc.item, value });
        resolvedByArtefact.set(tbc.artefactName, list);
      } else {
        unresolved.push(tbc);
      }
    }

    // Patch each artefact whose TBCs we could resolve
    let autoFilled = 0;
    if (resolvedByArtefact.size > 0) {
      const artefacts = await db.agentArtefact.findMany({
        where: {
          projectId, agentId,
          name: { in: Array.from(resolvedByArtefact.keys()) },
        },
        select: { id: true, name: true, content: true },
      });
      for (const art of artefacts) {
        const replacements = resolvedByArtefact.get(art.name) ?? [];
        let content = art.content;
        let changed = false;
        for (const { item, value } of replacements) {
          const res = replaceTBCInContent(content, item, value);
          if (res.changed) { content = res.content; changed = true; autoFilled++; }
        }
        if (changed) {
          await db.agentArtefact.update({
            where: { id: art.id },
            data: { content, updatedAt: new Date() },
          }).catch(() => {});
        }
      }
    }

    // If EVERYTHING was auto-resolved, skip the session entirely
    if (unresolved.length === 0) {
      if (autoFilled > 0) {
        await db.chatMessage.create({
          data: {
            agentId,
            role: "agent",
            content: `Filled **${autoFilled}** [TBC] item${autoFilled !== 1 ? "s" : ""} automatically from your earlier answers and research. Your artefacts are ready for review.`,
          },
        }).catch(() => {});
      }
      return;
    }

    // ── Phase 2: ask only for the genuinely missing items ──
    // Send the unresolved TBC topics through the LLM phrasing pass so each
    // question gets the right interrogative (Who/When/How many/Has) and the
    // right widget type (text/date/number/yesno/choice). Falls back to a
    // deterministic heuristic on any LLM failure — caller never sees a
    // regression to the old `What is the X?` template.
    const projectForPrompt = await db.project.findUnique({
      where: { id: projectId },
      select: { name: true, description: true },
    }).catch(() => null);
    // Cap at 20 questions per session so the user isn't asked 50+ in one
    // sitting. The remainder stays as [TBC] markers in the artefacts and
    // can be filled later from the Artefacts tab. The intro message
    // ALWAYS reports the count actually being asked — not unresolved.length
    // — so the user doesn't see "33 details" with only 20 questions
    // queued.
    const QUESTION_CAP = 20;
    const cappedUnresolved = unresolved.slice(0, QUESTION_CAP);
    const questions = await phraseTBCQuestions(projectForPrompt, cappedUnresolved);

    await startTBCClarificationSession(agentId, projectId, orgId, questions);

    const askedCount = questions.length;
    const remainingNote = unresolved.length > askedCount
      ? ` (${unresolved.length - askedCount} more remain as [TBC] markers in the artefacts — you can fill those directly on the Artefacts tab.)`
      : "";
    const autoFillNote = autoFilled > 0
      ? ` (I also filled ${autoFilled} from your earlier answers / research.)`
      : "";

    // Brief intro message
    await db.chatMessage.create({
      data: {
        agentId,
        role: "agent",
        content: `Your artefacts are ready for review, but I have **${askedCount} detail${askedCount !== 1 ? "s" : ""}** I couldn't find from research or your earlier answers.${autoFillNote} I'll ask you about each one now — your answers will update the documents automatically.${remainingNote}`,
      },
    }).catch(() => {});
  } catch (e) {
    console.error("[createClarificationMessage] failed to start TBC session:", e);

    // Fallback: just log the count
    await db.chatMessage.create({
      data: {
        agentId,
        role: "agent",
        content: `Your artefacts are ready for review. ${tbcItems.length} item${tbcItems.length !== 1 ? "s are" : " is"} marked [TBC] — you can edit these directly on the Artefacts tab.`,
      },
    }).catch(() => {});
  }

  // Activity log + notification
  await db.agentActivity.create({
    data: {
      agentId,
      type: "chat",
      summary: `${tbcItems.length} [TBC] item${tbcItems.length !== 1 ? "s" : ""} — clarification questions posted`,
      metadata: { tbcCount: tbcItems.length } as any,
    },
  }).catch(() => {});

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
          title: `Agent needs your input — ${tbcItems.length} item${tbcItems.length !== 1 ? "s" : ""} to confirm`,
          body: `Answer the questions in Chat with Agent to fill in [TBC] details.`,
          actionUrl: `/agents/chat?agent=${agentId}`,
          metadata: { agentId, alertType: "clarification_needed", tbcCount: tbcItems.length } as any,
        },
      }).catch(() => {});
    }
  } catch {}
}
