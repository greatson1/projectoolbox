"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectRisks } from "@/hooks/use-api";
import { toast } from "sonner";
import {
  Plus, AlertTriangle, Shield, TrendingDown, Download,
  Pencil, X, Check, Loader2, ChevronDown, ChevronUp, Trash2,
  Siren, Mail, Lock,
} from "lucide-react";
import { downloadCSV } from "@/lib/export-csv";

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  OPEN: "destructive", MITIGATING: "secondary", WATCHING: "outline", CLOSED: "default",
};

const STATUSES = ["OPEN", "WATCHING", "MITIGATING", "CLOSED", "ESCALATED"];
const CATEGORIES = ["Technical", "Financial", "Schedule", "Resource", "Stakeholder", "Legal", "External", "Other"];

const STRATEGIES = ["AVOID", "REDUCE", "TRANSFER", "ACCEPT", "CONTINGENCY", "ESCALATE"] as const;
type Strategy = typeof STRATEGIES[number];

const STRATEGY_META: Record<Strategy, { label: string; colour: string; hint: string }> = {
  AVOID:       { label: "Avoid",       colour: "bg-red-500/15 text-red-600 border-red-500/30",       hint: "Eliminate the risk by changing the plan" },
  REDUCE:      { label: "Reduce",      colour: "bg-amber-500/15 text-amber-600 border-amber-500/30", hint: "Lower probability or impact" },
  TRANSFER:    { label: "Transfer",    colour: "bg-blue-500/15 text-blue-600 border-blue-500/30",    hint: "Shift risk via insurance or outsourcing" },
  ACCEPT:      { label: "Accept",      colour: "bg-green-500/15 text-green-600 border-green-500/30", hint: "Acknowledge and monitor" },
  CONTINGENCY: { label: "Contingency", colour: "bg-purple-500/15 text-purple-600 border-purple-500/30", hint: "Plan B if risk materialises" },
  ESCALATE:    { label: "Escalate",    colour: "bg-rose-500/15 text-rose-600 border-rose-500/30",    hint: "Raise to higher authority" },
};

const ACTION_STATUS_CYCLE: Record<string, string> = {
  PLANNED: "IN_PROGRESS", IN_PROGRESS: "DONE", DONE: "PLANNED",
};
const ACTION_STATUS_STYLE: Record<string, string> = {
  PLANNED:     "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-amber-500/15 text-amber-600",
  DONE:        "bg-green-500/15 text-green-600",
  CANCELLED:   "bg-red-500/15 text-red-500 line-through",
};

// ── Types ──────────────────────────────────────────────────────────────────

type ResponseAction = {
  id: string;
  type?: "ACTION" | "ESCALATION" | "STAKEHOLDER_RESPONSE";
  strategy?: Strategy;
  action?: string;
  owner?: string | null;
  ownerEmail?: string | null;
  dueDate?: string | null;
  status?: string;
  notes?: string | null;
  createdAt: string;
  // Escalation-specific
  escalatedAt?: string;
  escalatedBy?: string;
  recipients?: string[];
  failedRecipients?: string[];
  subject?: string;
  emailPreview?: string;
  // Stakeholder response-specific
  respondedAt?: string;
  respondedBy?: string;
  comment?: string | null;
  source?: string;
};

type Risk = {
  id: string;
  title: string;
  description?: string | null;
  probability: number;
  impact: number;
  score?: number | null;
  status: string;
  category?: string | null;
  owner?: string | null;
  mitigation?: string | null;
  responseLog?: ResponseAction[] | null;
};

type RiskForm = Omit<Risk, "id" | "score" | "responseLog">;

function scoreColour(score: number) {
  return score >= 15 ? "text-destructive" : score >= 8 ? "text-amber-500" : "text-green-500";
}

// ── Component ──────────────────────────────────────────────────────────────

export default function RiskRegisterPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: risks, isLoading } = useProjectRisks(projectId);
  const qc = useQueryClient();

  const [view, setView] = useState<"matrix" | "table">("table");
  const [selectedRisk, setSelectedRisk] = useState<Risk | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RiskForm>({
    title: "", description: "", probability: 3, impact: 3,
    status: "OPEN", category: "", owner: "", mitigation: "",
  });

  // Response action form state
  const [addingAction, setAddingAction] = useState(false);
  const [actionForm, setActionForm] = useState({
    strategy: "REDUCE" as Strategy,
    actionText: "",
    owner: "",
    ownerEmail: "",
    dueDate: "",
    notes: "",
  });
  const [actionSaving, setActionSaving] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(true);

  // Escalation state
  const [escalating, setEscalating] = useState(false);
  const [escalationSending, setEscalationSending] = useState(false);
  const [escalationForm, setEscalationForm] = useState({
    recipients: "",   // comma-separated emails
    customMessage: "",
  });
  const [escalationResult, setEscalationResult] = useState<{ sent: string[]; failed: string[]; subject: string } | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function patchRisk(body: Record<string, any>) {
    const res = await fetch(`/api/projects/${projectId}/risks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Request failed");
    return (await res.json()).data as Risk;
  }

  function startEdit(r: Risk) {
    setForm({
      title: r.title ?? "",
      description: r.description ?? "",
      probability: r.probability,
      impact: r.impact,
      status: r.status,
      category: r.category ?? "",
      owner: r.owner ?? "",
      mitigation: r.mitigation ?? "",
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!selectedRisk) return;
    setSaving(true);
    try {
      const updated = await patchRisk({ riskId: selectedRisk.id, ...form });
      setSelectedRisk({ ...updated, responseLog: selectedRisk.responseLog });
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["risks", projectId] });
      toast.success("Risk updated");
    } catch {
      toast.error("Failed to save risk");
    } finally {
      setSaving(false);
    }
  }

  async function addResponseAction() {
    if (!selectedRisk || !actionForm.actionText.trim()) return;
    setActionSaving(true);
    try {
      const updated = await patchRisk({
        riskId: selectedRisk.id,
        action: "add-response-action",
        strategy: actionForm.strategy,
        actionText: actionForm.actionText.trim(),
        owner: actionForm.owner.trim() || null,
        ownerEmail: actionForm.ownerEmail.trim() || null,
        dueDate: actionForm.dueDate || null,
        notes: actionForm.notes.trim() || null,
      });
      setSelectedRisk(updated);
      setActionForm({ strategy: "REDUCE", actionText: "", owner: "", ownerEmail: "", dueDate: "", notes: "" });
      setAddingAction(false);
      qc.invalidateQueries({ queryKey: ["risks", projectId] });
      toast.success("Response action added");
    } catch {
      toast.error("Failed to add action");
    } finally {
      setActionSaving(false);
    }
  }

  async function cycleActionStatus(actionId: string, currentStatus: string) {
    if (!selectedRisk) return;
    const nextStatus = ACTION_STATUS_CYCLE[currentStatus] ?? "PLANNED";
    try {
      const updated = await patchRisk({
        riskId: selectedRisk.id,
        action: "update-response-action",
        actionId,
        patch: { status: nextStatus },
      });
      setSelectedRisk(updated);
      qc.invalidateQueries({ queryKey: ["risks", projectId] });
    } catch {
      toast.error("Failed to update action");
    }
  }

  async function deleteResponseAction(actionId: string) {
    if (!selectedRisk) return;
    try {
      const updated = await patchRisk({
        riskId: selectedRisk.id,
        action: "delete-response-action",
        actionId,
      });
      setSelectedRisk(updated);
      qc.invalidateQueries({ queryKey: ["risks", projectId] });
      toast.success("Action removed");
    } catch {
      toast.error("Failed to remove action");
    }
  }

  async function sendEscalation() {
    if (!selectedRisk) return;
    const emails = escalationForm.recipients
      .split(/[\n,;]+/)
      .map(e => e.trim())
      .filter(e => e.includes("@"));

    if (emails.length === 0) {
      toast.error("Add at least one valid email address");
      return;
    }
    setEscalationSending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/risks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riskId: selectedRisk.id,
          action: "escalate",
          recipients: emails,
          customMessage: escalationForm.customMessage.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setSelectedRisk(json.data);
      setEscalationResult({ sent: json.emailsSent ?? [], failed: json.emailsFailed ?? [], subject: json.subject });
      qc.invalidateQueries({ queryKey: ["risks", projectId] });
      toast.success(`Escalation sent to ${(json.emailsSent ?? []).length} recipient(s)`);
    } catch {
      toast.error("Escalation failed — check Resend is configured");
    } finally {
      setEscalationSending(false);
    }
  }

  function openEscalation(r: Risk) {
    // Pre-populate with known email addresses from response log
    const log = (r.responseLog as any[]) ?? [];
    const knownEmails = [
      ...(r.owner?.includes("@") ? [r.owner] : []),
      ...log.filter((e: any) => e.ownerEmail).map((e: any) => e.ownerEmail),
    ];
    const unique = [...new Set(knownEmails)];
    setEscalationForm({ recipients: unique.join("\n"), customMessage: "" });
    setEscalationResult(null);
    setEscalating(true);
  }

  async function quickAdd() {
    const t = prompt("Risk title:");
    if (!t) return;
    try {
      await fetch(`/api/projects/${projectId}/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, probability: 3, impact: 3, status: "OPEN" }),
      });
      qc.invalidateQueries({ queryKey: ["risks", projectId] });
      toast.success("Risk added");
    } catch {
      toast.error("Failed to add risk");
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const items: Risk[] = risks || [];
  const highRisks = items.filter(r => (r.score ?? r.probability * r.impact) >= 15).length;
  const mitigating = items.filter(r => r.status === "MITIGATING").length;
  const avgScore = items.length > 0
    ? (items.reduce((s, r) => s + (r.score ?? r.probability * r.impact), 0) / items.length).toFixed(1)
    : "0";

  const responseLog: ResponseAction[] = (selectedRisk?.responseLog as any) ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-[1400px]">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Risk Register</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length} risks · {highRisks} critical · {mitigating} mitigating
          </p>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => {
              const rows: (string | number | null | undefined)[][] = [
                ["Title", "Category", "Probability", "Impact", "Score", "Status", "Owner", "Mitigation"],
                ...items.map(r => [r.title, r.category, r.probability, r.impact, r.score ?? r.probability * r.impact, r.status, r.owner, r.mitigation]),
              ];
              downloadCSV(rows, `risk-register-${projectId}.csv`);
            }}>
              <Download className="w-3.5 h-3.5 mr-1" /> Download CSV
            </Button>
          )}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["matrix", "table"] as const).map(v => (
              <button key={v}
                className={`px-3 py-1.5 text-xs font-semibold capitalize ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
          <Button size="sm" onClick={quickAdd}><Plus className="w-4 h-4 mr-1" /> Add Risk</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p><p className="text-2xl font-bold">{items.length}</p></div><AlertTriangle className="w-5 h-5 text-primary" /></div></Card>
        <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Critical</p><p className="text-2xl font-bold text-destructive">{highRisks}</p></div><Shield className="w-5 h-5 text-destructive" /></div></Card>
        <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mitigating</p><p className="text-2xl font-bold text-amber-500">{mitigating}</p></div><TrendingDown className="w-5 h-5 text-amber-500" /></div></Card>
        <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Score</p><p className="text-2xl font-bold">{avgScore}</p></div></div></Card>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No risks registered</h2>
          <p className="text-sm text-muted-foreground mb-4">Your AI agent will identify and flag risks automatically, or you can add them manually.</p>
          <Button size="sm" onClick={quickAdd}><Plus className="w-4 h-4 mr-1" /> Add First Risk</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">

          {/* ── Left: matrix / table ── */}
          <div className="xl:col-span-2">
            {view === "matrix" && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Probability / Impact Matrix</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-6 gap-1">
                    <div />
                    {[1, 2, 3, 4, 5].map(i => <div key={i} className="text-center text-[10px] font-semibold text-muted-foreground py-1">I{i}</div>)}
                    {[5, 4, 3, 2, 1].map(p => (
                      <div key={p} className="contents">
                        <div className="text-right text-[10px] font-semibold text-muted-foreground pr-2 flex items-center justify-end">P{p}</div>
                        {[1, 2, 3, 4, 5].map(imp => {
                          const score = p * imp;
                          const cellRisks = items.filter(r => r.probability === p && r.impact === imp);
                          const bg = score >= 15 ? "bg-red-500/20 border-red-500/30" : score >= 8 ? "bg-amber-500/20 border-amber-500/30" : "bg-green-500/20 border-green-500/30";
                          return (
                            <div key={`${p}-${imp}`}
                              className={`aspect-square rounded-lg border flex flex-col items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary/40 ${bg}`}
                              onClick={() => cellRisks[0] && (setSelectedRisk(cellRisks[0]), setEditing(false))}>
                              <span className="text-[10px] font-bold">{score}</span>
                              {cellRisks.length > 0 && <span className="text-[8px] font-bold">{cellRisks.length}</span>}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {view === "table" && (
              <Card className="p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {["ID", "Risk", "Category", "P", "I", "Score", "Status", "Owner"].map(h => (
                        <th key={h} className="text-left py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(r => {
                      const score = r.score ?? r.probability * r.impact;
                      const active = selectedRisk?.id === r.id;
                      return (
                        <tr key={r.id}
                          className={`border-b border-border/30 cursor-pointer transition-colors ${active ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30"}`}
                          onClick={() => { setSelectedRisk(r); setEditing(false); setAddingAction(false); }}>
                          <td className="py-2.5 px-3 font-semibold text-primary">{r.id.slice(-6)}</td>
                          <td className="py-2.5 px-3 font-medium max-w-[250px] truncate">{r.title}</td>
                          <td className="py-2.5 px-3"><Badge variant="outline">{r.category || "—"}</Badge></td>
                          <td className="py-2.5 px-3">{r.probability}</td>
                          <td className="py-2.5 px-3">{r.impact}</td>
                          <td className="py-2.5 px-3"><span className={`font-bold ${scoreColour(score)}`}>{score}</span></td>
                          <td className="py-2.5 px-3"><Badge variant={STATUS_VARIANT[r.status] || "outline"}>{r.status}</Badge></td>
                          <td className="py-2.5 px-3 text-muted-foreground">{r.owner || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </div>

          {/* ── Right: detail / edit / response actions ── */}
          <div className="space-y-4">
            {selectedRisk ? (
              <>
                {/* Risk card */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono">{selectedRisk.id.slice(-6)}</CardTitle>
                      {!editing ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1" onClick={() => startEdit(selectedRisk)}>
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => { openEscalation(selectedRisk); setEditing(false); }}>
                            <Siren className="w-3.5 h-3.5" /> Escalate
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(false)} disabled={saving}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" className="h-7 px-2 gap-1" onClick={saveEdit} disabled={saving}>
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Save
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 text-sm">
                    {editing ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Title</label>
                          <input className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                            value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Description</label>
                          <textarea rows={2} className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                            value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Probability (1–5)</label>
                            <input type="number" min={1} max={5} className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                              value={form.probability} onChange={e => setForm(f => ({ ...f, probability: Math.min(5, Math.max(1, Number(e.target.value))) }))} />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Impact (1–5)</label>
                            <input type="number" min={1} max={5} className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                              value={form.impact} onChange={e => setForm(f => ({ ...f, impact: Math.min(5, Math.max(1, Number(e.target.value))) }))} />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 py-1">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Score:</span>
                          <span className={`text-lg font-bold ${scoreColour(form.probability * form.impact)}`}>{form.probability * form.impact}</span>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Status</label>
                          <select className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                            value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Category</label>
                          <select className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                            value={form.category ?? ""} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                            <option value="">— Select —</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Owner</label>
                          <input className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                            value={form.owner ?? ""} placeholder="e.g. John Smith"
                            onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Mitigation Strategy (summary)</label>
                          <textarea rows={2} className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                            value={form.mitigation ?? ""} placeholder="High-level mitigation approach…"
                            onChange={e => setForm(f => ({ ...f, mitigation: e.target.value }))} />
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="font-medium">{selectedRisk.title}</p>
                        {selectedRisk.description && <p className="text-xs text-muted-foreground">{selectedRisk.description}</p>}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Probability:</span> <strong>{selectedRisk.probability}/5</strong></div>
                          <div><span className="text-muted-foreground">Impact:</span> <strong>{selectedRisk.impact}/5</strong></div>
                          <div><span className="text-muted-foreground">Score:</span> <strong className={scoreColour(selectedRisk.score ?? selectedRisk.probability * selectedRisk.impact)}>{selectedRisk.score ?? selectedRisk.probability * selectedRisk.impact}</strong></div>
                          <div><span className="text-muted-foreground">Status:</span> <Badge variant={STATUS_VARIANT[selectedRisk.status] || "outline"} className="text-[9px]">{selectedRisk.status}</Badge></div>
                          <div><span className="text-muted-foreground">Category:</span> <strong>{selectedRisk.category || "—"}</strong></div>
                          <div><span className="text-muted-foreground">Owner:</span> <strong>{selectedRisk.owner || "—"}</strong></div>
                        </div>
                        {selectedRisk.mitigation && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Mitigation Summary</p>
                            <p className="text-xs text-muted-foreground">{selectedRisk.mitigation}</p>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* ── Escalation panel ── */}
                {escalating && (
                  <Card className="border-destructive/40">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Siren className="w-4 h-4 text-destructive" />
                          <CardTitle className="text-sm text-destructive">Escalate Risk</CardTitle>
                        </div>
                        {!escalationResult && (
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEscalating(false)}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        The agent will generate a professional escalation email using the risk details and response actions. Recipients will be notified immediately.
                      </p>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      {escalationResult ? (
                        /* ── Result view ── */
                        <div className="space-y-3">
                          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 space-y-1.5">
                            <p className="text-xs font-semibold text-green-700">Escalation sent</p>
                            <p className="text-[10px] text-muted-foreground font-medium">Subject: {escalationResult.subject}</p>
                            {escalationResult.sent.length > 0 && (
                              <div>
                                <p className="text-[10px] text-muted-foreground mb-1">✅ Delivered to:</p>
                                {escalationResult.sent.map(e => (
                                  <p key={e} className="text-[10px] font-medium">{e}</p>
                                ))}
                              </div>
                            )}
                            {escalationResult.failed.length > 0 && (
                              <div>
                                <p className="text-[10px] text-destructive mb-1">❌ Failed:</p>
                                {escalationResult.failed.map(e => (
                                  <p key={e} className="text-[10px] text-destructive">{e}</p>
                                ))}
                              </div>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground">The escalation has been logged in the response history and the risk status has been updated to ESCALATED.</p>
                          <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => { setEscalating(false); setEscalationResult(null); }}>
                            Close
                          </Button>
                        </div>
                      ) : (
                        /* ── Input form ── */
                        <>
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                              Recipients <span className="text-destructive">*</span>
                            </label>
                            <textarea
                              rows={3}
                              className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-destructive/40 resize-none"
                              placeholder={"john.smith@company.com\njane.doe@company.com"}
                              value={escalationForm.recipients}
                              onChange={e => setEscalationForm(f => ({ ...f, recipients: e.target.value }))}
                            />
                            <p className="text-[10px] text-muted-foreground mt-0.5">One email per line, or comma-separated</p>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                              Additional Context <span className="text-muted-foreground/50 font-normal">(optional)</span>
                            </label>
                            <textarea
                              rows={3}
                              className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-destructive/40 resize-none"
                              placeholder="Any additional context or urgency the agent should include in the email…"
                              value={escalationForm.customMessage}
                              onChange={e => setEscalationForm(f => ({ ...f, customMessage: e.target.value }))}
                            />
                          </div>
                          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] text-amber-700 space-y-0.5">
                            <p className="font-semibold">The agent will include:</p>
                            <p>• Risk title, score, probability &amp; impact</p>
                            <p>• All documented response actions and their status</p>
                            <p>• Your additional context (if provided)</p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 h-8 text-xs gap-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                              onClick={sendEscalation}
                              disabled={escalationSending || !escalationForm.recipients.trim()}>
                              {escalationSending
                                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating &amp; Sending…</>
                                : <><Mail className="w-3.5 h-3.5" /> Generate &amp; Send Escalation</>
                              }
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEscalating(false)} disabled={escalationSending}>
                              Cancel
                            </Button>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* ── Response Actions card ── */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-sm">Response Actions</CardTitle>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Discrete steps taken to address this risk
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs"
                          onClick={() => { setAddingAction(a => !a); setActionsExpanded(true); }}>
                          <Plus className="w-3 h-3" /> Add
                        </Button>
                        <button className="p-1 rounded hover:bg-muted transition-colors"
                          onClick={() => setActionsExpanded(e => !e)}>
                          {actionsExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                        </button>
                      </div>
                    </div>
                  </CardHeader>

                  {actionsExpanded && (
                    <CardContent className="space-y-3">

                      {/* Add action form */}
                      {addingAction && (
                        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">New Response Action</p>

                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Strategy</label>
                            <div className="flex flex-wrap gap-1.5">
                              {STRATEGIES.map(s => {
                                const m = STRATEGY_META[s];
                                return (
                                  <button key={s}
                                    title={m.hint}
                                    onClick={() => setActionForm(f => ({ ...f, strategy: s }))}
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all ${actionForm.strategy === s ? m.colour + " ring-2 ring-offset-1 ring-current" : "border-border text-muted-foreground hover:bg-muted"}`}>
                                    {m.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Action *</label>
                            <textarea rows={2}
                              className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                              placeholder="What specifically will be done?"
                              value={actionForm.actionText}
                              onChange={e => setActionForm(f => ({ ...f, actionText: e.target.value }))}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-muted-foreground block mb-1">Owner</label>
                              <input className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                                placeholder="e.g. Sarah Lee"
                                value={actionForm.owner}
                                onChange={e => setActionForm(f => ({ ...f, owner: e.target.value }))} />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground block mb-1">Due Date</label>
                              <input type="date"
                                className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                                value={actionForm.dueDate}
                                onChange={e => setActionForm(f => ({ ...f, dueDate: e.target.value }))} />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Owner Email <span className="text-muted-foreground/60">(for escalation notifications)</span></label>
                            <input type="email"
                              className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                              placeholder="sarah.lee@company.com"
                              value={actionForm.ownerEmail}
                              onChange={e => setActionForm(f => ({ ...f, ownerEmail: e.target.value }))} />
                          </div>

                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Notes</label>
                            <input className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                              placeholder="Any additional context…"
                              value={actionForm.notes}
                              onChange={e => setActionForm(f => ({ ...f, notes: e.target.value }))} />
                          </div>

                          <div className="flex gap-2">
                            <Button size="sm" className="flex-1 h-7 text-xs gap-1" onClick={addResponseAction} disabled={actionSaving || !actionForm.actionText.trim()}>
                              {actionSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save Action
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingAction(false)}>Cancel</Button>
                          </div>
                        </div>
                      )}

                      {/* Action list */}
                      {responseLog.length === 0 && !addingAction ? (
                        <div className="text-center py-6">
                          <p className="text-xs text-muted-foreground">No response actions yet.</p>
                          <p className="text-[10px] text-muted-foreground mt-1">Add actions to document what&apos;s being done about this risk.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {responseLog.map((entry) => {
                            // ── Escalation entry (read-only, locked) ──
                            if (entry.type === "ESCALATION") {
                              return (
                                <div key={entry.id} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border bg-destructive/15 text-destructive border-destructive/30">
                                        <Siren className="w-2.5 h-2.5" /> ESCALATED
                                      </span>
                                      <span className="text-[9px] text-muted-foreground">
                                        {new Date(entry.escalatedAt!).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                      </span>
                                    </div>
                                    <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" aria-label="Escalation records cannot be deleted" />
                                  </div>
                                  <p className="text-[10px] font-semibold text-foreground truncate">{entry.subject}</p>
                                  {entry.emailPreview && (
                                    <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">{entry.emailPreview}</p>
                                  )}
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span className="flex items-center gap-1"><Mail className="w-2.5 h-2.5" /> {entry.recipients?.length ?? 0} notified</span>
                                    {(entry.failedRecipients?.length ?? 0) > 0 && (
                                      <span className="text-destructive">{entry.failedRecipients!.length} failed</span>
                                    )}
                                    {entry.escalatedBy && <span>by {entry.escalatedBy}</span>}
                                  </div>
                                  {entry.recipients && entry.recipients.length > 0 && (
                                    <p className="text-[9px] text-muted-foreground">{entry.recipients.join(", ")}</p>
                                  )}
                                </div>
                              );
                            }

                            // ── Stakeholder response entry (from magic link review) ──
                            if (entry.type === "STAKEHOLDER_RESPONSE") {
                              return (
                                <div key={entry.id || `sr-${entry.respondedAt}`} className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border bg-primary/15 text-primary border-primary/30">
                                        STAKEHOLDER RESPONSE
                                      </span>
                                      <span className="text-[9px] text-muted-foreground">
                                        {entry.respondedAt ? new Date(entry.respondedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
                                      </span>
                                    </div>
                                    <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" aria-label="External responses cannot be edited" />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold">Decision: {entry.action || entry.strategy || "—"}</span>
                                  </div>
                                  {entry.comment && <p className="text-[10px] text-muted-foreground leading-relaxed">{entry.comment}</p>}
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span>By {entry.respondedBy || "External stakeholder"}</span>
                                    <span>· via {entry.source === "magic_link" ? "email review link" : "platform"}</span>
                                  </div>
                                </div>
                              );
                            }

                            // ── Regular action entry ──
                            const meta = STRATEGY_META[entry.strategy ?? "REDUCE"] ?? STRATEGY_META.REDUCE;
                            return (
                              <div key={entry.id} className="rounded-lg border border-border bg-background p-2.5 space-y-1.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${meta.colour}`}>
                                      {meta.label}
                                    </span>
                                    <button
                                      title="Click to cycle status"
                                      onClick={() => cycleActionStatus(entry.id, entry.status ?? "PLANNED")}
                                      className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold transition-colors ${ACTION_STATUS_STYLE[entry.status ?? "PLANNED"] ?? ACTION_STATUS_STYLE.PLANNED}`}>
                                      {(entry.status ?? "PLANNED").replace("_", " ")}
                                    </button>
                                  </div>
                                  <button onClick={() => deleteResponseAction(entry.id)}
                                    className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                                <p className="text-xs font-medium leading-relaxed">{entry.action}</p>
                                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                  {entry.owner && <span>👤 {entry.owner}{entry.ownerEmail ? ` · ${entry.ownerEmail}` : ""}</span>}
                                  {entry.dueDate && <span>📅 {new Date(entry.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                                </div>
                                {entry.notes && <p className="text-[10px] text-muted-foreground italic">{entry.notes}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Summary */}
                      {responseLog.length > 0 && (
                        <div className="pt-1 border-t border-border/40 flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span>{responseLog.filter(a => a.status === "DONE").length}/{responseLog.length} complete</span>
                          {responseLog.filter(a => a.status === "IN_PROGRESS").length > 0 && (
                            <span className="text-amber-600">{responseLog.filter(a => a.status === "IN_PROGRESS").length} in progress</span>
                          )}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              </>
            ) : (
              <Card className="p-8 text-center">
                <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">Click a risk to view details and manage response actions</p>
              </Card>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
