"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ChevronLeft, ChevronRight, Rocket, Dice1, Check } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const STEP_LABELS = ["Project Details", "Methodology", "Phase Gates", "Team", "Agent Config", "Review & Deploy"];

const CATEGORIES = [
  { id: "construction", label: "Construction", icon: "🏗️" },
  { id: "software", label: "Software", icon: "💻" },
  { id: "marketing", label: "Marketing", icon: "📣" },
  { id: "operations", label: "Operations", icon: "⚙️" },
  { id: "research", label: "Research", icon: "🔬" },
  { id: "other", label: "Other", icon: "📁" },
];

const METHODOLOGIES = [
  { id: "scrum", name: "Scrum", icon: "🔄", desc: "Iterative sprints with ceremonies and retrospectives", bestFor: "Software teams needing fast feedback" },
  { id: "kanban", name: "Kanban", icon: "📋", desc: "Continuous flow with WIP limits and visual boards", bestFor: "Support teams, ongoing work" },
  { id: "prince2", name: "PRINCE2", icon: "👑", desc: "Structured stage-gate governance", bestFor: "Regulated industries, formal governance" },
  { id: "waterfall", name: "Waterfall", icon: "🌊", desc: "Sequential phases with fixed scope", bestFor: "Construction, hardware, fixed-requirements" },
  { id: "safe", name: "SAFe", icon: "🏢", desc: "Scaled agile for enterprise coordination", bestFor: "Multiple teams, cross-functional" },
  { id: "hybrid", name: "Hybrid", icon: "⚡", desc: "Predictive governance + agile delivery", bestFor: "Mixed environments" },
];

interface PhaseGate { name: string; artefacts: { name: string; required: boolean }[]; approvalRequired: boolean; criteria: string; }

const PHASE_TEMPLATES: Record<string, PhaseGate[]> = {
  prince2: [
    { name: "Pre-Project", artefacts: [{ name: "Problem Statement", required: true }, { name: "Options Analysis", required: true }, { name: "Business Case", required: true }], approvalRequired: true, criteria: "Business case approved" },
    { name: "Initiation", artefacts: [{ name: "Project Charter", required: true }, { name: "Stakeholder Register", required: true }, { name: "Risk Register", required: false }], approvalRequired: true, criteria: "Charter signed" },
    { name: "Planning", artefacts: [{ name: "WBS", required: true }, { name: "Schedule", required: true }, { name: "Risk Plan", required: true }], approvalRequired: true, criteria: "Baselines approved" },
    { name: "Execution", artefacts: [{ name: "Status Reports", required: true }, { name: "Risk Reviews", required: true }], approvalRequired: false, criteria: "Quality met" },
    { name: "Closing", artefacts: [{ name: "Acceptance Certificate", required: true }, { name: "Lessons Learned", required: true }], approvalRequired: true, criteria: "All accepted" },
  ],
  scrum: [
    { name: "Sprint Zero", artefacts: [{ name: "Product Vision", required: true }, { name: "Backlog", required: true }], approvalRequired: true, criteria: "Vision agreed" },
    { name: "Sprint Cadence", artefacts: [{ name: "Sprint Plans", required: true }, { name: "Reviews", required: true }], approvalRequired: false, criteria: "DoD met" },
    { name: "Release", artefacts: [{ name: "Release Plan", required: true }], approvalRequired: true, criteria: "Acceptance met" },
  ],
  kanban: [
    { name: "Setup", artefacts: [{ name: "Board Config", required: true }, { name: "WIP Policies", required: true }], approvalRequired: true, criteria: "Policies agreed" },
    { name: "Continuous Delivery", artefacts: [{ name: "Flow Metrics", required: true }], approvalRequired: false, criteria: "Within SLA" },
  ],
  waterfall: [
    { name: "Requirements", artefacts: [{ name: "Requirements Spec", required: true }], approvalRequired: true, criteria: "Signed off" },
    { name: "Design", artefacts: [{ name: "Design Document", required: true }, { name: "Architecture", required: true }], approvalRequired: true, criteria: "Design approved" },
    { name: "Build", artefacts: [{ name: "Code", required: true }, { name: "Tests", required: true }], approvalRequired: false, criteria: "Tests passing" },
    { name: "Test", artefacts: [{ name: "Test Plan", required: true }, { name: "Results", required: true }], approvalRequired: true, criteria: "Defects resolved" },
    { name: "Deploy", artefacts: [{ name: "Release Plan", required: true }], approvalRequired: true, criteria: "Go-live approved" },
  ],
  safe: [
    { name: "PI Planning", artefacts: [{ name: "PI Objectives", required: true }], approvalRequired: true, criteria: "Objectives committed" },
    { name: "Iteration Cadence", artefacts: [{ name: "Demos", required: true }], approvalRequired: false, criteria: "Increment delivered" },
    { name: "Inspect & Adapt", artefacts: [{ name: "PI Report", required: true }], approvalRequired: true, criteria: "Improvements prioritised" },
  ],
  hybrid: [
    { name: "Foundation", artefacts: [{ name: "Charter", required: true }, { name: "Roadmap", required: true }], approvalRequired: true, criteria: "Approach approved" },
    { name: "Planning", artefacts: [{ name: "WBS", required: true }, { name: "Backlog", required: true }], approvalRequired: true, criteria: "Baselined" },
    { name: "Iterative Delivery", artefacts: [{ name: "Sprint Plans", required: true }], approvalRequired: false, criteria: "Acceptance met" },
    { name: "Closure", artefacts: [{ name: "Lessons Learned", required: true }], approvalRequired: true, criteria: "All accepted" },
  ],
};

const GRADIENTS = [
  { gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#6366F1" },
  { gradient: "linear-gradient(135deg, #22D3EE, #06B6D4)", color: "#22D3EE" },
  { gradient: "linear-gradient(135deg, #10B981, #34D399)", color: "#10B981" },
  { gradient: "linear-gradient(135deg, #F97316, #FB923C)", color: "#F97316" },
  { gradient: "linear-gradient(135deg, #EC4899, #F472B6)", color: "#EC4899" },
  { gradient: "linear-gradient(135deg, #8B5CF6, #A78BFA)", color: "#8B5CF6" },
];

const AUTONOMY_CARDS = [
  { level: 1, name: "Assistant", tagline: "I suggest, you decide", desc: "Responds when asked. No proactive actions.", rec: false },
  { level: 2, name: "Advisor", tagline: "I draft, you approve everything", desc: "Monitors and drafts, but every action needs approval.", rec: false },
  { level: 3, name: "Co-pilot", tagline: "I handle routine, escalate important", desc: "Routine tasks autonomous. Escalates above thresholds.", rec: true },
  { level: 4, name: "Autonomous", tagline: "I run the project, you review outcomes", desc: "Most decisions independent. Weekly summaries + exceptions.", rec: false },
  { level: 5, name: "Strategic", tagline: "End-to-end, minimal oversight", desc: "Full autonomy within governance. Self-correcting.", rec: false },
];

const AGENT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Falcon", "Griffin", "Hawk", "Iris", "Jade"];
const TEAM_ROLES = ["PM", "Dev", "QA", "BA", "Architect", "Sponsor", "Designer", "Tech Lead"];

const CREDIT_BREAKDOWN = [
  { name: "Documents", value: 420, color: "#6366F1" }, { name: "Risk analysis", value: 240, color: "#22D3EE" },
  { name: "Meetings", value: 180, color: "#10B981" }, { name: "Reports", value: 160, color: "#F59E0B" },
  { name: "Comms", value: 120, color: "#EC4899" }, { name: "Other", value: 80, color: "#64748B" },
];

const DEPLOY_STAGES = ["Initialising agent runtime...", "Connecting to project integrations...", "Analysing project parameters...", "Building methodology framework...", "Generating initial templates...", "Agent deployed successfully!"];

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

interface WizardState {
  projectName: string; description: string; client: string; startDate: string; endDate: string; budget: string;
  priority: string; category: string; methodology: string; phases: PhaseGate[];
  hitlePhaseGates: boolean; hitleBudget: boolean; hitleComms: boolean; escalationTimeout: string;
  team: { name: string; email: string; role: string }[];
  agentName: string; agentGradient: number; personalityFormal: number; personalityConcise: number;
  autonomyLevel: number; notifSlack: boolean; notifEmail: boolean; reportSchedule: string;
}

const INIT: WizardState = {
  projectName: "", description: "", client: "", startDate: "2026-04-15", endDate: "2026-10-30", budget: "250000",
  priority: "high", category: "software", methodology: "", phases: [],
  hitlePhaseGates: true, hitleBudget: true, hitleComms: true, escalationTimeout: "24",
  team: [{ name: "Sarah Chen", email: "sarah@atlas.com", role: "PM" }],
  agentName: AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)],
  agentGradient: 0, personalityFormal: 35, personalityConcise: 50,
  autonomyLevel: 3, notifSlack: true, notifEmail: true, reportSchedule: "weekly",
};

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function DeployAgentPage() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardState>(INIT);
  const [deploying, setDeploying] = useState(false);
  const [deployStage, setDeployStage] = useState(0);
  const [deployed, setDeployed] = useState(false);

  const upd = (patch: Partial<WizardState>) => setData(prev => ({ ...prev, ...patch }));
  const g = GRADIENTS[data.agentGradient];

  useEffect(() => {
    if (data.methodology && PHASE_TEMPLATES[data.methodology]) {
      upd({ phases: PHASE_TEMPLATES[data.methodology].map(p => ({ ...p, artefacts: p.artefacts.map(a => ({ ...a })) })) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.methodology]);

  const recommended = useMemo(() => {
    if (data.category === "software") return "scrum";
    if (data.category === "construction") return "waterfall";
    if (data.category === "marketing") return "kanban";
    return "hybrid";
  }, [data.category]);

  const canProceed = useMemo(() => {
    if (step === 0) return data.projectName.length > 2;
    if (step === 1) return !!data.methodology;
    if (step === 2) return data.phases.length > 0;
    if (step === 3) return data.team.length > 0;
    if (step === 4) return data.agentName.length > 0;
    return true;
  }, [step, data]);

  const startDeploy = async () => {
    setDeploying(true); setDeployStage(0);

    try {
      // Stage 1: Create project
      setDeployStage(0);
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.projectName, description: data.description, client: data.client,
          methodology: data.methodology?.toUpperCase().replace("-", "_") || "WATERFALL",
          startDate: data.startDate, endDate: data.endDate,
          budget: data.budget ? parseFloat(data.budget) : undefined,
          priority: data.priority, category: data.category,
        }),
      });
      const projData = await projRes.json();
      if (!projRes.ok) throw new Error(projData.error || "Failed to create project");

      // Stage 2: Create agent
      setDeployStage(1);
      await new Promise(r => setTimeout(r, 800));
      const agentRes = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.agentName, autonomyLevel: data.autonomyLevel,
          personality: { formal: data.personalityFormal, concise: data.personalityConcise },
          gradient: GRADIENTS[data.agentGradient]?.gradient,
        }),
      });
      const agentData2 = await agentRes.json();
      if (!agentRes.ok) throw new Error(agentData2.error || "Failed to create agent");

      // Stage 3-4: Deploy agent to project
      setDeployStage(2);
      await new Promise(r => setTimeout(r, 800));
      setDeployStage(3);
      const deployRes = await fetch(`/api/agents/${agentData2.data.id}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projData.data.id,
          config: { methodology: data.methodology, hitl: { phaseGates: data.hitlePhaseGates, budget: data.hitleBudget, comms: data.hitleComms }, escalationTimeout: data.escalationTimeout },
        }),
      });
      if (!deployRes.ok) { const err = await deployRes.json(); throw new Error(err.error || "Deploy failed"); }

      // Stage 5: Complete
      setDeployStage(4);
      await new Promise(r => setTimeout(r, 800));
      setDeployStage(5);
      await new Promise(r => setTimeout(r, 600));
      setDeployed(true);
    } catch (e: any) {
      alert(`Deployment failed: ${e.message}`);
    }

    setDeploying(false);
  };

  const totalCredits = CREDIT_BREAKDOWN.reduce((s, c) => s + c.value, 0);

  return (
    <div className="max-w-[960px] mx-auto pb-12">
      {/* Progress bar */}
      {!deployed && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {STEP_LABELS.map((label, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                  i < step ? "bg-green-500 text-white" : i === step ? "text-white shadow-lg" : "bg-muted text-muted-foreground"
                }`} style={i === step ? { background: g.color, boxShadow: `0 0 12px ${g.color}44` } : undefined}>
                  {i < step ? "✓" : i + 1}
                </div>
                <span className={`text-[11px] font-semibold hidden sm:inline ${i === step ? "" : "text-muted-foreground"}`}>{label}</span>
              </div>
            ))}
          </div>
          <div className="h-1.5 rounded-full overflow-hidden flex gap-1 bg-muted/30">
            {STEP_LABELS.map((_, i) => (
              <div key={i} className="flex-1 rounded-full transition-all duration-500" style={{
                background: i < step ? "#10B981" : i === step ? g.color : "transparent",
                opacity: i <= step ? 1 : 0.2,
              }} />
            ))}
          </div>
        </div>
      )}

      {/* STEP 1: PROJECT DETAILS */}
      {step === 0 && (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold">Project Details</h2><p className="text-sm text-muted-foreground">Tell us about your project</p></div>
          <Card>
            <CardContent className="pt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Project Name *</label><Input value={data.projectName} onChange={e => upd({ projectName: e.target.value })} placeholder="e.g. CRM Migration" className="mt-1" /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Client</label><Input value={data.client} onChange={e => upd({ client: e.target.value })} placeholder="Atlas Corp" className="mt-1" /></div>
              <div className="md:col-span-2"><label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</label><textarea className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-background border border-input resize-none" rows={3} value={data.description} onChange={e => upd({ description: e.target.value })} placeholder="Brief description..." /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Start Date</label><Input type="date" value={data.startDate} onChange={e => upd({ startDate: e.target.value })} className="mt-1" /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">End Date</label><Input type="date" value={data.endDate} onChange={e => upd({ endDate: e.target.value })} className="mt-1" /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Budget ($)</label><Input type="number" value={data.budget} onChange={e => upd({ budget: e.target.value })} className="mt-1" /></div>
            </CardContent>
          </Card>
          <div><label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</label>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-2">
              {CATEGORIES.map(c => (
                <button key={c.id} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${data.category === c.id ? "border-primary shadow-md shadow-primary/10" : "border-border/30"}`}
                  style={data.category === c.id ? { background: `${g.color}10` } : undefined}
                  onClick={() => upd({ category: c.id })}>
                  <span className="text-xl">{c.icon}</span><span className="text-[11px] font-semibold">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
          {/* AI suggestion */}
          <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-white font-bold text-xs">AI</div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-primary">AI Recommendation</p>
              <p className="text-[11px] text-muted-foreground">Based on {data.category} category, we recommend <strong>{METHODOLOGIES.find(m => m.id === recommended)?.name}</strong></p>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: METHODOLOGY */}
      {step === 1 && (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold">Choose Methodology</h2><p className="text-sm text-muted-foreground">Select the delivery framework</p></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {METHODOLOGIES.map(m => (
              <Card key={m.id} className={`cursor-pointer transition-all hover:-translate-y-0.5 ${data.methodology === m.id ? "border-2 border-primary shadow-lg shadow-primary/10" : ""}`}
                onClick={() => upd({ methodology: m.id })}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">{m.icon}</span>
                    {m.id === recommended && <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[9px]">Recommended</Badge>}
                    {data.methodology === m.id && <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"><Check className="w-3 h-3 text-white" /></span>}
                  </div>
                  <p className="text-[15px] font-bold mb-1">{m.name}</p>
                  <p className="text-xs text-muted-foreground mb-2">{m.desc}</p>
                  <p className="text-[10px] text-muted-foreground/70">Best for: {m.bestFor}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* STEP 3: PHASE GATES */}
      {step === 2 && (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold">Phase Gates & Governance</h2><p className="text-sm text-muted-foreground">Configure lifecycle stages and HITL controls</p></div>
          <Card>
            <CardHeader><CardTitle className="text-sm">Lifecycle Phases</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.phases.map((phase, pi) => (
                <div key={pi} className="p-3 rounded-xl bg-muted/30 border border-border/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center bg-primary/20 text-primary">{pi + 1}</span>
                      <span className="text-sm font-semibold">{phase.name}</span>
                    </div>
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                      Approval
                      <button className={`w-8 h-4 rounded-full relative transition-all ${phase.approvalRequired ? "bg-primary" : "bg-border"}`}
                        onClick={() => { const p = [...data.phases]; p[pi] = { ...p[pi], approvalRequired: !p[pi].approvalRequired }; upd({ phases: p }); }}>
                        <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all" style={{ left: phase.approvalRequired ? 15 : 2 }} />
                      </button>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {phase.artefacts.map((a, ai) => (
                      <button key={ai} className={`text-[10px] font-medium px-2 py-1 rounded-md border transition-all ${a.required ? "border-primary/30 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground"}`}
                        onClick={() => { const p = [...data.phases]; p[pi].artefacts[ai] = { ...a, required: !a.required }; upd({ phases: p }); }}>
                        {a.required ? "☑" : "☐"} {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">HITL Controls</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ToggleRow label="Phase gate approvals" checked={data.hitlePhaseGates} onChange={v => upd({ hitlePhaseGates: v })} />
              <ToggleRow label="Budget change approvals" checked={data.hitleBudget} onChange={v => upd({ hitleBudget: v })} />
              <ToggleRow label="Communications approval" checked={data.hitleComms} onChange={v => upd({ hitleComms: v })} />
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Escalation Timeout</label>
                <select className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-background border border-input" value={data.escalationTimeout} onChange={e => upd({ escalationTimeout: e.target.value })}>
                  <option value="1">1 hour</option><option value="4">4 hours</option><option value="24">24 hours</option>
                </select>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 4: TEAM */}
      {step === 3 && (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold">Team & Stakeholders</h2><p className="text-sm text-muted-foreground">Add team members</p></div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Team Members</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => upd({ team: [...data.team, { name: "", email: "", role: "Dev" }] })}>+ Add</Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.team.map((m, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_100px_32px] gap-2 items-center">
                  <Input value={m.name} placeholder="Name" onChange={e => { const t = [...data.team]; t[i] = { ...m, name: e.target.value }; upd({ team: t }); }} />
                  <Input value={m.email} placeholder="Email" onChange={e => { const t = [...data.team]; t[i] = { ...m, email: e.target.value }; upd({ team: t }); }} />
                  <select className="px-2 py-2 rounded-lg text-xs bg-background border border-input" value={m.role}
                    onChange={e => { const t = [...data.team]; t[i] = { ...m, role: e.target.value }; upd({ team: t }); }}>
                    {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0" onClick={() => upd({ team: data.team.filter((_, j) => j !== i) })}>×</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 5: AGENT CONFIG */}
      {step === 4 && (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold">Agent Configuration</h2><p className="text-sm text-muted-foreground">Customise your AI Project Manager</p></div>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white" style={{ background: g.gradient, boxShadow: `0 0 20px ${g.color}33` }}>
                      {data.agentName.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Agent Name</label>
                      <div className="flex gap-2 mt-1">
                        <Input value={data.agentName} onChange={e => upd({ agentName: e.target.value })} />
                        <Button variant="outline" size="sm" onClick={() => upd({ agentName: AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)] })}><Dice1 className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  </div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avatar Colour</label>
                  <div className="flex gap-3 mt-2">
                    {GRADIENTS.map((gp, i) => (
                      <button key={i} className="w-9 h-9 rounded-full transition-all" onClick={() => upd({ agentGradient: i })}
                        style={{ background: gp.gradient, outline: data.agentGradient === i ? `3px solid ${gp.color}` : "none", outlineOffset: 3, transform: data.agentGradient === i ? "scale(1.15)" : "scale(1)" }} />
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Communication Style</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <SliderRow label="Tone" left="Formal" right="Friendly" value={data.personalityFormal} onChange={v => upd({ personalityFormal: v })} color={g.color} />
                  <SliderRow label="Detail" left="Concise" right="Detailed" value={data.personalityConcise} onChange={v => upd({ personalityConcise: v })} color={g.color} />
                </CardContent>
              </Card>
            </div>
            {/* Autonomy */}
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-primary">Autonomy Level</p>
              {AUTONOMY_CARDS.map(al => {
                const sel = data.autonomyLevel === al.level;
                return (
                  <button key={al.level} className={`w-full text-left rounded-xl p-3 transition-all border ${sel ? "border-primary shadow-md shadow-primary/10" : "border-border/30"}`}
                    onClick={() => upd({ autonomyLevel: al.level })}
                    style={sel ? { background: `${g.color}10` } : undefined}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex gap-0.5">{[1, 2, 3, 4, 5].map(d => <div key={d} className="w-2 h-2 rounded-full" style={{ background: d <= al.level ? g.color : "var(--border)" }} />)}</div>
                      <span className={`text-xs font-bold ${sel ? "text-primary" : ""}`}>L{al.level} — {al.name}</span>
                      {al.rec && <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[8px]">Recommended</Badge>}
                    </div>
                    <p className="text-[11px] italic mb-1" style={{ color: sel ? g.color : "var(--muted-foreground)" }}>"{al.tagline}"</p>
                    <p className="text-[10px] text-muted-foreground">{al.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* STEP 6: REVIEW & DEPLOY */}
      {step === 5 && !deployed && (
        <div className="space-y-5">
          <div><h2 className="text-xl font-bold">Review & Deploy</h2><p className="text-sm text-muted-foreground">Confirm and launch your AI PM</p></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SummaryCard title="Project" items={[["Name", data.projectName || "—"], ["Client", data.client || "—"], ["Budget", `$${Number(data.budget).toLocaleString()}`], ["Category", data.category]]} />
            <SummaryCard title="Methodology" items={[["Framework", METHODOLOGIES.find(m => m.id === data.methodology)?.name || "—"], ["Phases", `${data.phases.length}`], ["HITL", data.hitlePhaseGates ? "Enabled" : "Disabled"]]} />
            <SummaryCard title="Team" items={[["Members", `${data.team.length}`], ...data.team.slice(0, 3).map(m => [m.role, m.name] as [string, string])]} />
            <SummaryCard title="Agent" items={[["Name", `Agent ${data.agentName}`], ["Autonomy", `L${data.autonomyLevel} — ${AUTONOMY_CARDS.find(a => a.level === data.autonomyLevel)?.name}`], ["Reports", data.reportSchedule]]} />
          </div>
          {/* Credit estimate */}
          <Card>
            <CardContent className="pt-5 flex items-center gap-6">
              <div style={{ width: 120, height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={CREDIT_BREAKDOWN} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={2}>
                    {CREDIT_BREAKDOWN.map(c => <Cell key={c.name} fill={c.color} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground">Estimated Monthly Usage</p>
                <p className="text-3xl font-bold" style={{ color: g.color }}>~{totalCredits.toLocaleString()} <span className="text-sm">credits/month</span></p>
                <Progress value={(totalCredits / 2000) * 100} className="h-2 mt-2" />
                <span className="text-xs text-muted-foreground">{Math.round((totalCredits / 2000) * 100)}% of 2,000 monthly credits</span>
              </div>
            </CardContent>
          </Card>
          {/* Deploy button */}
          {!deploying ? (
            <button className="w-full py-4 rounded-2xl text-base font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
              onClick={startDeploy} style={{ background: g.gradient, boxShadow: `0 8px 32px ${g.color}44` }}>
              <Rocket className="w-5 h-5" /> Deploy Agent {data.agentName}
            </button>
          ) : (
            <div className="p-6 rounded-2xl text-center border border-primary/20 bg-primary/5">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-white animate-pulse" style={{ background: g.gradient, boxShadow: `0 0 30px ${g.color}44` }}>
                {data.agentName.charAt(0)}
              </div>
              <p className="text-sm font-semibold mb-2" style={{ color: g.color }}>{DEPLOY_STAGES[deployStage]}</p>
              <Progress value={((deployStage + 1) / DEPLOY_STAGES.length) * 100} className="h-1.5 w-48 mx-auto" />
            </div>
          )}
        </div>
      )}

      {/* POST-DEPLOY SUCCESS */}
      {deployed && (
        <div className="text-center py-8">
          <div className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-3xl font-bold text-white"
            style={{ background: g.gradient, boxShadow: `0 0 40px ${g.color}55` }}>{data.agentName.charAt(0)}</div>
          <h2 className="text-2xl font-bold mb-2">Agent {data.agentName} is Live! 🎉</h2>
          <div className="max-w-[500px] mx-auto mb-6 p-4 rounded-2xl bg-primary/5 border border-primary/20 text-left">
            <p className="text-sm italic text-muted-foreground">
              "Hello! I'm Agent {data.agentName}, your AI Project Manager for {data.projectName || "your project"}.
              I've already started analysing parameters and will have initial templates ready within the hour."
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <Link href="/dashboard"><Button size="lg">Go to Dashboard</Button></Link>
            <Link href="/agents/chat"><Button variant="outline" size="lg">💬 Open Chat</Button></Link>
            <Link href="/agents"><Button variant="outline" size="lg">View Fleet</Button></Link>
          </div>
        </div>
      )}

      {/* Navigation */}
      {!deployed && (
        <div className="flex items-center justify-between mt-8 pt-4 border-t border-border/30">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
          <span className="text-xs text-muted-foreground">Step {step + 1} of {STEP_LABELS.length}</span>
          {step < 5 ? (
            <Button disabled={!canProceed} onClick={() => setStep(step + 1)}>Next <ChevronRight className="w-4 h-4 ml-1" /></Button>
          ) : <span />}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold">{label}</span>
      <button className={`w-9 h-5 rounded-full relative transition-all ${checked ? "bg-primary" : "bg-border"}`} onClick={() => onChange(!checked)}>
        <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: checked ? 18 : 2 }} />
      </button>
    </div>
  );
}

function SliderRow({ label, left, right, value, onChange, color }: { label: string; left: string; right: string; value: number; onChange: (v: number) => void; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-muted-foreground">{left}</span>
        <span className="text-[10px] font-semibold text-muted-foreground">{right}</span>
      </div>
      <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-border accent-primary" />
    </div>
  );
}

function SummaryCard({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <Card><CardContent className="pt-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      <div className="space-y-1">
        {items.map(([k, v], i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
      </div>
    </CardContent></Card>
  );
}
