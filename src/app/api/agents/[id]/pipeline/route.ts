import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface PipelineStep {
  id: string;
  label: string;
  status: "done" | "running" | "failed" | "skipped" | "waiting";
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  error?: string;
  details?: string;
  canRetry?: boolean;
  cycles?: boolean; // true if this step repeats per phase
}

// Pipeline steps are built inline per request.
// Deploy is one-time; all other steps have cycles:true and repeat per phase.

// GET /api/agents/:id/pipeline — Pipeline state for agent deployment
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;

  // Fetch the active deployment with project and agent
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    include: { project: true, agent: true },
    orderBy: { deployedAt: "desc" },
  });

  if (!deployment) {
    return NextResponse.json(
      { error: "No active deployment found for this agent" },
      { status: 404 }
    );
  }

  const projectId = deployment.projectId;
  const currentPhase = deployment.currentPhase;
  let phaseStatus = deployment.phaseStatus || "active";

  // Parallel queries for all related data
  const [artefacts, kbItems, approvals, activities, phases, chatMessages] =
    await Promise.all([
      db.agentArtefact.findMany({
        where: { agentId, projectId },
        orderBy: { createdAt: "desc" },
      }),
      db.knowledgeBaseItem.findMany({
        where: { agentId, projectId },
        orderBy: { createdAt: "desc" },
      }),
      db.approval.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      }),
      db.agentActivity.findMany({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.phase.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      }),
      db.chatMessage.findMany({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

  const firstPhase = phases.length > 0 ? phases[0] : null;
  const now = Date.now();

  // Filter artefacts for current phase. AgentArtefact.phaseId is inconsistent
  // (sometimes the phase row CUID, sometimes the phase name string, sometimes
  // null with the phase recorded in metadata). Fall through several signals
  // before giving up — the Generate Artefacts / Review & Approve steps depend
  // on this to know what the agent has done.
  const currentPhaseObj = phases.find((p) => p.name === currentPhase);
  const currentPhaseLCEarly = (currentPhase || "").toLowerCase();
  const currentPhaseArtefacts = currentPhaseObj
    ? artefacts.filter((a) => {
        if (a.phaseId && a.phaseId === currentPhaseObj.id) return true;
        if (a.phaseId && a.phaseId === currentPhase) return true; // some rows store the name
        const meta = (a as any).metadata as Record<string, unknown> | null;
        if (meta && typeof meta.phase === "string" && meta.phase.toLowerCase() === currentPhaseLCEarly) return true;
        // Last-resort: artefact with no phase tag at all but the deployment is on
        // its first phase OR the artefact name contains the phase keyword.
        if (!a.phaseId && currentPhaseObj.order === 0) return true;
        if (!a.phaseId && a.name?.toLowerCase().includes(currentPhaseLCEarly)) return true;
        return false;
      })
    : artefacts;

  // Research KB items — scope to CURRENT phase only (not ALL research ever)
  // Matches items tagged with:
  //   - "phase_research" (from runPhaseResearch)
  //   - current phase name lowercased (tagged by phase research + feasibility extraction)
  // Feasibility research from deployment day is also valid for the first phase only.
  const currentPhaseLC = (currentPhase || "").toLowerCase();
  const isFirstPhase = currentPhaseObj?.order === 0 || !currentPhase;
  const researchItems = kbItems.filter((item) => {
    const tags = item.tags.map((t) => t.toLowerCase());
    // Phase-specific research always counts
    if (tags.includes("phase_research") && tags.includes(currentPhaseLC)) return true;
    // Current-phase-tagged facts (from phase-specific research extraction)
    if (tags.includes(currentPhaseLC)) return true;
    // Initial feasibility research only counts for the FIRST phase
    if (isFirstPhase && tags.includes("feasibility")) return true;
    return false;
  });

  // Clarification — use explicit message metadata ONLY (no substring matching).
  // Also check for active ClarificationSession in KB to detect live Q&A flow.
  const clarificationMessages = chatMessages.filter((msg) => {
    const meta = msg.metadata as Record<string, unknown> | null;
    return meta?.type === "clarification_question" || meta?.type === "agent_question";
  });
  const clarificationAnswers = chatMessages.filter((msg) => {
    const meta = msg.metadata as Record<string, unknown> | null;
    return meta?.type === "clarification_answer" || meta?.type === "agent_question_answered";
  });
  // The interactive clarification flow doesn't write a chat message per answer
  // (answers go straight to the KB). Detect completion via the
  // "__CLARIFICATION_COMPLETE__" message + any KB items tagged "user_answer".
  const clarificationCompletes = chatMessages.filter((msg) => {
    const meta = msg.metadata as Record<string, unknown> | null;
    return meta?.type === "clarification_complete";
  });
  const clarificationKBAnswers = kbItems.filter((item) =>
    (item.tags || []).some((t) => t.toLowerCase() === "user_answer" || t.toLowerCase() === "user_confirmed"),
  );
  // Active clarification session lives in KB as __clarification_session__
  const activeClarificationSession = kbItems.find(
    (k) => k.title === "__clarification_session__" && (k.tags || []).includes("active")
  );

  // ── Self-heal stale phaseStatus ─────────────────────────────────────
  // If phaseStatus is "researching" but research is already complete
  // (facts exist in KB), advance it to awaiting_clarification so the UI
  // reflects the actual state. Fixes legacy deployments where the
  // post-research update didn't fire.
  if (phaseStatus === "researching" && researchItems.length > 0) {
    const newStatus = activeClarificationSession ? "awaiting_clarification" : "active";
    await db.agentDeployment.update({
      where: { id: deployment.id },
      data: { phaseStatus: newStatus },
    }).catch(() => {});
    phaseStatus = newStatus;
  }

  // Mirror self-heal for clarification: if phaseStatus is "awaiting_clarification"
  // but no active session exists in the KB, the user has either finished answering
  // or the session was abandoned — flip to "active" so the bottom banner stops
  // saying "Questions waiting" when there are none. Source-of-truth: the active
  // session entry in KB, NOT the deployment column.
  if (phaseStatus === "awaiting_clarification" && !activeClarificationSession) {
    await db.agentDeployment.update({
      where: { id: deployment.id },
      data: { phaseStatus: "active" },
    }).catch(() => {});
    phaseStatus = "active";
  }

  // Phase gate approvals for current phase
  let phaseGateApprovals = approvals.filter(
    (a) => a.type === "PHASE_GATE"
  );

  // ── Cancel stale PENDING gates for phases the project has already moved past ──
  // After phase advance, the OLD phase's gate row sometimes lingers as
  // PENDING (e.g. the user approved it but the status update raced with the
  // phase advance, or the gate was raised after the user had already moved
  // on). The Approvals page would then show "Requirements Gate" as pending
  // even though the project is now on Design. Auto-resolve any PENDING
  // PHASE_GATE whose phase name doesn't match currentPhase — silently mark
  // them APPROVED with a note so they drop out of the pending queue.
  if (currentPhase) {
    const currentPhaseLC = currentPhase.toLowerCase();
    const stalePending = phaseGateApprovals.filter((a) => {
      if (a.status !== "PENDING") return false;
      const t = (a.title || "").toLowerCase();
      return !t.startsWith(`${currentPhaseLC} gate`) && !t.startsWith(`${currentPhaseLC}:`);
    });
    if (stalePending.length > 0) {
      await db.approval.updateMany({
        where: { id: { in: stalePending.map((a) => a.id) } },
        data: {
          status: "APPROVED",
          resolvedAt: new Date(),
          comment: "Auto-resolved — project has already advanced past this phase.",
        },
      }).catch(() => {});
      phaseGateApprovals = phaseGateApprovals.map((a) =>
        stalePending.some((s) => s.id === a.id)
          ? { ...a, status: "APPROVED", resolvedAt: new Date(), comment: "Auto-resolved — project has already advanced past this phase." }
          : a,
      );
    }
  }

  // ── Auto-raise a phase gate when one is genuinely needed ───────────────
  // If the 3-layer phase completion check says canAdvance === true but no
  // PENDING PHASE_GATE exists for this phase, raise one now. Without this,
  // a project that's "ready to advance" can sit forever with the user
  // looking at an empty Approvals queue and no way to actually advance.
  if (currentPhase && deployment.projectId) {
    try {
      const pendingGateForPhase = phaseGateApprovals.find((a) => {
        const t = (a.title || "").toLowerCase();
        return a.status === "PENDING" && (t.startsWith(`${currentPhase.toLowerCase()} gate`) || t.startsWith(`${currentPhase.toLowerCase()}:`));
      });
      // Always run completion check — we use it both for auto-gate AND for
      // self-healing the "blocked_tasks_incomplete" status that can stick
      // around after PM tasks are completed (or after a deadlock fix).
      const { getPhaseCompletion } = await import("@/lib/agents/phase-completion");
      const completion = await getPhaseCompletion(deployment.projectId, currentPhase, agentId);

      // Self-heal stale BLOCKED status: phaseStatus may still be
      // "blocked_tasks_incomplete" from an earlier check even though the
      // 3-layer completion now passes. Clear it so the BLOCKED badge and
      // "Tasks blocking advance" banner stop showing.
      if (phaseStatus === "blocked_tasks_incomplete" && completion.canAdvance) {
        await db.agentDeployment.update({
          where: { id: deployment.id },
          data: { phaseStatus: pendingGateForPhase ? "waiting_approval" : "active" },
        }).catch(() => {});
        phaseStatus = pendingGateForPhase ? "waiting_approval" : "active";
      }

      if (!pendingGateForPhase) {
        if (completion.canAdvance) {
          // Pick a sensible requestedById — the org owner (creates pre-deploy
          // by the system are otherwise rejected on FK).
          const owner = await db.user.findFirst({
            where: { orgId: deployment.agent.orgId, role: { in: ["OWNER", "ADMIN"] } },
            select: { id: true },
          });
          if (owner) {
            const created = await db.approval.create({
              data: {
                projectId: deployment.projectId,
                requestedById: owner.id,
                title: `${currentPhase} Gate: Review and approve to advance`,
                description: `${currentPhase} phase is complete (${completion.overall}%). Approve to advance to the next phase.`,
                type: "PHASE_GATE",
                status: "PENDING",
                impact: { level: "MEDIUM", description: "Phase gate approval" } as any,
              },
            }).catch(() => null);
            if (created) {
              phaseGateApprovals = [created as any, ...phaseGateApprovals];
              await db.agentActivity.create({
                data: {
                  agentId,
                  type: "approval",
                  summary: `${currentPhase} gate raised — ready for review (${completion.overall}% complete)`,
                },
              }).catch(() => {});
            }
          }
        }
      }
    } catch (e) {
      console.error("[pipeline] auto-raise phase gate failed:", e);
    }
  }
  // Find the CURRENT phase's gate — use exact prefix match on title ("{phase} Gate:")
  // and always prefer the most recently created to handle resubmission cycles.
  const currentPhaseGate = (() => {
    if (!currentPhase) return undefined;
    const phaseLC = currentPhase.toLowerCase();
    const matches = phaseGateApprovals
      .filter((a) => {
        const title = (a.title || "").toLowerCase();
        // Expected format: "{PhaseName} Gate: ..." or "{PhaseName} gate: ..."
        return title.startsWith(`${phaseLC} gate`) || title.startsWith(`${phaseLC}:`);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // Latest matching gate (handles resubmission — previous REJECTED gates are ignored)
    return matches[0];
  })();

  // Deployment timestamps
  const deployedAt = deployment.deployedAt.toISOString();
  const lastUpdate = deployment.lastCycleAt || deployment.deployedAt;
  const minutesSinceUpdate = (now - lastUpdate.getTime()) / 60_000;

  // --- Build steps ---
  const steps: PipelineStep[] = [];

  // Phase-scoped label prefix — "Phase N:" to show this cycle belongs to a phase
  const phaseLabel = currentPhase ? `${currentPhase}: ` : "";

  // 1. Deploy — one-time, always done if deployment exists
  steps.push({
    id: "deploy",
    label: "Deploy Agent",
    status: "done",
    startedAt: deployedAt,
    completedAt: deployedAt,
    duration: 0,
    details: `Deployed to ${deployment.project.name}`,
  });

  // 2. Research
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    let error: string | undefined;
    let canRetry = false;
    const researchActivity = activities.find((a) => a.type === "research");
    const startedAt = researchActivity?.createdAt?.toISOString();

    if (researchItems.length > 0) {
      status = "done";
      details = `${researchItems.length} fact${researchItems.length !== 1 ? "s" : ""} discovered`;
    } else if (
      phaseStatus === "researching" &&
      minutesSinceUpdate > 60
    ) {
      status = "failed";
      error = "Research timed out — no KB items found after 1 hour";
      canRetry = true;
    } else if (phaseStatus === "researching") {
      status = "running";
      details = "Researching feasibility...";
    } else if (!process.env.PERPLEXITY_API_KEY) {
      status = "skipped";
      details = "No Perplexity API key configured";
    }

    steps.push({
      id: "research",
      label: `${phaseLabel}Research`,
      cycles: true,
      status,
      startedAt,
      completedAt: status === "done" && researchItems.length > 0
        ? researchItems[0].createdAt.toISOString()
        : undefined,
      duration:
        status === "done" && startedAt && researchItems.length > 0
          ? researchItems[0].createdAt.getTime() - new Date(startedAt).getTime()
          : undefined,
      details,
      error,
      canRetry,
    });
  }

  // 2b. Research approval — surfaces the gate between research output and
  // clarification. The user must approve (or reject) every research-finding
  // bundle before clarification can begin and artefact generation can run.
  // Sourced from the project's pending CHANGE_REQUEST approvals where
  // impact.subtype === "research_finding".
  {
    const researchApprovals = approvals.filter((a: any) => {
      const subtype = (a.impact as any)?.subtype;
      return a.type === "CHANGE_REQUEST" && subtype === "research_finding";
    });
    const pendingCount = researchApprovals.filter((a: any) => a.status === "PENDING").length;
    const approvedCount = researchApprovals.filter((a: any) => a.status === "APPROVED").length;
    const rejectedCount = researchApprovals.filter((a: any) => a.status === "REJECTED").length;
    const totalCount = researchApprovals.length;

    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    if (totalCount === 0) {
      // Either research hasn't run yet, or it found nothing to gate.
      // Mirror the research step's state — if research is done with zero
      // bundles, treat this gate as not applicable.
      const researchStep = steps[steps.length - 1];
      if (researchStep?.id === "research" && researchStep.status === "done") {
        status = "skipped";
        details = "No research findings required approval";
      } else {
        status = "waiting";
      }
    } else if (pendingCount > 0) {
      status = "running";
      details = `${pendingCount} bundle${pendingCount === 1 ? "" : "s"} awaiting your review · ${approvedCount} approved · ${rejectedCount} rejected`;
    } else {
      status = "done";
      details = approvedCount > 0
        ? `${approvedCount} bundle${approvedCount === 1 ? "" : "s"} approved${rejectedCount > 0 ? ` · ${rejectedCount} rejected` : ""}`
        : "All research bundles resolved";
    }

    steps.push({
      id: "research_approval",
      label: `${phaseLabel}Research Approval`,
      cycles: true,
      status,
      details,
    });
  }

  // 3. Clarify — uses real session state + message metadata
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    const clarifyActivity = activities.find(
      (a) => a.type === "clarification" || a.type === "clarification_question"
    );
    const startedAt = clarifyActivity?.createdAt?.toISOString();

    // Parse active session to get exact question/answer counts
    let sessionQuestions = 0;
    let sessionAnswered = 0;
    if (activeClarificationSession?.content) {
      try {
        const session = JSON.parse(activeClarificationSession.content);
        const qs = Array.isArray(session.questions) ? session.questions : [];
        sessionQuestions = qs.length;
        sessionAnswered = qs.filter((q: any) => q.answered || q.answer).length;
      } catch {}
    }

    if (activeClarificationSession && sessionQuestions > 0) {
      // Live session — report real progress
      if (sessionAnswered >= sessionQuestions) {
        status = "done";
        details = `All ${sessionQuestions} question${sessionQuestions !== 1 ? "s" : ""} answered`;
      } else {
        status = "running";
        details = `${sessionAnswered}/${sessionQuestions} answered · ${sessionQuestions - sessionAnswered} pending`;
      }
    } else if (clarificationCompletes.length > 0) {
      // The interactive flow posts __CLARIFICATION_COMPLETE__ when a session
      // finishes. Treat it as authoritative — answers live in the KB, not in
      // chatMessages, so the clarificationAnswers chat filter would miss this.
      status = "done";
      const lastComplete = clarificationCompletes[0];
      const meta = lastComplete?.metadata as Record<string, unknown> | null;
      const total = Number(meta?.totalCount) || clarificationKBAnswers.length;
      details = total > 0
        ? `All ${total} question${total !== 1 ? "s" : ""} answered`
        : "Clarification complete";
    } else if (clarificationAnswers.length > 0 || clarificationKBAnswers.length > 0) {
      // Either chat-message answers (legacy) OR KB-stored answers (current flow)
      // are enough to call the step done.
      status = "done";
      const count = Math.max(clarificationAnswers.length, clarificationKBAnswers.length);
      details = `${count} answer${count !== 1 ? "s" : ""} captured`;
    } else if (phaseStatus === "awaiting_clarification") {
      status = "running";
      details = clarificationMessages.length > 0
        ? `${clarificationMessages.length} question${clarificationMessages.length !== 1 ? "s" : ""} pending`
        : "Clarification session starting...";
    } else if (
      clarificationMessages.length === 0 &&
      (currentPhaseArtefacts.length > 0 || phaseStatus === "active")
    ) {
      // Agent skipped clarification and moved on
      status = "skipped";
      details = "No clarification needed";
    }

    steps.push({
      id: "clarify",
      label: `${phaseLabel}Clarification`,
      cycles: true,
      status,
      startedAt,
      completedAt:
        status === "done" && clarificationAnswers.length > 0
          ? clarificationAnswers[0].createdAt.toISOString()
          : undefined,
      details,
    });
  }

  // 4. Generate
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    let error: string | undefined;
    let canRetry = false;
    const genActivity = activities.find(
      (a) => a.type === "artefact_generation" || a.type === "generate"
    );
    const startedAt = genActivity?.createdAt?.toISOString();

    // Find the expected artefact count from the phase record
    const expectedArtefacts = Array.isArray(currentPhaseObj?.artefacts)
      ? (currentPhaseObj!.artefacts as string[]).length
      : 0;
    const generatedCount = currentPhaseArtefacts.length;
    // Don't render confusing "7/6" when an extra artefact was created on top
    // of the template. If the agent over-delivers, show the absolute count
    // with a hint that more than the template were produced.
    const expectedVsGenerated = expectedArtefacts > 0
      ? generatedCount > expectedArtefacts
        ? `${generatedCount} (target ${expectedArtefacts})`
        : `${generatedCount}/${expectedArtefacts}`
      : String(generatedCount);

    // Smarter stall detection:
    // - Use the most recent artefact's createdAt to detect activity (not just lastCycleAt)
    // - Scale timeout with expected batch size (3 min per artefact, min 10 min, max 60 min)
    const timeoutMins = Math.max(10, Math.min(60, expectedArtefacts * 3));
    const lastArtefactAt = currentPhaseArtefacts[0]?.createdAt
      ? new Date(currentPhaseArtefacts[0].createdAt).getTime()
      : deployment.lastCycleAt?.getTime() || deployment.deployedAt.getTime();
    const minutesSinceLastArtefact = (now - lastArtefactAt) / 60_000;

    if (expectedArtefacts > 0 && generatedCount >= expectedArtefacts) {
      // All expected artefacts generated. We still call this step "done" — its
      // job is generation, not approval — but spell out that approval is the
      // next step so the user doesn't read this single green tick as "phase
      // complete". The Review & Approve step holds the real next action.
      const approvedSoFar = currentPhaseArtefacts.filter((a) => a.status === "APPROVED").length;
      status = "done";
      details = approvedSoFar < generatedCount
        ? `${expectedVsGenerated} generated — ${approvedSoFar}/${generatedCount} approved on the next step`
        : `${expectedVsGenerated} artefacts generated`;
    } else if (generatedCount > 0 && phaseStatus === "active") {
      // Partially generated — still running if recent activity, else stalled
      if (minutesSinceLastArtefact <= timeoutMins) {
        status = "running";
        details = `${expectedVsGenerated} generated · more incoming`;
      } else {
        status = "failed";
        error = `Generation stalled at ${expectedVsGenerated} artefacts — no new output for ${Math.floor(minutesSinceLastArtefact)} min`;
        canRetry = true;
      }
    } else if (generatedCount > 0) {
      // Generated some, but phaseStatus is not "active" (e.g. paused mid-batch
      // because clarification was reopened, an approval is waiting, etc.).
      // CRITICAL: do NOT mark "done" — we have generated < expected. Marking
      // done here was the source of the misleading "2/4 ✓" green tick. Show
      // the partial state honestly so the user sees there's still work owed.
      if (expectedArtefacts > 0 && generatedCount < expectedArtefacts) {
        status = "running";
        details = `${expectedVsGenerated} generated · waiting on prior step before resuming`;
      } else {
        // No template, or generatedCount somehow >= expected — safe to call done.
        status = "done";
        details = `${expectedVsGenerated} artefacts generated`;
      }
    } else if (phaseStatus === "active" && minutesSinceUpdate <= timeoutMins) {
      status = "running";
      details = expectedArtefacts > 0
        ? `Generating 0/${expectedArtefacts}...`
        : "Generating artefacts...";
    } else if (phaseStatus === "active" && minutesSinceUpdate > timeoutMins) {
      status = "failed";
      error = `Generation stalled — no output after ${Math.floor(minutesSinceUpdate)} min (expected within ${timeoutMins} min for ${expectedArtefacts || "this"} batch)`;
      canRetry = true;
    }

    steps.push({
      id: "generate",
      label: `${phaseLabel}Generate Artefacts`,
      cycles: true,
      status,
      startedAt,
      completedAt:
        status === "done" && currentPhaseArtefacts.length > 0
          ? currentPhaseArtefacts[0].createdAt.toISOString()
          : undefined,
      duration:
        status === "done" && startedAt && currentPhaseArtefacts.length > 0
          ? currentPhaseArtefacts[0].createdAt.getTime() -
            new Date(startedAt).getTime()
          : undefined,
      details,
      error,
      canRetry,
    });
  }

  // 5. Review & Approve (merged)
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    const approvedArtefacts = currentPhaseArtefacts.filter(
      (a) => a.status === "APPROVED"
    );

    // Re-derive expected count here (scoped to this block — the Generate
    // block above used a local variable). We need it so we never mark Review
    // "done" when there are still artefacts owed by the Generate step.
    const reviewExpected = Array.isArray(currentPhaseObj?.artefacts)
      ? (currentPhaseObj!.artefacts as string[]).length
      : 0;
    const reviewTarget = reviewExpected > 0
      ? Math.max(reviewExpected, currentPhaseArtefacts.length) // honour over-delivery
      : currentPhaseArtefacts.length;

    // Extract unique approvers from artefact metadata
    const approvers = new Set<string>();
    let lastApprovedAt: Date | null = null;
    for (const a of approvedArtefacts) {
      const meta = (a as any).metadata || {};
      if (meta.approvedByName) approvers.add(meta.approvedByName);
      if (meta.approvedAt) {
        const ts = new Date(meta.approvedAt);
        if (!lastApprovedAt || ts > lastApprovedAt) lastApprovedAt = ts;
      }
    }
    const approverText = approvers.size === 0 ? ""
      : approvers.size === 1 ? ` by ${[...approvers][0]}`
      : ` by ${approvers.size} reviewers`;

    if (currentPhaseArtefacts.length === 0) {
      status = "waiting";
    } else if (
      // Done means: every expected artefact exists AND every existing artefact
      // is approved. Without the first half of the check, "All 2 approved" was
      // firing even when the template called for 4.
      reviewExpected > 0 &&
      currentPhaseArtefacts.length >= reviewExpected &&
      approvedArtefacts.length === currentPhaseArtefacts.length
    ) {
      status = "done";
      details = `All ${approvedArtefacts.length} artefact${approvedArtefacts.length !== 1 ? "s" : ""} approved${approverText}`;
    } else if (
      // Edge case: no template (reviewExpected === 0) — fall back to the
      // original "everything that exists is approved" rule so dynamic /
      // user-added artefact sets still resolve cleanly.
      reviewExpected === 0 &&
      approvedArtefacts.length === currentPhaseArtefacts.length
    ) {
      status = "done";
      details = `All ${approvedArtefacts.length} artefact${approvedArtefacts.length !== 1 ? "s" : ""} approved${approverText}`;
    } else if (approvedArtefacts.length > 0) {
      status = "running";
      // Show progress against the EXPECTED total, not just what was generated.
      // "2/2 approved" reads "done"; "2/4 approved" reads "halfway".
      details = `${approvedArtefacts.length}/${reviewTarget} approved${approverText}`;
    } else {
      status = "waiting";
      const waitingCount = currentPhaseArtefacts.length;
      details = reviewExpected > waitingCount
        ? `${waitingCount}/${reviewTarget} artefacts awaiting review · ${reviewTarget - waitingCount} still to be generated`
        : `${waitingCount} artefact${waitingCount !== 1 ? "s" : ""} awaiting review`;
    }

    steps.push({
      id: "review",
      label: `${phaseLabel}Review & Approve`,
      cycles: true,
      status,
      startedAt: currentPhaseArtefacts.length > 0
        ? currentPhaseArtefacts[currentPhaseArtefacts.length - 1].createdAt.toISOString()
        : undefined,
      completedAt: lastApprovedAt ? lastApprovedAt.toISOString() : undefined,
      details,
    });
  }

  // 6. Delivery Tasks — uses phase-completion utility
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    try {
      if (currentPhase && projectId) {
        const { getPhaseCompletion } = await import("@/lib/agents/phase-completion");
        const comp = await getPhaseCompletion(projectId, currentPhase, agentId);
        const pmTotal = comp.pmTasks.total;
        const pmDone = comp.pmTasks.done;
        const delTotal = comp.deliveryTasks.total;
        const delPct = comp.deliveryTasks.pct;

        if (pmTotal === 0 && delTotal === 0) {
          status = "skipped";
          details = "No tasks scaffolded for this phase";
        } else if ((pmTotal === 0 || pmDone === pmTotal) && (delTotal === 0 || delPct >= 80)) {
          status = "done";
          details = `PM: ${pmDone}/${pmTotal}, Delivery: ${delPct}%`;
        } else {
          status = "running";
          details = `PM: ${pmDone}/${pmTotal}, Delivery: ${delPct}% (need 80%)`;
        }
      }
    } catch {}
    steps.push({
      id: "delivery",
      label: `${phaseLabel}Delivery Tasks`,
      cycles: true,
      status,
      details,
    });
  }

  // 7. KB Risk Check
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    try {
      if (currentPhase && projectId) {
        const { getPhaseCompletion } = await import("@/lib/agents/phase-completion");
        const comp = await getPhaseCompletion(projectId, currentPhase, agentId);
        const kbBlockers = comp.blockers.filter((b) => b.startsWith("KB flag"));
        if (currentPhaseArtefacts.length === 0) {
          status = "waiting";
        } else if (kbBlockers.length > 0) {
          status = "failed";
          details = `${kbBlockers.length} KB blocker${kbBlockers.length !== 1 ? "s" : ""} flagged`;
        } else {
          status = "done";
          details = "No KB blockers";
        }
      }
    } catch {}
    steps.push({
      id: "kb_check",
      label: `${phaseLabel}KB Risk Check`,
      cycles: true,
      status,
      details,
    });
  }

  // 7. Gate
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;

    if (currentPhaseGate) {
      const iteration = (currentPhaseGate as any).iteration || 1;
      const iterationTag = iteration > 1 ? ` · submission ${iteration}` : "";
      const gateImpact = (currentPhaseGate as any).impact || {};
      const approvedBy = gateImpact.resolvedByName;

      if (currentPhaseGate.status === "APPROVED") {
        status = "done";
        details = approvedBy
          ? `Approved by ${approvedBy}${iterationTag}`
          : `Phase gate approved${iterationTag}`;
      } else if (currentPhaseGate.status === "PENDING") {
        status = "running";
        const waitMins = Math.floor((now - new Date(currentPhaseGate.createdAt).getTime()) / 60_000);
        const waitText = waitMins < 60 ? `${waitMins}m` : waitMins < 1440 ? `${Math.floor(waitMins / 60)}h` : `${Math.floor(waitMins / 1440)}d`;
        details = `Awaiting approval · pending ${waitText}${iterationTag}`;
      } else if (currentPhaseGate.status === "REJECTED") {
        // If the gate was rejected (e.g. auto-cancelled because the cron raised
        // it before any artefacts were generated) but every artefact for this
        // phase is now APPROVED, treat the gate as superseded — the user
        // doesn't have a real failure to act on. Pipeline should show the step
        // as "waiting for a fresh gate" rather than red "failed".
        const phaseArtefacts = artefacts.filter(
          (a) => (a.phaseId === currentPhase) || ((a as any).metadata as any)?.phase === currentPhase || (a.name || "").toLowerCase().includes((currentPhase || "").toLowerCase()),
        );
        const phaseArtefactsApproved = phaseArtefacts.length > 0 && phaseArtefacts.every((a) => a.status === "APPROVED");
        const rejectedAfterArtefacts =
          phaseArtefacts.some(
            (a) => new Date(a.updatedAt).getTime() > new Date(currentPhaseGate.createdAt).getTime(),
          );
        const supersededByArtefactProgress =
          phaseArtefacts.length > 0 && (phaseArtefactsApproved || rejectedAfterArtefacts);

        if (supersededByArtefactProgress) {
          status = "waiting";
          details = phaseArtefactsApproved
            ? `All ${phaseArtefacts.length} artefact${phaseArtefacts.length !== 1 ? "s" : ""} approved — ready for a fresh gate`
            : `Earlier gate auto-cancelled — artefacts in progress`;
        } else {
          status = "failed";
          const comment = (currentPhaseGate as any).comment || "";
          details = comment ? `Rejected: ${comment.slice(0, 80)}${iterationTag}` : `Phase gate rejected${iterationTag}`;
        }
      } else {
        status = "waiting";
      }
    }

    steps.push({
      id: "gate",
      label: `${phaseLabel}Phase Gate`,
      cycles: true,
      status,
      startedAt: currentPhaseGate?.createdAt?.toISOString(),
      completedAt: currentPhaseGate?.resolvedAt?.toISOString() ?? undefined,
      duration:
        currentPhaseGate?.resolvedAt && currentPhaseGate?.createdAt
          ? currentPhaseGate.resolvedAt.getTime() -
            currentPhaseGate.createdAt.getTime()
          : undefined,
      details,
      canRetry: status === "failed",
    });
  }

  // 8. Advance
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;

    if (
      firstPhase &&
      currentPhase &&
      currentPhase !== firstPhase.name
    ) {
      status = "done";
      details = `Advanced to ${currentPhase}`;
    } else if (!currentPhase) {
      status = "waiting";
      details = "No phase set";
    }

    steps.push({
      id: "advance",
      label: `${phaseLabel}Advance to Next Phase`,
      cycles: true,
      status,
      details,
    });
  }

  // Enforce strict sequential progression: a step can only show as "done" or
  // "running" if every earlier non-skipped step is already done/skipped.
  //
  // Two specific violations we want to catch:
  //   1. Generate Artefacts showing "done" while Clarification is still running
  //      — the artefacts were built without the user's clarification answers,
  //      so they need regeneration.
  //   2. KB Risk Check showing "done" while Review & Approve / Delivery Tasks
  //      haven't completed — KB check is technically a background check but
  //      surfacing it as "done" out of order misleads the user about sequence.
  //
  // Any step after an incomplete predecessor is forced to "waiting". If the
  // step has its own data (e.g. 6 DRAFT artefacts) we annotate the details to
  // make it clear rework is needed, rather than discarding the info.
  {
    let blockedByEarlier = false;
    let blockingReason = "";
    // Generate-Artefacts is special: if clarification is still pending, any
    // artefacts that exist were produced without the user's answers and are
    // stale — flag this as rework rather than "blocked by prerequisite".
    for (const s of steps) {
      if (blockedByEarlier) {
        if (s.status === "done" || s.status === "running") {
          const prevDetails = s.details;
          s.status = "waiting";
          const reworkHint = s.id === "generate" ? " (stale — will regenerate)" : "";
          s.details = prevDetails
            ? `${prevDetails} — waiting on ${blockingReason}${reworkHint}`
            : `Waiting on ${blockingReason}`;
          s.completedAt = undefined;
          s.duration = undefined;
        }
      }
      if (s.status !== "done" && s.status !== "skipped") {
        if (!blockedByEarlier) blockingReason = s.label.replace(/^[^:]+:\s*/, "");
        blockedByEarlier = true;
      }
    }
  }

  // --- Phase completion data (used for both overall progress + phase summary) ---
  let completionData: any[] = [];
  try {
    const { getAllPhasesCompletion } = await import("@/lib/agents/phase-completion");
    completionData = await getAllPhasesCompletion(deployment.projectId, agentId);
  } catch {}

  // --- Overall progress ---
  // Use the same 3-layer completion calc as the phase bars, averaged across
  // all phases, so the top bar matches what users see below.
  // Completed phases = 100%, current phase = its overall %, future phases = 0%.
  let overallProgress = 0;
  if (completionData.length > 0) {
    const completedCount = phases.filter((p) => p.status === "COMPLETED").length;
    const totalPhases = phases.length;
    const currentComp = completionData.find((c: any) => c.phaseName === currentPhase);
    const currentPhasePct = currentComp?.overall ?? 0;
    // Each phase is 1/totalPhases of overall. Completed phases contribute 100%,
    // current phase contributes its own overall %.
    const completedContribution = totalPhases > 0 ? (completedCount / totalPhases) * 100 : 0;
    const currentContribution = totalPhases > 0 ? (currentPhasePct / totalPhases) : 0;
    overallProgress = Math.round(completedContribution + currentContribution);
  } else {
    // Fallback to step-based calc if completion data unavailable
    const doneSteps = steps.filter((s) => s.status === "done").length;
    const skippedSteps = steps.filter((s) => s.status === "skipped").length;
    const effectiveTotal = steps.length - skippedSteps;
    overallProgress = effectiveTotal > 0 ? Math.round((doneSteps / effectiveTotal) * 100) : 0;
  }

  // Determine if pipeline is stuck
  let stuckAt: string | undefined;
  const failedStep = steps.find((s) => s.status === "failed");
  if (failedStep) {
    stuckAt = failedStep.id;
  } else {
    // Find first non-done, non-skipped step that isn't running
    const waitingStep = steps.find(
      (s) => s.status === "waiting" && steps.indexOf(s) > 0
    );
    // Only stuck if there's a waiting step and the previous step is done/skipped
    if (waitingStep) {
      const idx = steps.indexOf(waitingStep);
      const prev = steps[idx - 1];
      if (
        prev &&
        (prev.status === "done" || prev.status === "skipped") &&
        minutesSinceUpdate > 30
      ) {
        stuckAt = waitingStep.id;
      }
    }
  }

  // Last activity timestamp
  const lastActivity =
    activities.length > 0
      ? activities[0].createdAt.toISOString()
      : deployedAt;

  // Phases summary — reuse completionData fetched earlier for overall progress
  const completionMap = new Map(completionData.map((c: any) => [c.phaseName, c]));

  const phaseSummary = phases.map((p) => {
    const comp = completionMap.get(p.name);
    return {
      name: p.name,
      status: p.status,
      order: p.order,
      artefactsDone: comp?.artefacts?.done ?? 0,
      artefactsTotal: comp?.artefacts?.total ?? 0,
      pmTasksDone: comp?.pmTasks?.done ?? 0,
      pmTasksTotal: comp?.pmTasks?.total ?? 0,
      deliveryTasksDone: comp?.deliveryTasks?.done ?? 0,
      deliveryTasksTotal: comp?.deliveryTasks?.total ?? 0,
      overallPct: comp?.overall ?? 0,
      canAdvance: comp?.canAdvance ?? false,
      blockers: comp?.blockers ?? [],
    };
  });

  return NextResponse.json({
    data: {
      agentId,
      agentName: deployment.agent.name,
      projectId: deployment.projectId,
      projectName: deployment.project.name,
      currentPhase: currentPhase || (firstPhase?.name ?? "N/A"),
      phaseStatus,
      phases: phaseSummary,
      steps,
      overallProgress,
      stuckAt,
      lastActivity,
    },
  });
}
