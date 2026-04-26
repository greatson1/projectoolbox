import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createJob } from "@/lib/agents/job-queue";
import { nudgeJobProcessor } from "@/lib/agents/agent-backend";

export const dynamic = "force-dynamic";

// POST /api/approvals/[id] — Approve, reject, or defer
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { action, comment } = body; // action: "approve" | "reject" | "defer" | "request_changes"

  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const statusMap: Record<string, string> = {
    approve: "APPROVED",
    reject: "REJECTED",
    defer: "DEFERRED",
    request_changes: "DEFERRED",
  };

  const newStatus = statusMap[action];
  if (!newStatus) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  // Stamp resolver identity into impact JSON (audit trail)
  const existingImpact = (approval.impact as any) || {};
  const resolverName = session.user?.name || session.user?.email || "Unknown";
  const resolverId = (session.user as any)?.id || null;

  const updated = await db.approval.update({
    where: { id },
    data: {
      status: newStatus as any,
      comment,
      resolvedAt: action !== "defer" ? new Date() : undefined,
      impact: {
        ...existingImpact,
        resolvedByName: resolverName,
        resolvedById: resolverId,
        resolvedVia: "ui",
      } as any,
      assignedToId: resolverId || undefined,
    },
  });

  // Update linked agent decision if exists
  if (approval.requestedById) {
    await db.agentDecision.updateMany({
      where: { approvalId: id },
      data: { status: newStatus as any },
    });
  }

  // ── Sentiment extraction on comment (non-blocking) ──
  const sessionOrgId = (session.user as any).orgId;
  if (comment && comment.trim().length > 3 && sessionOrgId) {
    import("@/lib/sentiment/recorder").then(({ recordSentiment }) => {
      recordSentiment({
        orgId: sessionOrgId,
        text: comment,
        subjectType: "approval",
        subjectId: id,
        context: `approval ${action} comment for "${approval.title}"`,
      }).catch(() => {});
    }).catch(() => {});
  }

  // ── Rejection/Changes workflow: notify agent and trigger revision ──
  if ((action === "reject" || action === "request_changes") && approval.requestedById) {
    try {
      const agentId = approval.requestedById;
      const feedback = comment || "No specific feedback provided";

      // Post feedback to agent chat so it knows what to fix
      await db.chatMessage.create({
        data: {
          agentId,
          role: "agent",
          content: `**${action === "reject" ? "Approval Rejected" : "Changes Requested"}** for: ${approval.title}\n\n**Your feedback:** ${feedback}\n\n${action === "request_changes" ? "I will revise the affected artefacts based on your feedback and resubmit for approval." : "This request has been rejected. I will adjust my approach based on your feedback."}`,
        },
      }).catch(() => {});

      // Log activity
      await db.agentActivity.create({
        data: {
          agentId,
          type: "approval",
          summary: `${action === "reject" ? "Rejected" : "Changes requested"}: ${approval.title}. Feedback: ${feedback.slice(0, 80)}`,
        },
      }).catch(() => {});

      // For PHASE_GATE rejections: re-open artefacts as DRAFT so agent can revise
      if (approval.type === "PHASE_GATE" && approval.projectId) {
        const deployment = await db.agentDeployment.findFirst({
          where: { agentId, isActive: true },
          select: { id: true, currentPhase: true },
        });
        if (deployment?.currentPhase) {
          // Re-open current phase artefacts for revision
          await db.agentArtefact.updateMany({
            where: {
              projectId: approval.projectId,
              agentId,
              phaseId: deployment.currentPhase,
              status: "APPROVED",
            },
            data: { status: "DRAFT", feedback: `Revision needed: ${feedback}` },
          });

          // Set deployment back to active (not pending_approval)
          await db.agentDeployment.update({
            where: { id: deployment.id },
            data: { phaseStatus: "active" },
          });

          // Increment iteration count for resubmission tracking
          await db.approval.update({
            where: { id },
            data: { iteration: (approval.iteration || 1) + 1 },
          });
        }
      }
    } catch (e) {
      console.error("[approval] rejection workflow failed:", e);
    }
  }

  // Create audit log
  const orgId = (session.user as any).orgId;
  if (orgId) {
    await db.auditLog.create({
      data: {
        orgId,
        userId: session.user.id,
        action: `approval_${action}`,
        target: approval.title,
        details: { approvalId: id, comment },
      },
    });
  }

  // Track approval decision in KB
  if (approval.projectId && (newStatus === "APPROVED" || newStatus === "REJECTED")) {
    import("@/lib/agents/kb-event-tracker").then(({ trackApprovalDecision, trackPhaseGateDecision }) => {
      const approverName = session.user?.name || session.user?.email || "User";
      trackApprovalDecision(approval.projectId!, approval.title, newStatus as "APPROVED" | "REJECTED", approverName, comment).catch(() => {});
      if (approval.type === "PHASE_GATE") {
        trackPhaseGateDecision(approval.projectId!, approval.title, null, newStatus as "APPROVED" | "REJECTED", approverName).catch(() => {});
      }
    }).catch(() => {});
  }

  // Find active deployment for this project
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId: approval.projectId, isActive: true },
  });

  if (deployment) {
    if (action === "approve") {
      // Unblock the deployment phase
      await db.agentDeployment.update({
        where: { id: deployment.id },
        data: { phaseStatus: "active" },
      });

      // ── PHASE_GATE: check 3-layer completion before advancing ──
      // Artefacts + PM Tasks + Delivery Tasks must all meet thresholds.
      if (approval.type === "PHASE_GATE" && deployment.projectId) {
        try {
          const project = await db.project.findUnique({ where: { id: deployment.projectId } });
          if (project) {
            const { getNextPhase } = await import("@/lib/agents/methodology-playbooks");
            const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
            const { getPhaseCompletion } = await import("@/lib/agents/phase-completion");

            const methodologyId = (project.methodology || "traditional").toLowerCase().replace("agile_", "");
            const currentPhase = deployment.currentPhase;
            const nextPhase = currentPhase ? getNextPhase(methodologyId, currentPhase) : null;

            // ── 3-layer completion check ──
            if (currentPhase) {
              const completion = await getPhaseCompletion(
                deployment.projectId,
                currentPhase,
                deployment.agentId,
              );

              if (!completion.canAdvance) {
                // Gate is APPROVED but advancement is BLOCKED
                await db.agentActivity.create({
                  data: {
                    agentId: deployment.agentId,
                    type: "approval",
                    summary: `⛔ Phase gate approved but advancement blocked:\n${completion.blockers.map(b => `• ${b}`).join("\n")}\n\nComplete the outstanding items before the phase can advance.`,
                    metadata: { completion } as any,
                  },
                });
                await db.agentDeployment.update({
                  where: { id: deployment.id },
                  data: { phaseStatus: "blocked_tasks_incomplete" },
                });
                return NextResponse.json({
                  data: updated,
                  blocked: true,
                  completion,
                  message: `Phase gate approved but advancement blocked: ${completion.blockers.join("; ")}`,
                });
              }
            }

            if (nextPhase) {

              // 1. Advance the phase in DB
              await db.agentDeployment.update({
                where: { id: deployment.id },
                data: {
                  currentPhase: nextPhase,
                  phaseStatus: "active",
                  lastCycleAt: new Date(),
                  nextCycleAt: new Date(Date.now() + 2 * 60_000), // re-cycle in 2 min
                },
              });

              // 2. Mark old phase as COMPLETED, new phase as ACTIVE
              await db.phase.updateMany({
                where: { projectId: deployment.projectId, name: currentPhase ?? undefined },
                data: { status: "COMPLETED" },
              });
              await db.phase.updateMany({
                where: { projectId: deployment.projectId, name: nextPhase },
                data: { status: "ACTIVE" },
              });

              // 3. Log the phase transition
              await db.agentActivity.create({
                data: {
                  agentId: deployment.agentId,
                  type: "approval",
                  summary: `Phase gate approved: "${currentPhase}" → "${nextPhase}". Running phase research before generating artefacts...`,
                },
              });

              // 3b. Scaffold the new phase's PM + delivery tasks. Without
              // this, the next phase's "Delivery Tasks" pipeline step shows
              // "No tasks scaffolded" and the 3-layer phase-completion check
              // has nothing to count, leaving the user unable to satisfy the
              // gate on the new phase. onPhaseAdvanced also marks any
              // leftover scaffolded tasks from the previous phase as DONE.
              try {
                const { onPhaseAdvanced } = await import("@/lib/agents/task-scaffolding");
                await onPhaseAdvanced(deployment.agentId, deployment.projectId, currentPhase ?? "", nextPhase);
              } catch (e) {
                console.error("[approval] task scaffolding for next phase failed:", e);
              }

              // 4. Run phase-specific research, then generate artefacts (fire & forget)
              (async () => {
                // 4a. Phase research — capture latest context before generating docs
                try {
                  await db.agentDeployment.update({
                    where: { id: deployment.id },
                    data: { phaseStatus: "researching" },
                  });

                  const { runPhaseResearch } = await import("@/lib/agents/feasibility-research");
                  const research = await runPhaseResearch(
                    deployment.agentId,
                    deployment.projectId!,
                    orgId,
                    nextPhase,
                  );

                  if (research.factsDiscovered > 0) {
                    await db.chatMessage.create({
                      data: {
                        agentId: deployment.agentId,
                        role: "agent",
                        content: "__RESEARCH_FINDINGS__",
                        metadata: {
                          type: "research_findings",
                          projectName: project.name,
                          factsCount: research.factsDiscovered,
                          sections: research.sections,
                          facts: research.facts,
                          phase: nextPhase,
                        } as any,
                      },
                    }).catch(() => {});
                  }
                } catch (e) {
                  console.error(`[phase-advance] Phase research failed for ${nextPhase}:`, e);
                }

                // 4b. Clarification — ask user phase-specific questions based on research + KB gaps
                try {
                  const nextPhaseRow = await db.phase.findFirst({
                    where: { projectId: deployment.projectId!, name: nextPhase },
                    select: { artefacts: true },
                  });
                  const artefactNames = Array.isArray(nextPhaseRow?.artefacts) ? (nextPhaseRow.artefacts as string[]) : [];
                  if (artefactNames.length > 0) {
                    await db.agentDeployment.update({
                      where: { id: deployment.id },
                      data: { phaseStatus: "awaiting_clarification" },
                    });
                    const { startClarificationSession } = await import("@/lib/agents/clarification-session");
                    await startClarificationSession(
                      deployment.agentId,
                      deployment.projectId!,
                      orgId,
                      artefactNames,
                    );
                    // Clarification session will post questions in chat.
                    // When user answers all questions, the session handler triggers generation.
                    // So we return here — don't generate artefacts yet.
                    return;
                  }
                } catch (e) {
                  console.error(`[phase-advance] Clarification for ${nextPhase} failed:`, e);
                }

                // 4c. Generate artefacts with enriched KB (if no clarification needed)
                await db.agentDeployment.update({
                  where: { id: deployment.id },
                  data: { phaseStatus: "active" },
                }).catch(() => {});

                const result = await generatePhaseArtefacts(deployment.agentId, deployment.projectId!, nextPhase);
                if (result.generated > 0) {
                  // 5. Create the next phase gate approval
                  const orgOwner = await db.user.findFirst({
                    where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
                    select: { id: true },
                  });
                  await db.approval.create({
                    data: {
                      projectId: deployment.projectId!,
                      requestedById: orgOwner?.id || (session.user as any).id,
                      title: `${nextPhase} Gate: Review and approve to advance`,
                      description: `The agent has completed the ${nextPhase} phase and generated ${result.generated} artefact(s). Review them and approve to advance to the next phase.`,
                      type: "PHASE_GATE",
                      status: "PENDING",
                      impact: { level: "MEDIUM", description: "Phase gate approval" },
                    },
                  });
                  await db.agentActivity.create({
                    data: {
                      agentId: deployment.agentId,
                      type: "approval",
                      summary: `${nextPhase} gate approval requested — ${result.generated} artefact(s) ready for review`,
                    },
                  });
                  await db.agentDeployment.update({
                    where: { id: deployment.id },
                    data: { phaseStatus: "waiting_approval" },
                  });
                }
              })()
                .catch((e) => console.error(`[phase-advance] artefact generation failed:`, e));
            } else {
              // No next phase — project complete!
              await db.agentActivity.create({
                data: {
                  agentId: deployment.agentId,
                  type: "approval",
                  summary: `Final phase gate approved: "${currentPhase}". Project lifecycle complete 🎉`,
                },
              });
              await db.agentDeployment.update({
                where: { id: deployment.id },
                data: { phaseStatus: "complete", isActive: false },
              });
            }
          }
        } catch (e) {
          console.error("[approval] PHASE_GATE advance failed:", e);
        }
      } else {
        // Non-phase-gate approval: execute the approved action inline
        try {
          const { executeApprovedAction } = await import("@/lib/agents/action-executor");
          await executeApprovedAction(id);
        } catch (e) {
          console.error("Inline execution after approval failed:", e);
        }

        // Apply change proposal updates (task progress, dates, status)
        if (approval.type === "CHANGE_REQUEST" && approval.affectedItems) {
          try {
            const { applyApprovedChanges } = await import("@/lib/agents/change-proposals");
            const result = await applyApprovedChanges(id);
            console.log(`[approval] Applied ${result.applied} change(s) from proposal ${id}`);
          } catch (e) {
            console.error("[approval] Change proposal application failed:", e);
          }
        }

        // Execute phase reversion if this is a PHASE_REVERSION approval
        const impactData = approval.impact as any;
        if (impactData?.type === "PHASE_REVERSION") {
          try {
            const { executePhaseReversion } = await import("@/app/api/projects/[projectId]/phases/revert/route");
            await executePhaseReversion(id);
            console.log(`[approval] Phase reversion executed for ${id}`);
          } catch (e) {
            console.error("[approval] Phase reversion failed:", e);
          }
        }
      }
    }

    if (action === "request_changes" && comment) {
      // Check iteration limit (max 3)
      if ((approval.iteration || 1) >= 3) {
        await db.approval.update({ where: { id }, data: { status: "REJECTED" as any } });
      }
    }

    // Also create VPS job as backup
    await createJob({
      agentId: deployment.agentId,
      deploymentId: deployment.id,
      type: "approval_resume",
      priority: 2,
      payload: { approvalId: id, action, comment, approvalType: approval.type },
    });
    nudgeJobProcessor().catch(() => {});
  }

  return NextResponse.json({ data: updated });
}
