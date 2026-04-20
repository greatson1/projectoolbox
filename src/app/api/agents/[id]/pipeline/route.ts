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
}

const STEP_DEFS: { id: string; label: string }[] = [
  { id: "deploy", label: "Deploy Agent" },
  { id: "research", label: "Feasibility Research" },
  { id: "clarify", label: "Clarification Questions" },
  { id: "generate", label: "Generate Artefacts" },
  { id: "review", label: "Review Artefacts" },
  { id: "approve", label: "Approve Artefacts" },
  { id: "gate", label: "Phase Gate Approval" },
  { id: "advance", label: "Advance Phase" },
];

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
  const phaseStatus = deployment.phaseStatus || "active";

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

  // Research KB items — tags containing "research" or "feasibility"
  const researchItems = kbItems.filter((item) =>
    item.tags.some(
      (t) =>
        t.toLowerCase().includes("research") ||
        t.toLowerCase().includes("feasibility")
    )
  );

  // Clarification messages
  const clarificationMessages = chatMessages.filter((msg) => {
    const meta = msg.metadata as Record<string, unknown> | null;
    const hasType =
      meta?.type === "clarification_question" ||
      meta?.type === "clarification_answer";
    const hasContent = msg.content
      .toLowerCase()
      .includes("clarification");
    return hasType || hasContent;
  });
  const clarificationAnswers = chatMessages.filter((msg) => {
    const meta = msg.metadata as Record<string, unknown> | null;
    return meta?.type === "clarification_answer";
  });

  // Phase gate approvals for current phase
  const phaseGateApprovals = approvals.filter(
    (a) => a.type === "PHASE_GATE"
  );
  const currentPhaseGate = phaseGateApprovals.find((a) => {
    const desc = a.description?.toLowerCase() || "";
    const title = a.title?.toLowerCase() || "";
    const phaseNameLower = (currentPhase || "").toLowerCase();
    return desc.includes(phaseNameLower) || title.includes(phaseNameLower);
  });

  // Deployment timestamps
  const deployedAt = deployment.deployedAt.toISOString();
  const lastUpdate = deployment.lastCycleAt || deployment.deployedAt;
  const minutesSinceUpdate = (now - lastUpdate.getTime()) / 60_000;

  // --- Build steps ---
  const steps: PipelineStep[] = [];

  // 1. Deploy — always done if deployment exists
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
      label: "Feasibility Research",
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

  // 3. Clarify
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    const clarifyActivity = activities.find(
      (a) => a.type === "clarification" || a.type === "clarification_question"
    );
    const startedAt = clarifyActivity?.createdAt?.toISOString();

    if (clarificationAnswers.length > 0) {
      status = "done";
      details = `${clarificationAnswers.length} answer${clarificationAnswers.length !== 1 ? "s" : ""} received`;
    } else if (phaseStatus === "awaiting_clarification") {
      status = "running";
      details = `${clarificationMessages.length} question${clarificationMessages.length !== 1 ? "s" : ""} pending`;
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
      label: "Clarification Questions",
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

    if (currentPhaseArtefacts.length > 0) {
      status = "done";
      details = `${currentPhaseArtefacts.length} artefact${currentPhaseArtefacts.length !== 1 ? "s" : ""} generated`;
    } else if (
      phaseStatus === "active" &&
      currentPhaseArtefacts.length === 0 &&
      minutesSinceUpdate <= 30
    ) {
      status = "running";
      details = "Generating artefacts...";
    } else if (
      phaseStatus === "active" &&
      currentPhaseArtefacts.length === 0 &&
      minutesSinceUpdate > 30
    ) {
      status = "failed";
      error =
        "Generation stalled — no artefacts produced after 30 minutes";
      canRetry = true;
    }

    steps.push({
      id: "generate",
      label: "Generate Artefacts",
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

  // 5. Review
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    const reviewedArtefacts = currentPhaseArtefacts.filter(
      (a) => a.status !== "DRAFT"
    );

    if (currentPhaseArtefacts.length === 0) {
      status = "waiting";
    } else if (reviewedArtefacts.length > 0) {
      status = "done";
      details = `${reviewedArtefacts.length}/${currentPhaseArtefacts.length} artefact${currentPhaseArtefacts.length !== 1 ? "s" : ""} reviewed`;
    } else {
      status = "waiting";
      details = `${currentPhaseArtefacts.length} artefact${currentPhaseArtefacts.length !== 1 ? "s" : ""} awaiting review`;
    }

    steps.push({
      id: "review",
      label: "Review Artefacts",
      status,
      details,
    });
  }

  // 6. Approve
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;
    const approvedArtefacts = currentPhaseArtefacts.filter(
      (a) => a.status === "APPROVED"
    );

    if (currentPhaseArtefacts.length === 0) {
      status = "waiting";
    } else if (
      approvedArtefacts.length === currentPhaseArtefacts.length
    ) {
      status = "done";
      details = `All ${approvedArtefacts.length} artefact${approvedArtefacts.length !== 1 ? "s" : ""} approved`;
    } else if (approvedArtefacts.length > 0) {
      status = "running";
      details = `${approvedArtefacts.length}/${currentPhaseArtefacts.length} approved`;
    }

    steps.push({
      id: "approve",
      label: "Approve Artefacts",
      status,
      details,
    });
  }

  // 7. Gate
  {
    let status: PipelineStep["status"] = "waiting";
    let details: string | undefined;

    if (currentPhaseGate) {
      if (currentPhaseGate.status === "APPROVED") {
        status = "done";
        details = "Phase gate approved";
      } else if (currentPhaseGate.status === "PENDING") {
        status = "running";
        details = "Awaiting phase gate approval";
      } else if (currentPhaseGate.status === "REJECTED") {
        status = "failed";
        details = "Phase gate rejected";
      } else {
        status = "waiting";
      }
    }

    steps.push({
      id: "gate",
      label: "Phase Gate Approval",
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
      label: "Advance Phase",
      status,
      details,
    });
  }

  // --- Overall progress ---
  const doneSteps = steps.filter((s) => s.status === "done").length;
  const skippedSteps = steps.filter((s) => s.status === "skipped").length;
  const effectiveTotal = steps.length - skippedSteps;
  const overallProgress =
    effectiveTotal > 0
      ? Math.round((doneSteps / effectiveTotal) * 100)
      : 0;

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

  // Phases summary
  // Enrich phase data with 3-layer completion status
  let completionData: any[] = [];
  try {
    const { getAllPhasesCompletion } = await import("@/lib/agents/phase-completion");
    completionData = await getAllPhasesCompletion(deployment.projectId, agentId);
  } catch {}
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
