"use client";
// @ts-nocheck

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCreateProject, useCreateAgent, useDeployAgent, useCredits } from "@/hooks/use-api";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Deploy Project Wizard — Premium 6-step wizard.
 * The most important user journey in Projectoolbox.
 */


import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { METHODOLOGIES as METHODOLOGY_DEFS, type MethodologyId } from "@/lib/methodology-definitions";

// ═══════════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const STEP_LABELS = ["Project Details", "Methodology", "Phase Gates", "Team", "Agent Config", "Review & Deploy"];
type Priority = "high" | "medium" | "low";
type Category = "construction" | "software" | "marketing" | "operations" | "research" | "events" | "travel" | "personal" | "other";

interface TeamMember { name: string; email: string; role: string; }
interface Stakeholder { name: string; role: string; org: string; power: number; interest: number; }
interface PhaseGate {
  name: string; artefacts: { name: string; required: boolean; aiGeneratable?: boolean }[];
  approvalRequired: boolean; criteria: string;
}

interface WizardState {
  // Step 1
  projectName: string; description: string; client: string;
  startDate: string; endDate: string; budget: string;
  priority: Priority; category: Category;
  // Step 2
  methodology: string;
  // Step 3
  phases: PhaseGate[];
  hitlePhaseGates: boolean; hitleBudgetThreshold: string;
  hitleCommsApproval: boolean; hitleRiskThreshold: string;
  escalationTimeout: string;
  // Step 4
  team: TeamMember[]; stakeholders: Stakeholder[];
  // Step 5
  agentName: string; agentTitle: string; agentGradient: number;
  domainTags: string; defaultGreeting: string; monthlyBudget: string;
  personalityFormal: number; personalityConcise: number;
  autonomyLevel: number; reportSchedule: string;
  notifSlack: boolean; notifEmail: boolean; notifTelegram: boolean;
  intJira: boolean; intGithub: boolean; intConfluence: boolean;
}

const INIT_STATE: WizardState = {
  projectName: "", description: "", client: "", startDate: "", endDate: "",
  budget: "", priority: "medium", category: "other",
  methodology: "",
  phases: [], hitlePhaseGates: true, hitleBudgetThreshold: "",
  hitleCommsApproval: true, hitleRiskThreshold: "high", escalationTimeout: "24",
  team: [],
  stakeholders: [],
  agentName: "Alpha", agentTitle: "", agentGradient: 0, domainTags: "", defaultGreeting: "", monthlyBudget: "",
  personalityFormal: 35, personalityConcise: 50,
  autonomyLevel: 3, reportSchedule: "weekly",
  notifSlack: true, notifEmail: true, notifTelegram: false,
  intJira: false, intGithub: false, intConfluence: false,
};

const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: "software", label: "Software", icon: "💻" },
  { id: "construction", label: "Construction", icon: "🏗️" },
  { id: "marketing", label: "Marketing", icon: "📣" },
  { id: "operations", label: "Operations", icon: "⚙️" },
  { id: "research", label: "Research", icon: "🔬" },
  { id: "events", label: "Events", icon: "🎉" },
  { id: "travel", label: "Travel", icon: "✈️" },
  { id: "personal", label: "Personal", icon: "🧑" },
  { id: "other", label: "Other", icon: "📁" },
];

const METHODOLOGIES = [
  { id: "scrum", name: "Scrum", icon: "🔄", desc: "Iterative sprints with ceremonies and retrospectives", bestFor: "Software teams needing fast feedback loops", rec: false },
  { id: "kanban", name: "Kanban", icon: "📋", desc: "Continuous flow with WIP limits and visual boards", bestFor: "Support teams, ongoing work with variable priority", rec: false },
  { id: "prince2", name: "Traditional (PMI-Style)", icon: "👑", desc: "Structured stage-gate governance with controlled start/end", bestFor: "Regulated industries, large programmes, formal governance", rec: false },
  { id: "waterfall", name: "Waterfall", icon: "🌊", desc: "Sequential phases with fixed scope and schedule", bestFor: "Construction, hardware, fixed-requirements projects", rec: false },
  { id: "safe", name: "SAFe", icon: "🏢", desc: "Scaled agile for enterprise-level programme coordination", bestFor: "Multiple teams, cross-functional dependencies, portfolios", rec: false },
  { id: "hybrid", name: "Hybrid", icon: "⚡", desc: "Predictive governance with agile delivery sprints", bestFor: "Mixed environments needing governance + flexibility", rec: false },
];

// Derive PHASE_TEMPLATES from the single source of truth
const PHASE_TEMPLATES: Record<string, PhaseGate[]> = Object.fromEntries(
  Object.entries(METHODOLOGY_DEFS).map(([key, def]) => [
    key,
    def.phases.map(p => ({
      name: p.name,
      artefacts: p.artefacts.map(a => ({ name: a.name, required: a.required, aiGeneratable: a.aiGeneratable })),
      approvalRequired: p.gate.preRequisites.some(pr => pr.requiresHumanApproval),
      criteria: p.gate.criteria,
    })),
  ])
);

// Short descriptions for each artefact type — shown as a tooltip in the wizard
const ARTEFACT_DESCRIPTIONS: Record<string, string> = {
  // PRINCE2 / Traditional
  "Problem Statement": "Define the business problem or opportunity this project addresses",
  "Options Analysis": "Compare the available options for solving the problem with costs and benefits",
  "Outline Business Case": "High-level justification: why this project, what value it delivers",
  "Project Brief": "Defines scope, objectives, approach, and initial risk assessment",
  "Project Charter": "Formal authorisation document — establishes the project and the PM's authority",
  "Business Case": "Full cost-benefit analysis with expected ROI and success criteria",
  "Stakeholder Register": "List of all stakeholders with influence, interest, and engagement strategy",
  "Initial Risk Register": "Early-stage risk log with likelihood, impact, and initial mitigations",
  "Communication Plan": "Who gets what information, when, and through which channel",
  "WBS": "Work Breakdown Structure — hierarchical decomposition of all deliverables",
  "Schedule Baseline": "Approved project timeline with milestones and critical path",
  "Budget Breakdown": "Phase-by-phase cost plan against the approved budget",
  "Risk Management Plan": "Strategy for identifying, assessing, and responding to risks",
  "Quality Plan": "Standards, reviews, and acceptance criteria for deliverables",
  "Resource Plan": "Who is doing what, when — team capacity and allocation",
  "Status Reports": "Regular progress updates against plan, covering time, cost, scope, risk",
  "Risk Reviews": "Periodic reassessment of the risk register as the project progresses",
  "Exception Reports": "Triggered when a stage is forecast to exceed tolerances",
  "Change Requests": "Formal log of proposed changes to scope, schedule, or budget",
  "Quality Review Records": "Documentation of quality checks and sign-offs",
  "Acceptance Certificate": "Formal sign-off that deliverables meet agreed criteria",
  "End Project Report": "Final performance summary against original Business Case",
  "Lessons Learned": "What went well, what didn't, and recommendations for future projects",
  "Closure Report": "Confirms all work is complete and the project is formally closed",
  // Waterfall
  "Requirements Specification": "Detailed, prioritised list of functional and non-functional requirements",
  "Feasibility Study": "Technical, financial, and operational feasibility assessment",
  "Design Document": "System or solution architecture and design decisions",
  "Work Breakdown Structure": "Full hierarchical breakdown of all work packages",
  "Schedule with Dependencies": "Gantt-style schedule with all task dependencies mapped",
  "Cost Management Plan": "How budget will be tracked, controlled, and reported",
  "Resource Management Plan": "How team members and other resources will be managed",
  "Quality Management Plan": "Quality standards, testing approach, and review processes",
  "Change Control Plan": "Formal process for requesting, evaluating, and approving changes",
  "Test Plan": "Scope, approach, resources, and schedule for testing activities",
  "Release Plan": "Steps and criteria for deploying the solution to production",
  "Handover Documentation": "Operational guides, support procedures, and knowledge transfer",
  // Agile / Scrum / SAFe
  "Product Vision": "One-page statement of what the product is, who it's for, and why it matters",
  "Product Roadmap": "High-level feature timeline across quarters or PI cycles",
  "Product Backlog": "Prioritised list of user stories, epics, and features",
  "Sprint Charter": "Goals, capacity, and acceptance criteria for the current sprint",
  "Definition of Done": "Agreed checklist that must be met before any item is considered complete",
  "Team Agreement": "Working norms, ceremonies, and collaboration ground rules",
  "Sprint Backlog": "Stories committed to the current sprint with task-level breakdown",
  "Sprint Review Notes": "Demo outcomes, stakeholder feedback, and backlog refinements",
  "Sprint Retrospective": "What went well, what to improve, and actions for the next sprint",
  "Velocity Report": "Story points completed per sprint — trend used for forecasting",
  "Release Notes": "User-facing summary of features, fixes, and changes in each release",
  "PI Planning Board": "SAFe PI objectives, team iterations, and dependency map",
  "ART Sync Report": "Cross-team alignment summary from Agile Release Train syncs",
  // Kanban
  "Kanban Board Definition": "Column structure, WIP limits, and flow policies",
  "Service Level Agreement": "Expected lead times by work type and priority",
  "Flow Metrics Report": "Cycle time, throughput, and cumulative flow diagram",
  "Blocker Log": "Active impediments with owner and resolution status",
  // Hybrid
  "Project Initiation Document": "PID — combines charter, business case, and management plans",
  "Agile Delivery Plan": "Sprint/iteration plan within the overall governance framework",
  "Integrated Change Log": "Unified log of scope, schedule, and budget changes",
};

const GRADIENT_PRESETS = [
  { gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#6366F1" },
  { gradient: "linear-gradient(135deg, #22D3EE, #06B6D4)", color: "#22D3EE" },
  { gradient: "linear-gradient(135deg, #10B981, #34D399)", color: "#10B981" },
  { gradient: "linear-gradient(135deg, #F97316, #FB923C)", color: "#F97316" },
  { gradient: "linear-gradient(135deg, #EC4899, #F472B6)", color: "#EC4899" },
  { gradient: "linear-gradient(135deg, #8B5CF6, #A78BFA)", color: "#8B5CF6" },
];

const AUTONOMY_CARDS = [
  { level: 1, name: "Assistant", tagline: "I suggest, you decide", desc: "Agent only responds when asked. No proactive actions. All outputs require manual execution.", rec: false },
  { level: 2, name: "Advisor", tagline: "I draft, you approve everything", desc: "Agent monitors project health and drafts artefacts, but every action requires your approval before execution.", rec: false },
  { level: 3, name: "Co-pilot", tagline: "I handle routine, escalate important", desc: "Agent executes routine tasks autonomously (status reports, risk scans, meeting notes). Escalates decisions above configurable thresholds.", rec: true },
  { level: 4, name: "Autonomous", tagline: "I run the project, you review outcomes", desc: "Agent handles most decisions independently within governance bounds. You review weekly summaries and exception reports.", rec: false },
  { level: 5, name: "Strategic", tagline: "End-to-end, minimal oversight", desc: "Full autonomy within enterprise governance rules. Self-correcting, self-optimising. Human intervention only for gate approvals.", rec: false },
];

const AGENT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Falcon", "Griffin", "Hawk", "Iris", "Jade"];
const ROLES = ["PM", "Sponsor", "Lead", "Organiser", "Participant", "Dev", "QA", "BA", "Architect", "Designer", "Tech Lead", "Analyst", "Consultant", "Traveller", "Client", "Other"];

const CREDIT_BREAKDOWN = [
  { name: "Document generation", value: 420, color: "#6366F1" },
  { name: "Risk analysis", value: 240, color: "#22D3EE" },
  { name: "Meeting processing", value: 180, color: "#10B981" },
  { name: "Status reports", value: 160, color: "#F59E0B" },
  { name: "Communications", value: 120, color: "#EC4899" },
  { name: "Other", value: 80, color: "#64748B" },
];

const DEPLOY_STAGES = [
  "Initialising agent runtime...",
  "Connecting to project integrations...",
  "Analysing project parameters...",
  "Building methodology framework...",
  "Generating initial artefact templates...",
  "Agent deployed successfully!",
];

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function ProjectWizardPage() {
  usePageTitle("Deploy Agent");
  const [step, setStep] = useState(0);
  const { data: creditsData } = useCredits();
  const creditBalance = creditsData?.balance ?? creditsData?.creditBalance ?? null;
  const [data, setData] = useState<WizardState>(INIT_STATE);
  const [deploying, setDeploying] = useState(false);
  const [deployStage, setDeployStage] = useState(0);
  const [deployed, setDeployed] = useState(false);

  const upd = (patch: Partial<WizardState>) => setData(prev => ({ ...prev, ...patch }));
  const g = GRADIENT_PRESETS[data.agentGradient];

  // Auto-populate phases when methodology changes
  useEffect(() => {
    if (data.methodology && PHASE_TEMPLATES[data.methodology]) {
      upd({ phases: PHASE_TEMPLATES[data.methodology].map(p => ({ ...p, artefacts: p.artefacts.map(a => ({ ...a })) })) });
    }
  }, [data.methodology]);

  // Auto-recommend methodology — multi-signal scoring
  const recommended = useMemo(() => {
    const budget = Number(data.budget) || 0;
    const name = (data.projectName || "").toLowerCase();
    const desc = (data.description || "").toLowerCase();
    const text = name + " " + desc;
    const durationDays = data.startDate && data.endDate
      ? Math.max(1, Math.round((new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / 86400000))
      : null;

    // Hard category rules first
    if (data.category === "software") {
      if (budget > 500000) return "safe";          // enterprise software → SAFe
      if (durationDays && durationDays > 180) return "scrum"; // long software → Scrum
      return "scrum";
    }
    if (data.category === "construction") return "waterfall";
    if (data.category === "events") {
      return durationDays && durationDays <= 7 ? "kanban" : "waterfall";
    }
    if (data.category === "marketing") return "kanban";
    if (data.category === "research") return "hybrid";

    // Travel & personal: short trips → Kanban, longer planning → Hybrid
    if (data.category === "travel" || data.category === "personal") {
      return durationDays && durationDays <= 5 ? "kanban" : "hybrid";
    }

    // Budget signals (apply to any category)
    if (budget > 1000000) return "prince2";  // Very large budget → formal governance
    if (budget > 500000) return "prince2";

    // Keyword signals in project name / description
    if (/\b(sprint|agile|mvp|iteration|backlog|epic)\b/.test(text)) return "scrum";
    if (/\b(compliance|audit|regul|govern|formal|gate)\b/.test(text)) return "prince2";
    if (/\b(flow|support|maintenance|ongoing|continuous)\b/.test(text)) return "kanban";
    if (/\b(construction|build|civil|infra|infrastructure)\b/.test(text)) return "waterfall";
    if (/\b(enterprise|programme|portfolio|transformation)\b/.test(text)) return "safe";

    // Duration signals (when no other signal fires)
    if (durationDays) {
      if (durationDays <= 14) return "kanban";   // short bursts → Kanban
      if (durationDays <= 90) return "scrum";    // 2 weeks–3 months → Scrum
      if (durationDays > 365) return "prince2";  // 1 year+ → formal governance
    }

    return "hybrid"; // Sensible default
  }, [data.category, data.budget, data.startDate, data.endDate, data.projectName, data.description]);

  // Auto-generate context-aware greeting placeholder
  const greetingPlaceholder = useMemo(() => {
    const name = data.projectName || "your project";
    if (data.category === "travel") return `Ready to plan your trip! I'll track budget, bookings, and risks for ${name}.`;
    if (data.category === "personal") return `I'm here to help you manage ${name} — let's get organised.`;
    if (data.category === "events") return `Let's make ${name} a success. I'll handle logistics, timelines, and risks.`;
    if (data.category === "construction") return `Ready to manage ${name}. I'll track milestones, costs, and site risks.`;
    if (data.category === "software") return `Let's build something great! I'm ready to manage ${name}.`;
    if (data.category === "marketing") return `Campaign ready! I'm set to drive ${name} forward.`;
    return `Ready to manage ${name}. How can I help you today?`;
  }, [data.category, data.projectName]);

  // Auto-compute budget threshold (10% of project budget, min £100)
  const autoThreshold = useMemo(() => {
    const b = Number(data.budget);
    if (!b || b <= 0) return "";
    return String(Math.max(100, Math.round(b * 0.1)));
  }, [data.budget]);

  // Validation
  const canProceed = useMemo(() => {
    if (step === 0) return data.projectName.length > 2;
    if (step === 1) return !!data.methodology;
    if (step === 2) return data.phases.length > 0;
    if (step === 3) return data.team.length > 0 || data.category === "personal" || data.category === "travel" || data.category === "other";
    if (step === 4) return data.agentName.length > 0;
    return true;
  }, [step, data]);

  const router = useRouter();
  const createProject = useCreateProject();
  const createAgent = useCreateAgent();
  const deployAgent = useDeployAgent();

  // Real deploy — creates project, agent, and deployment via API
  const startDeploy = async () => {
    setDeploying(true); setDeployStage(0);

    const advanceStage = (stage: number) => new Promise<void>(resolve => {
      setDeployStage(stage);
      setTimeout(resolve, 800);
    });

    let createdProjectId: string | null = null;
    let createdAgentId: string | null = null;

    try {
      // Stage 0: Initialising
      await advanceStage(0);

      // Stage 1: Create project
      await advanceStage(1);
      const project = await createProject.mutateAsync({
        name: data.projectName,
        description: data.description,
        methodology: data.methodology?.toUpperCase() || "WATERFALL",
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        budget: data.budget ? Number(data.budget) : undefined,
        priority: data.priority,
        category: data.category,
      });
      createdProjectId = project.id;

      // Stage 2: Create agent
      await advanceStage(2);
      const agent = await createAgent.mutateAsync({
        name: data.agentName || "Agent",
        title: data.agentTitle || undefined,
        autonomyLevel: data.autonomyLevel || 3,
        personality: {
          formalityLevel: data.personalityFormal,
          conciseness: data.personalityConcise,
        },
        gradient: GRADIENT_PRESETS[data.agentGradient]?.gradient,
        domainTags: data.domainTags ? data.domainTags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
        defaultGreeting: data.defaultGreeting || undefined,
        monthlyBudget: data.monthlyBudget ? parseInt(data.monthlyBudget) : undefined,
      });
      createdAgentId = agent.id;

      // Stage 3: Deploy agent to project
      await advanceStage(3);
      await deployAgent.mutateAsync({
        agentId: agent.id,
        projectId: project.id,
        config: {
          methodology: data.methodology,
          phases: data.phases,
          hitlePhaseGates: data.hitlePhaseGates,
          hitleBudgetThreshold: data.hitleBudgetThreshold,
          hitleCommsApproval: data.hitleCommsApproval,
          hitleRiskThreshold: data.hitleRiskThreshold,
          escalationTimeout: data.escalationTimeout,
          reportSchedule: data.reportSchedule,
          notifications: { slack: data.notifSlack, email: data.notifEmail, telegram: data.notifTelegram },
          integrations: { jira: data.intJira, github: data.intGithub, confluence: data.intConfluence },
        },
      });

      // Stage 4: Building framework
      await advanceStage(4);

      // Stage 5: Success
      await advanceStage(5);
      setDeployed(true);
      setDeploying(false);

      // Redirect to fleet page after a moment
      setTimeout(() => router.push("/agents"), 2000);
    } catch (err: any) {
      console.error("Deploy failed:", err);

      // Roll back any partially created resources so nothing is orphaned
      try {
        if (createdAgentId) await fetch(`/api/agents/${createdAgentId}?hard=true`, { method: "DELETE" });
        if (createdProjectId) await fetch(`/api/projects/${createdProjectId}`, { method: "DELETE" });
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }

      setDeploying(false);
      setDeployStage(0);

      // Show a clear, readable error — not a raw browser alert
      const msg = err.message || "Unknown error";
      const isLimitError = msg.toLowerCase().includes("limit") || msg.toLowerCase().includes("plan");
      const isCreditsError = msg.toLowerCase().includes("credit") || msg.toLowerCase().includes("insufficient");
      const friendlyMsg = isLimitError
        ? "Agent limit reached for your plan. Upgrade your plan to deploy more agents."
        : isCreditsError
        ? "Not enough credits to deploy. Top up your credits and try again."
        : `Deployment failed: ${msg}`;

      toast.error(friendlyMsg, { duration: 8000 });
    }
  };

  const totalCredits = CREDIT_BREAKDOWN.reduce((s, c) => s + c.value, 0);

  return (
    <div className="max-w-[960px] mx-auto pb-12">
      {/* Credit warning */}
      {creditBalance !== null && creditBalance <= 0 && (
        <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-destructive">No credits remaining</p>
            <p className="text-xs text-muted-foreground mt-0.5">You need credits to deploy an agent. Each deployment costs 10 credits.</p>
          </div>
          <a href="/billing/credits" className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors">Top Up Credits</a>
        </div>
      )}
      {/* ═══ PROGRESS BAR ═══ */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1" style={{ justifyContent: i === 0 ? "flex-start" : i === STEP_LABELS.length - 1 ? "flex-end" : "center" }}>
              <div className="flex items-center gap-1.5">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
                  style={{
                    background: i < step ? "#10B981" : i === step ? g.color : `${"var(--border)"}44`,
                    color: i <= step ? "#FFF" : "var(--muted-foreground)",
                    boxShadow: i === step ? `0 0 12px ${g.color}44` : "none",
                  }}>
                  {i < step ? "✓" : i + 1}
                </div>
                <span className="text-[11px] font-semibold hidden sm:inline" style={{ color: i === step ? "var(--foreground)" : "var(--muted-foreground)" }}>{label}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="h-1.5 rounded-full overflow-hidden flex gap-1" style={{ background: `${"var(--border)"}22` }}>
          {STEP_LABELS.map((_, i) => (
            <div key={i} className="flex-1 rounded-full transition-all duration-500" style={{
              background: i < step ? "#10B981" : i === step ? g.color : "transparent",
              opacity: i === step ? 1 : i < step ? 0.7 : 0.2,
            }} />
          ))}
        </div>
      </div>

      {/* ═══ STEP CONTENT ═══ */}
      <div className="transition-all duration-300">

        {/* ─── STEP 1: PROJECT DETAILS ─── */}
        {step === 0 && (
          <div className="space-y-5">
            <StepHeader title="Project Details" subtitle="Tell us about your project" />

            <Card className="px-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldGroup label="Project Name" required>
                  <StyledInput value={data.projectName} onChange={v => upd({ projectName: v })} placeholder="e.g. CRM Migration to Salesforce" />
                </FieldGroup>
                <FieldGroup label="Client / Organisation">
                  <StyledInput value={data.client} onChange={v => upd({ client: v })} placeholder="e.g. Atlas Corp" />
                </FieldGroup>
                <div className="md:col-span-2">
                  <FieldGroup label="Description">
                    <textarea className="w-full px-3 py-2 rounded-[10px] text-[13px] resize-none" rows={3}
                      value={data.description} onChange={e => upd({ description: e.target.value })}
                      placeholder="Brief description of the project scope and objectives..."
                      style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}`, outline: "none" }} />
                  </FieldGroup>
                </div>
                <FieldGroup label="Start Date">
                  <StyledInput type="date" value={data.startDate} onChange={v => upd({ startDate: v })} />
                </FieldGroup>
                <FieldGroup label="End Date">
                  <StyledInput type="date" value={data.endDate} onChange={v => upd({ endDate: v })} />
                </FieldGroup>
                <FieldGroup label="Budget">
                  <div className="flex gap-2">
                    <select className="px-2 py-2 rounded-lg text-sm bg-card border border-border/30 text-foreground w-16" defaultValue="GBP">
                      <option value="GBP">£</option><option value="USD">$</option><option value="EUR">€</option>
                    </select>
                    <StyledInput type="number" value={data.budget} onChange={v => upd({ budget: v })} placeholder="250000" />
                  </div>
                </FieldGroup>
              </div>
            </Card>

            {/* Priority cards */}
            <FieldGroup label="Priority">
              <div className="grid grid-cols-3 gap-3">
                {([["high", "🔴", "Critical path, tight deadline"], ["medium", "🟡", "Standard priority, normal pace"], ["low", "🟢", "Low urgency, flexible timeline"]] as [Priority, string, string][]).map(([p, icon, desc]) => (
                  <SelectCard key={p} selected={data.priority === p} onClick={() => upd({ priority: p })} color={p === "high" ? "#EF4444" : p === "medium" ? "#F59E0B" : "#10B981"}>
                    <span className="text-[18px]">{icon}</span>
                    <span className="text-[13px] font-semibold capitalize">{p}</span>
                    <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{desc}</span>
                  </SelectCard>
                ))}
              </div>
            </FieldGroup>

            {/* Category cards */}
            <FieldGroup label="Category">
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {CATEGORIES.map(c => (
                  <SelectCard key={c.id} selected={data.category === c.id} onClick={() => upd({ category: c.id })} color={g.color} compact>
                    <span className="text-[22px]">{c.icon}</span>
                    <span className="text-[11px] font-semibold">{c.label}</span>
                  </SelectCard>
                ))}
              </div>
            </FieldGroup>

            {/* AI suggestion */}
            <div className="p-3 rounded-[12px] flex items-center gap-3" style={{ background: `${g.color}08`, border: `1px solid ${g.color}22` }}>
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-[9px] font-bold text-white shadow-primary/30">AI</div>
              <div className="flex-1">
                <p className="text-[12px] font-semibold" style={{ color: g.color }}>AI Recommendation</p>
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  {(() => {
                    const budget = Number(data.budget) || 0;
                    const durationDays = data.startDate && data.endDate
                      ? Math.max(1, Math.round((new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / 86400000))
                      : null;
                    const signals: string[] = [];
                    if (data.category && data.category !== "other") signals.push(`${data.category} project`);
                    if (budget > 0) signals.push(`£${budget.toLocaleString()} budget`);
                    if (durationDays) signals.push(`${durationDays}-day timeline`);
                    const methodName = METHODOLOGIES.find(m => m.id === recommended)?.name || recommended;
                    const reasons: Record<string, string> = {
                      scrum: "Iterative sprints with short feedback loops suit this type of work — the agent delivers in 2-week cycles with regular reviews.",
                      kanban: "A visual flow board without fixed sprints is ideal for short or ongoing work — focuses on throughput and reduces overhead.",
                      waterfall: "Sequential phases with clear gates suit projects with fixed scope and well-defined requirements upfront.",
                      prince2: "Formal governance with stage-gate controls provides the rigour needed for projects of this scale and complexity.",
                      hybrid: "Combines structured planning phases (requirements, feasibility) with flexible delivery — gives you governance without excessive ceremony.",
                      safe: "Enterprise-level programme coordination across multiple teams and workstreams — structured scaling of agile practices.",
                    };
                    return <>Based on {signals.length > 0 ? signals.join(", ") : "your project"}, we recommend <strong style={{ color: "var(--foreground)" }}>{methodName}</strong>. {reasons[recommended] || ""}</>;
                  })()}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── STEP 2: METHODOLOGY ─── */}
        {step === 1 && (
          <div className="space-y-5">
            <StepHeader title="Choose Methodology" subtitle="Select the delivery framework for your project" />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {METHODOLOGIES.map(m => (
                <div key={m.id} className="rounded-[14px] p-4 cursor-pointer transition-all duration-200 hover:translate-y-[-2px]"
                  onClick={() => upd({ methodology: m.id })}
                  style={{
                    background: "var(--card)",
                    border: data.methodology === m.id ? `2px solid ${g.color}` : `1px solid ${"var(--border)"}`,
                    boxShadow: data.methodology === m.id ? `0 4px 20px ${g.color}22` : "0 1px 3px rgba(0,0,0,0.08)",
                  }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[24px]">{m.icon}</span>
                    {m.id === recommended && <Badge variant="outline">Recommended</Badge>}
                    {data.methodology === m.id && <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white" style={{ background: g.color }}>✓</span>}
                  </div>
                  <p className="text-[15px] font-bold mb-1" style={{ color: "var(--foreground)" }}>{m.name}</p>
                  <p className="text-[12px] leading-relaxed mb-2" style={{ color: "var(--muted-foreground)" }}>{m.desc}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Best for: {m.bestFor}</p>
                </div>
              ))}
            </div>

            {/* AI rationale */}
            {data.methodology && (
              <div className="p-4 rounded-[12px]" style={{ background: `${g.color}06`, border: `1px solid ${g.color}18` }}>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-[9px] font-bold text-white shadow-primary/30">AI</div>
                  <div>
                    <p className="text-[12px] font-semibold mb-1" style={{ color: g.color }}>Why {METHODOLOGIES.find(m => m.id === data.methodology)?.name}?</p>
                    <p className="text-[12px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                      {(() => {
                        const budget = Number(data.budget) || 0;
                        const durationDays = data.startDate && data.endDate
                          ? Math.max(1, Math.round((new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / 86400000))
                          : null;
                        const signals: string[] = [];
                        if (data.category && data.category !== "other") signals.push(`${data.category} project type`);
                        if (budget > 0) signals.push(`£${budget.toLocaleString()} budget`);
                        if (durationDays) signals.push(`${durationDays}-day timeline`);
                        const signalStr = signals.length > 0 ? `Based on your ${signals.join(", ")}: ` : "";
                        if (data.methodology === recommended) {
                          const reasons: Record<string, string> = {
                            scrum: "iterative sprints suit this type of work well, letting the agent deliver in short feedback loops.",
                            kanban: "a visual flow board with no fixed sprints is ideal for short or ongoing work like this.",
                            waterfall: "sequential phases with clear gates suit this project's fixed scope and requirements.",
                            prince2: "formal governance and stage-gate controls are warranted at this budget scale.",
                            hybrid: "a mix of upfront planning and agile delivery gives you structure without overhead.",
                            safe: "enterprise-level programme coordination across multiple teams is best handled by SAFe.",
                          };
                          return `${signalStr}${reasons[recommended] || "This methodology is the best fit for your project."}`;
                        }
                        return `We recommended ${METHODOLOGIES.find(m => m.id === recommended)?.name} based on your project signals, but ${METHODOLOGIES.find(m => m.id === data.methodology)?.name} is a valid choice. The agent will adapt its governance framework accordingly.`;
                      })()}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── STEP 3: PHASE GATES & GOVERNANCE ─── */}
        {step === 2 && (
          <div className="space-y-5">
            <StepHeader title="Phase Gates & Governance" subtitle="Choose which documents to generate per phase, then set approval and governance controls" />

            {/* ── Document Selection ── */}
            <Card className="px-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Documents to Generate</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    Select which documents your agent should create for each phase.
                    Deselect anything you don't need — the agent will only generate what's checked.
                  </p>
                </div>
                <span className="text-[10px] px-2 py-1 rounded-full shrink-0" style={{ background: `${g.color}15`, color: g.color }}>
                  {data.phases.reduce((n, p) => n + p.artefacts.filter(a => a.required && a.aiGeneratable !== false).length, 0)} selected
                </span>
              </div>

              <div className="space-y-5">
                {data.phases.map((phase, pi) => {
                  const aiArtefacts = phase.artefacts.filter(a => a.aiGeneratable !== false);
                  const manualArtefacts = phase.artefacts.filter(a => a.aiGeneratable === false);
                  const allSelected = aiArtefacts.every(a => a.required);
                  const noneSelected = aiArtefacts.every(a => !a.required);

                  const toggleAll = (select: boolean) => {
                    const phases = [...data.phases];
                    phases[pi].artefacts = phases[pi].artefacts.map(a =>
                      a.aiGeneratable === false ? a : { ...a, required: select }
                    );
                    upd({ phases });
                  };

                  return (
                    <div key={pi}>
                      {/* Phase header */}
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                            style={{ background: `${g.color}22`, color: g.color }}>{pi + 1}</span>
                          <span className="text-[13px] font-semibold" style={{ color: "var(--foreground)" }}>{phase.name}</span>
                          <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                            · {aiArtefacts.filter(a => a.required).length}/{aiArtefacts.length} selected
                          </span>
                        </div>
                        {/* Quick-select buttons */}
                        {aiArtefacts.length > 1 && (
                          <div className="flex items-center gap-1">
                            <button
                              className="text-[10px] px-2 py-0.5 rounded transition-all"
                              style={{ color: allSelected ? g.color : "var(--muted-foreground)", background: allSelected ? `${g.color}15` : "transparent" }}
                              onClick={() => toggleAll(true)}
                            >All</button>
                            <button
                              className="text-[10px] px-2 py-0.5 rounded transition-all"
                              style={{ color: noneSelected ? "var(--foreground)" : "var(--muted-foreground)", background: noneSelected ? "var(--muted)" : "transparent" }}
                              onClick={() => toggleAll(false)}
                            >None</button>
                          </div>
                        )}
                      </div>

                      {/* AI-generatable artefacts — selectable */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2">
                        {aiArtefacts.map((a, ai) => {
                          const realIdx = phase.artefacts.indexOf(a);
                          const desc = ARTEFACT_DESCRIPTIONS[a.name];
                          return (
                            <label
                              key={ai}
                              className="flex items-start gap-2.5 p-2.5 rounded-[8px] cursor-pointer transition-all select-none"
                              style={{
                                background: a.required ? `${g.color}10` : "hsl(var(--muted)/0.3)",
                                border: `1px solid ${a.required ? g.color + "30" : "hsl(var(--border)/0.5)"}`,
                              }}
                            >
                              {/* Custom checkbox */}
                              <div className="mt-0.5 shrink-0 w-4 h-4 rounded-[4px] flex items-center justify-center transition-all"
                                style={{ background: a.required ? g.color : "transparent", border: `1.5px solid ${a.required ? g.color : "hsl(var(--border))"}` }}>
                                {a.required && (
                                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                                    <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </div>
                              <input type="checkbox" className="hidden" checked={a.required}
                                onChange={() => {
                                  const phases = [...data.phases];
                                  phases[pi].artefacts[realIdx] = { ...a, required: !a.required };
                                  upd({ phases });
                                }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-semibold leading-tight" style={{ color: a.required ? "var(--foreground)" : "var(--muted-foreground)" }}>
                                  {a.name}
                                </p>
                                {desc && (
                                  <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--muted-foreground)" }}>
                                    {desc}
                                  </p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {/* Non-AI artefacts — informational only */}
                      {manualArtefacts.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {manualArtefacts.map((a, ai) => (
                            <span key={ai} className="text-[10px] px-2 py-0.5 rounded-full"
                              style={{ background: "hsl(var(--muted)/0.4)", color: "var(--muted-foreground)", border: "1px dashed hsl(var(--border))" }}
                              title="Created manually — cannot be AI-generated">
                              {a.name} · manual
                            </span>
                          ))}
                        </div>
                      )}

                      {pi < data.phases.length - 1 && (
                        <div className="mt-4 border-t" style={{ borderColor: "hsl(var(--border)/0.4)" }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* ── Phase Gates ── */}
            <Card className="px-5">
              <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Phase Gates</h3>
              <div className="space-y-2">
                {data.phases.map((phase, pi) => (
                  <div key={pi} className="p-3 rounded-[10px] flex items-center gap-3" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${"var(--border)"}33` }}>
                    <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: `${g.color}22`, color: g.color }}>{pi + 1}</span>
                    <span className="text-[12px] font-medium w-28 shrink-0" style={{ color: "var(--foreground)" }}>{phase.name}</span>
                    <input className="flex-1 text-[11px] px-2 py-1 rounded-[6px]" placeholder="Gate criteria..."
                      value={phase.criteria}
                      onChange={e => { const phases = [...data.phases]; phases[pi] = { ...phases[pi], criteria: e.target.value }; upd({ phases }); }}
                      style={{ background: "var(--card)", color: "var(--muted-foreground)", border: `1px solid ${"var(--border)"}44`, outline: "none" }} />
                    <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                      <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Approval</span>
                      <ToggleSwitch checked={phase.approvalRequired} onChange={v => { const phases = [...data.phases]; phases[pi] = { ...phases[pi], approvalRequired: v }; upd({ phases }); }} color={g.color} />
                    </label>
                  </div>
                ))}
              </div>
            </Card>

            {/* HITL Settings */}
            <Card className="px-5">
              <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Human-in-the-Loop Controls</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <HitlToggle label="Phase gate approvals" desc="Require human sign-off at every phase gate" checked={data.hitlePhaseGates} onChange={v => upd({ hitlePhaseGates: v })} color={g.color} />
                <HitlToggle label="Communications approval" desc="Review external stakeholder messages before sending" checked={data.hitleCommsApproval} onChange={v => upd({ hitleCommsApproval: v })} color={g.color} />
                <FieldGroup label="Budget threshold (£)">
                  <StyledInput value={data.hitleBudgetThreshold || autoThreshold} onChange={v => upd({ hitleBudgetThreshold: v })} placeholder={autoThreshold || "e.g. 500"} />
                  <p className="text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>
                    {autoThreshold ? `Auto-set to 10% of budget (£${Number(autoThreshold).toLocaleString()})` : "Approve spend above this amount"}
                  </p>
                </FieldGroup>
                <FieldGroup label="Risk escalation threshold">
                  <select className="w-full px-3 py-2 rounded-[10px] text-[13px]" value={data.hitleRiskThreshold}
                    onChange={e => upd({ hitleRiskThreshold: e.target.value })}
                    style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
                    <option value="all">All risks</option>
                    <option value="high">High + Critical only</option>
                    <option value="critical">Critical only</option>
                  </select>
                </FieldGroup>
                <FieldGroup label="Escalation timeout (hours)">
                  <StyledInput value={data.escalationTimeout} onChange={v => upd({ escalationTimeout: v })} placeholder="24" />
                  <p className="text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>Auto-escalate if no response within this time</p>
                </FieldGroup>
              </div>
            </Card>
          </div>
        )}

        {/* ─── STEP 4: TEAM & STAKEHOLDERS ─── */}
        {step === 3 && (
          <div className="space-y-5">
            <StepHeader title="Team & Stakeholders" subtitle="Add team members and key stakeholders — optional for personal or solo projects" />

            {/* Personal project hint */}
            {(data.category === "personal" || data.category === "travel") && (
              <div className="p-3 rounded-[10px] flex items-center gap-3" style={{ background: `${g.color}08`, border: `1px solid ${g.color}22` }}>
                <span className="text-[18px]">{data.category === "travel" ? "✈️" : "🧑"}</span>
                <div className="flex-1">
                  <p className="text-[12px] font-semibold" style={{ color: g.color }}>Solo / personal project detected</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Team and stakeholder fields are optional. Add yourself or travel companions if you'd like the agent to track responsibilities.</p>
                </div>
              </div>
            )}

            {/* Team */}
            <Card className="px-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Team Members</h3>
                <Button variant="ghost" size="sm" onClick={() => upd({ team: [...data.team, { name: "", email: "", role: (data.category === "travel" || data.category === "personal") ? "Participant" : "PM" }] })}>+ Add Member</Button>
              </div>
              <div className="space-y-2">
                {data.team.map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_120px_32px] gap-2 items-center">
                    <StyledInput value={m.name} placeholder="Name" onChange={v => { const team = [...data.team]; team[i] = { ...m, name: v }; upd({ team }); }} />
                    <StyledInput value={m.email} placeholder="Email" onChange={v => { const team = [...data.team]; team[i] = { ...m, email: v }; upd({ team }); }} />
                    <select className="px-2 py-2 rounded-[10px] text-[12px]" value={m.role}
                      onChange={e => { const team = [...data.team]; team[i] = { ...m, role: e.target.value }; upd({ team }); }}
                      style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[14px] hover:opacity-70"
                      onClick={() => upd({ team: data.team.filter((_, j) => j !== i) })}
                      style={{ color: "#EF4444", background: `${"#EF4444"}11` }}>×</button>
                  </div>
                ))}
              </div>

              {/* Auto RACI */}
              {data.team.length >= 2 && (
                <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
                  <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--muted-foreground)" }}>Auto-Generated RACI Preview</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px]" style={{ color: "var(--foreground)" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${"var(--border)"}33` }}>
                          <th className="text-left py-1 px-2" style={{ color: "var(--muted-foreground)" }}>Activity</th>
                          {data.team.map((m, i) => <th key={i} className="text-center py-1 px-2" style={{ color: "var(--muted-foreground)" }}>{m.name.split(" ")[0] || `Member ${i + 1}`}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {["Project Planning", "Risk Management", "Status Reporting", "Quality Assurance"].map(activity => (
                          <tr key={activity} style={{ borderBottom: `1px solid ${"var(--border)"}11` }}>
                            <td className="py-1 px-2">{activity}</td>
                            {data.team.map((m, i) => (
                              <td key={i} className="text-center py-1 px-2 font-bold" style={{ color: m.role === "PM" ? g.color : m.role === "QA" && activity === "Quality Assurance" ? "#10B981" : "var(--muted-foreground)" }}>
                                {m.role === "PM" ? "R" : m.role === "Sponsor" ? "A" : i === 1 ? "C" : "I"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>

            {/* Stakeholders */}
            <Card className="px-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Key Stakeholders</h3>
                <Button variant="ghost" size="sm" onClick={() => upd({ stakeholders: [...data.stakeholders, { name: "", role: "", org: "", power: 50, interest: 50 }] })}>+ Add Stakeholder</Button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
                <div className="space-y-3">
                  {data.stakeholders.map((s, i) => (
                    <div key={i} className="p-3 rounded-[8px]" style={{ background: true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <StyledInput value={s.name} placeholder="Name" onChange={v => { const stakeholders = [...data.stakeholders]; stakeholders[i] = { ...s, name: v }; upd({ stakeholders }); }} />
                        <StyledInput value={s.role} placeholder="Role" onChange={v => { const stakeholders = [...data.stakeholders]; stakeholders[i] = { ...s, role: v }; upd({ stakeholders }); }} />
                        <StyledInput value={s.org} placeholder="Organisation" onChange={v => { const stakeholders = [...data.stakeholders]; stakeholders[i] = { ...s, org: v }; upd({ stakeholders }); }} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <SliderField label="Power" value={s.power} onChange={v => { const stakeholders = [...data.stakeholders]; stakeholders[i] = { ...s, power: v }; upd({ stakeholders }); }} color={g.color} />
                        <SliderField label="Interest" value={s.interest} onChange={v => { const stakeholders = [...data.stakeholders]; stakeholders[i] = { ...s, interest: v }; upd({ stakeholders }); }} color={g.color} />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Mini grid preview */}
                <div className="p-3 rounded-[10px]" style={{ background: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${"var(--border)"}33` }}>
                  <p className="text-[10px] font-semibold mb-2 text-center" style={{ color: "var(--muted-foreground)" }}>Power / Interest Grid</p>
                  <div className="relative w-full aspect-square rounded-[6px]" style={{ background: `${"var(--border)"}11`, border: `1px solid ${"var(--border)"}33` }}>
                    {/* Quadrant labels */}
                    <span className="absolute top-1 left-1 text-[7px]" style={{ color: "var(--muted-foreground)" }}>Monitor</span>
                    <span className="absolute top-1 right-1 text-[7px]" style={{ color: "var(--muted-foreground)" }}>Manage</span>
                    <span className="absolute bottom-1 left-1 text-[7px]" style={{ color: "var(--muted-foreground)" }}>Inform</span>
                    <span className="absolute bottom-1 right-1 text-[7px]" style={{ color: "var(--muted-foreground)" }}>Engage</span>
                    <div className="absolute top-1/2 left-0 right-0 h-px" style={{ background: `${"var(--border)"}44` }} />
                    <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{ background: `${"var(--border)"}44` }} />
                    {data.stakeholders.filter(s => s.name).map((s, i) => (
                      <div key={i} className="absolute w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white"
                        style={{
                          left: `${s.interest}%`, bottom: `${s.power}%`,
                          transform: "translate(-50%, 50%)",
                          background: g.color,
                        }}
                        title={s.name}>
                        {s.name.charAt(0)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ─── STEP 5: AGENT CONFIGURATION ─── */}
        {step === 4 && (
          <div className="space-y-5">
            <StepHeader title="Agent Configuration" subtitle="Customise your AI Project Manager" />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
              <div className="space-y-4">
                {/* Name + Avatar */}
                <Card className="px-5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-[22px] font-bold text-white"
                      style={{ background: g.gradient, boxShadow: `0 0 20px ${g.color}33` }}>
                      {data.agentName.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <FieldGroup label="Agent Name">
                        <div className="flex gap-2">
                          <StyledInput value={data.agentName} onChange={v => upd({ agentName: v })} />
                          <Button variant="ghost" size="sm" onClick={() => upd({ agentName: AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)] })}>🎲</Button>
                        </div>
                      </FieldGroup>
                    </div>
                  </div>
                  {/* Agent Title */}
                  <FieldGroup label="Agent Title (Role)">
                    <StyledInput value={data.agentTitle || ""} onChange={v => upd({ agentTitle: v })} placeholder="e.g. Senior Project Analyst, Agile Delivery Lead" />
                  </FieldGroup>

                  {/* Domain Tags */}
                  <FieldGroup label="Domain / Specialism Tags">
                    <StyledInput value={data.domainTags || ""} onChange={v => upd({ domainTags: v })} placeholder="e.g. Agile, PRINCE2, Construction, IT Ops (comma-separated)" />
                  </FieldGroup>

                  {/* Default Greeting */}
                  <FieldGroup label="Default Greeting (optional)">
                    <StyledInput value={data.defaultGreeting || ""} onChange={v => upd({ defaultGreeting: v })} placeholder={greetingPlaceholder} />
                    <p className="text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>Auto-generated from project type. Override if needed.</p>
                  </FieldGroup>

                  {/* Monthly Credit Budget */}
                  <FieldGroup label="Monthly Credit Budget">
                    <StyledInput value={data.monthlyBudget || ""} onChange={v => upd({ monthlyBudget: v })} placeholder="e.g. 500 (leave empty for unlimited)" />
                  </FieldGroup>

                  {/* Gradient picker */}
                  <FieldGroup label="Avatar Colour">
                    <div className="flex gap-2">
                      {GRADIENT_PRESETS.map((gp, i) => (
                        <button key={i} className="w-9 h-9 rounded-full transition-all" onClick={() => upd({ agentGradient: i })}
                          style={{
                            background: gp.gradient,
                            outline: data.agentGradient === i ? `3px solid ${gp.color}` : "none",
                            outlineOffset: 2,
                            transform: data.agentGradient === i ? "scale(1.15)" : "scale(1)",
                          }} />
                      ))}
                    </div>
                  </FieldGroup>
                </Card>

                {/* Personality */}
                <Card className="px-5">
                  <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Communication Style</h3>
                  <div className="space-y-4">
                    <SliderField label="Tone" value={data.personalityFormal} onChange={v => upd({ personalityFormal: v })} color={g.color} labelLeft="Formal" labelRight="Friendly" />
                    <SliderField label="Detail" value={data.personalityConcise} onChange={v => upd({ personalityConcise: v })} color={g.color} labelLeft="Concise" labelRight="Detailed" />
                  </div>
                </Card>

                {/* Reporting + Notifications + Integrations */}
                <Card className="px-5">
                  <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Reporting & Integrations</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <FieldGroup label="Report Schedule">
                      <select className="w-full px-3 py-2 rounded-[10px] text-[13px]" value={data.reportSchedule}
                        onChange={e => upd({ reportSchedule: e.target.value })}
                        style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </FieldGroup>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Notification Channels</p>
                      <div className="flex gap-2">
                        <ToggleChip label="Slack" checked={data.notifSlack} onChange={v => upd({ notifSlack: v })} color={g.color} />
                        <ToggleChip label="Email" checked={data.notifEmail} onChange={v => upd({ notifEmail: v })} color={g.color} />
                        <ToggleChip label="Telegram" checked={data.notifTelegram} onChange={v => upd({ notifTelegram: v })} color={g.color} />
                      </div>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Integrations</p>
                      <div className="flex gap-2">
                        <ToggleChip label="🔗 Jira" checked={data.intJira} onChange={v => upd({ intJira: v })} color={g.color} />
                        <ToggleChip label="🐙 GitHub" checked={data.intGithub} onChange={v => upd({ intGithub: v })} color={g.color} />
                        <ToggleChip label="📝 Confluence" checked={data.intConfluence} onChange={v => upd({ intConfluence: v })} color={g.color} />
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* AUTONOMY LEVEL — Right column, the key decision */}
              <div className="space-y-2">
                <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: g.color }}>Autonomy Level</p>
                {AUTONOMY_CARDS.map(al => {
                  const selected = data.autonomyLevel === al.level;
                  return (
                    <div key={al.level} className="rounded-[12px] p-3 cursor-pointer transition-all duration-200"
                      onClick={() => upd({ autonomyLevel: al.level })}
                      style={{
                        background: selected ? `${g.color}10` : "var(--card)",
                        border: selected ? `2px solid ${g.color}` : `1px solid ${"var(--border)"}33`,
                        boxShadow: selected ? `0 4px 16px ${g.color}18` : "none",
                      }}>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map(d => (
                            <div key={d} className="w-2 h-2 rounded-full" style={{ background: d <= al.level ? g.color : `${"var(--border)"}44` }} />
                          ))}
                        </div>
                        <span className="text-[12px] font-bold" style={{ color: selected ? g.color : "var(--foreground)" }}>L{al.level} — {al.name}</span>
                        {al.rec && <Badge variant="outline">Recommended</Badge>}
                      </div>
                      <p className="text-[11px] font-semibold italic mb-1" style={{ color: selected ? g.color : "var(--muted-foreground)" }}>"{al.tagline}"</p>
                      <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{al.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── STEP 6: REVIEW & DEPLOY ─── */}
        {step === 5 && !deployed && (
          <div className="space-y-5">
            <StepHeader title="Review & Deploy" subtitle="Confirm your selections and launch your AI PM" />

            {/* Summary grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SummaryCard title="Project" items={[
                ["Name", data.projectName || "—"],
                ["Client", data.client || "—"],
                ["Dates", `${data.startDate} → ${data.endDate}`],
                ["Budget", `£${Number(data.budget).toLocaleString()}`],
                ["Priority", data.priority],
                ["Category", data.category],
              ]} />
              <SummaryCard title="Methodology" items={[
                ["Framework", METHODOLOGIES.find(m => m.id === data.methodology)?.name || "—"],
                ["Phases", `${data.phases.length} phases`],
                ["HITL Gates", data.hitlePhaseGates ? "Enabled" : "Disabled"],
                ["Budget Threshold", `£${Number(data.hitleBudgetThreshold).toLocaleString()}`],
                ["Escalation", `${data.escalationTimeout}h timeout`],
              ]} />
              <SummaryCard title="Team" items={[
                ["Members", `${data.team.length} people`],
                ["Stakeholders", `${data.stakeholders.length} registered`],
                ...data.team.slice(0, 3).map(m => [m.role, m.name] as [string, string]),
              ]} />
              <SummaryCard title="Agent" items={[
                ["Name", `Agent ${data.agentName}`],
                ["Autonomy", `Level ${data.autonomyLevel} — ${AUTONOMY_CARDS.find(a => a.level === data.autonomyLevel)?.name}`],
                ["Reports", data.reportSchedule],
                ["Channels", [data.notifSlack && "Slack", data.notifEmail && "Email", data.notifTelegram && "Telegram"].filter(Boolean).join(", ") || "None"],
              ]} />
            </div>

            {/* Credit estimate */}
            <Card className="px-5">
              <div className="flex items-center gap-6">
                <div style={{ width: 120, height: 120 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={CREDIT_BREAKDOWN} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={2}>
                        {CREDIT_BREAKDOWN.map(c => <Cell key={c.name} fill={c.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Estimated Monthly Usage</p>
                  <p className="text-[28px] font-bold" style={{ color: g.color }}>~{totalCredits.toLocaleString()} <span className="text-[14px]">credits/month</span></p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-[8px] rounded-full overflow-hidden" style={{ background: `${"var(--border)"}33` }}>
                      <div className="h-full rounded-full" style={{ width: `${(totalCredits / 2000) * 100}%`, background: g.gradient }} />
                    </div>
                    <span className="text-[11px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{Math.round((totalCredits / 2000) * 100)}% of 2,000</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {CREDIT_BREAKDOWN.map(c => (
                      <span key={c.name} className="flex items-center gap-1 text-[9px]" style={{ color: "var(--muted-foreground)" }}>
                        <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />{c.name} ({c.value})
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            {/* Deploy button */}
            {!deploying ? (
              <button className="w-full py-4 rounded-[14px] text-[16px] font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
                onClick={startDeploy}
                style={{ background: g.gradient, boxShadow: `0 8px 32px ${g.color}44` }}>
                🚀 Deploy Agent {data.agentName}
              </button>
            ) : (
              <div className="p-6 rounded-[14px] text-center" style={{ background: `${g.color}08`, border: `1px solid ${g.color}22` }}>
                <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-[28px] font-bold text-white animate-pulse"
                  style={{ background: g.gradient, boxShadow: `0 0 30px ${g.color}44` }}>
                  {data.agentName.charAt(0)}
                </div>
                <p className="text-[14px] font-semibold mb-2" style={{ color: g.color }}>{DEPLOY_STAGES[deployStage]}</p>
                <div className="w-48 mx-auto h-1.5 rounded-full overflow-hidden" style={{ background: `${"var(--border)"}33` }}>
                  <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${((deployStage + 1) / DEPLOY_STAGES.length) * 100}%`, background: g.gradient }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── POST-DEPLOY SUCCESS ─── */}
        {deployed && (
          <div className="text-center py-8">
            <div className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-[32px] font-bold text-white"
              style={{ background: g.gradient, boxShadow: `0 0 40px ${g.color}55` }}>
              {data.agentName.charAt(0)}
            </div>
            <h2 className="text-[22px] font-bold mb-2" style={{ color: "var(--foreground)" }}>Agent {data.agentName} is Live! 🎉</h2>

            {/* Speech bubble */}
            <div className="max-w-[500px] mx-auto mb-6 p-4 rounded-[14px] relative" style={{ background: `${g.color}08`, border: `1px solid ${g.color}22` }}>
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rotate-45" style={{ background: `${g.color}08`, borderTop: `1px solid ${g.color}22`, borderLeft: `1px solid ${g.color}22` }} />
              <p className="text-[13px] leading-relaxed italic" style={{ color: "var(--muted-foreground)" }}>
                "Hello! I'm Agent {data.agentName}, your AI Project Manager for {data.projectName || "your project"}.
                I'm running on {METHODOLOGIES.find(m => m.id === data.methodology)?.name || "your chosen"} methodology at Level {data.autonomyLevel} autonomy.
                I've already started analysing your project parameters and will have your initial artefact templates ready within the hour.
                Let's build something great together!"
              </p>
            </div>

            <div className="flex items-center justify-center gap-3">
              <Button variant="default" size="lg">Go to Dashboard</Button>
              <Button variant="ghost" size="lg">💬 Open Chat</Button>
              <Button variant="ghost" size="lg">View Fleet</Button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ NAVIGATION ═══ */}
      {!deployed && (
        <div className="flex items-center justify-between mt-8 pt-4" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
          {step > 0 && <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>← Back</Button>}
          {step === 0 && <div />}
          <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>Step {step + 1} of {STEP_LABELS.length}</span>
          {step < 5 ? (
            <Button variant="default" size="sm" disabled={!canProceed} onClick={() => setStep(step + 1)}>
              Next →
            </Button>
          ) : (
            <span /> // deploy button is inline above
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function StepHeader({ title, subtitle}: { title: string; subtitle: string;  }) {
  return (
    <div className="mb-2">
      <h2 className="text-[20px] font-bold" style={{ color: "var(--foreground)" }}>{title}</h2>
      <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>{subtitle}</p>
    </div>
  );
}

function FieldGroup({ label, required, children}: { label: string; required?: boolean; children: React.ReactNode;  }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--muted-foreground)" }}>
        {label} {required && <span style={{ color: "#EF4444" }}>*</span>}
      </p>
      {children}
    </div>
  );
}

function StyledInput({ value, onChange, placeholder, type,  }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input type={type || "text"} className="w-full px-3 py-2 rounded-[10px] text-[13px]"
      value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}`, outline: "none" }} />
  );
}

function SelectCard({ selected, onClick, color, children, compact }: {
  selected: boolean; onClick: () => void; color: string; children: React.ReactNode; compact?: boolean;
}) {
  return (
    <button className={`flex flex-col items-center gap-1 ${compact ? "p-2" : "p-3"} rounded-[10px] transition-all duration-200 hover:translate-y-[-1px]`}
      onClick={onClick}
      style={{
        background: selected ? `${color}12` : "var(--card)",
        border: selected ? `2px solid ${color}` : `1px solid ${"var(--border)"}33`,
        boxShadow: selected ? `0 2px 12px ${color}18` : "none",
        color: "var(--foreground)",
      }}>
      {children}
    </button>
  );
}

function ToggleSwitch({ checked, onChange, color}: { checked: boolean; onChange: (v: boolean) => void; color: string;  }) {
  return (
    <button className="w-9 h-5 rounded-full relative transition-all" onClick={() => onChange(!checked)}
      style={{ background: checked ? color : `${"var(--border)"}66` }}>
      <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: checked ? 18 : 2 }} />
    </button>
  );
}

function ToggleChip({ label, checked, onChange, color}: { label: string; checked: boolean; onChange: (v: boolean) => void; color: string;  }) {
  return (
    <button className="px-2.5 py-1 rounded-[6px] text-[11px] font-semibold transition-all" onClick={() => onChange(!checked)}
      style={{
        background: checked ? `${color}22` : "transparent",
        color: checked ? color : "var(--muted-foreground)",
        border: `1px solid ${checked ? color + "44" : "var(--border)" + "44"}`,
      }}>{label}</button>
  );
}

function HitlToggle({ label, desc, checked, onChange, color}: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; color: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{label}</p>
        <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{desc}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} color={color} />
    </div>
  );
}

function SliderField({ label, value, onChange, color, labelLeft, labelRight }: {
  label: string; value: number; onChange: (v: number) => void; color: string; labelLeft?: string; labelRight?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{labelLeft || label}</span>
        {labelRight && <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{labelRight}</span>}
      </div>
      <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ background: `linear-gradient(to right, ${color} ${value}%, ${"var(--border)"}44 ${value}%)` }} />
    </div>
  );
}

function SummaryCard({ title, items,  }: { title: string; items: [string, string][] }) {
  return (
    <Card className="px-5">
      <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>{title}</p>
      <div className="space-y-1">
        {items.map(([k, v], i) => (
          <div key={i} className="flex items-center justify-between text-[12px]">
            <span style={{ color: "var(--muted-foreground)" }}>{k}</span>
            <span className="font-medium" style={{ color: "var(--foreground)" }}>{v}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
