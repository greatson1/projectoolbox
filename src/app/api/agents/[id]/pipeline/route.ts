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

  // Filter artefacts for current phase
  const currentPhaseObj = phases.find((p) => p.name === currentPhase);
  const currentPhaseArtefacts = currentPhaseObj
    ? artefacts.filter((a) => a.phaseId === currentPhaseObj.id)
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

  // Phase gate approvals for current phase
  const phaseGateApprovals = approvals.filter(
    (a) => a.type === "PHASE_GATE"
  );
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
    } else if (clarificationAnswers.length > 0) {
      status = "done";
      details = `${clarificationAnswers.length} answer${clarificationAnswers.length !== 1 ? "s" : ""} received`;
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
    const expectedVsGenerated = expectedArtefacts > 0
      ? `${generatedCount}/${expectedArtefacts}`
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
      // All expected artefacts generated
      status = "done";
      details = `${expectedVsGenerated} artefacts generated`;
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
      // Generated but phaseStatus not active (e.g. awaiting_clarification)
      status = "done";
      details = `${expectedVsGenerated} artefacts generated`;
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
      approvedArtefacts.length === currentPhaseArtefacts.length
    ) {
      status = "done";
      details = `All ${approvedArtefacts.length} artefact${approvedArtefacts.length !== 1 ? "s" : ""} approved${approverText}`;
    } else if (approvedArtefacts.length > 0) {
      status = "running";
      details = `${approvedArtefacts.length}/${currentPhaseArtefacts.length} approved${approverText}`;
    } else {
      status = "waiting";
      details = `${currentPhaseArtefacts.length} artefact${currentPhaseArtefacts.length !== 1 ? "s" : ""} awaiting review`;
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
        status = "failed";
        const comment = (currentPhaseGate as any).comment || "";
        details = comment ? `Rejected: ${comment.slice(0, 80)}${iterationTag}` : `Phase gate rejected${iterationTag}`;
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
