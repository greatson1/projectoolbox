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
import { Plus, AlertTriangle, Shield, TrendingDown, Download, Pencil, X, Check, Loader2 } from "lucide-react";
import { downloadCSV } from "@/lib/export-csv";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  OPEN: "destructive", MITIGATING: "secondary", WATCHING: "outline", CLOSED: "default",
};

const STATUSES = ["OPEN", "WATCHING", "MITIGATING", "CLOSED", "ESCALATED"];
const CATEGORIES = ["Technical", "Financial", "Schedule", "Resource", "Stakeholder", "Legal", "External", "Other"];

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
};

type RiskForm = Omit<Risk, "id" | "score">;

function scoreColour(score: number) {
  return score >= 15 ? "text-destructive" : score >= 8 ? "text-amber-500" : "text-green-500";
}

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

  // ── helpers ──────────────────────────────────────────────────────────────

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

  function cancelEdit() {
    setEditing(false);
  }

  async function saveEdit() {
    if (!selectedRisk) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/risks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskId: selectedRisk.id, ...form }),
      });
      if (!res.ok) throw new Error();
      const { data } = await res.json();
      setSelectedRisk(data);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["risks", projectId] });
      toast.success("Risk updated");
    } catch {
      toast.error("Failed to save risk");
    } finally {
      setSaving(false);
    }
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

  // ── loading ──────────────────────────────────────────────────────────────

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

  // ── render ────────────────────────────────────────────────────────────────

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

          {/* Left: matrix / table */}
          <div className="xl:col-span-2">

            {/* Matrix */}
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
                              onClick={() => cellRisks[0] && setSelectedRisk(cellRisks[0])}>
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

            {/* Table */}
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
                          className={`border-b border-border/30 cursor-pointer transition-colors ${active ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/30"}`}
                          onClick={() => { setSelectedRisk(r); setEditing(false); }}>
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

          {/* Right: detail / edit panel */}
          <div>
            {selectedRisk ? (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-mono">{selectedRisk.id.slice(-6)}</CardTitle>
                    {!editing ? (
                      <Button variant="ghost" size="sm" className="h-7 px-2 gap-1" onClick={() => startEdit(selectedRisk)}>
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </Button>
                    ) : (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={cancelEdit} disabled={saving}>
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
                    /* ── Edit form ── */
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Title</label>
                        <input
                          className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          value={form.title}
                          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Description</label>
                        <textarea
                          rows={2}
                          className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                          value={form.description ?? ""}
                          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Probability (1–5)</label>
                          <input type="number" min={1} max={5}
                            className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                            value={form.probability}
                            onChange={e => setForm(f => ({ ...f, probability: Math.min(5, Math.max(1, Number(e.target.value))) }))}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Impact (1–5)</label>
                          <input type="number" min={1} max={5}
                            className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                            value={form.impact}
                            onChange={e => setForm(f => ({ ...f, impact: Math.min(5, Math.max(1, Number(e.target.value))) }))}
                          />
                        </div>
                      </div>

                      {/* Live score preview */}
                      <div className="flex items-center gap-2 py-1">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Score:</span>
                        <span className={`text-lg font-bold ${scoreColour(form.probability * form.impact)}`}>
                          {form.probability * form.impact}
                        </span>
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Status</label>
                        <select
                          className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          value={form.status}
                          onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                        >
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Category</label>
                        <select
                          className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          value={form.category ?? ""}
                          onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        >
                          <option value="">— Select —</option>
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Owner</label>
                        <input
                          className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          value={form.owner ?? ""}
                          placeholder="e.g. John Smith"
                          onChange={e => setForm(f => ({ ...f, owner: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Mitigation Plan</label>
                        <textarea
                          rows={3}
                          className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                          value={form.mitigation ?? ""}
                          placeholder="Describe how this risk will be mitigated…"
                          onChange={e => setForm(f => ({ ...f, mitigation: e.target.value }))}
                        />
                      </div>
                    </div>
                  ) : (
                    /* ── Read-only view ── */
                    <>
                      <p className="font-medium">{selectedRisk.title}</p>
                      {selectedRisk.description && (
                        <p className="text-xs text-muted-foreground">{selectedRisk.description}</p>
                      )}
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
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Mitigation</p>
                          <p className="text-xs text-muted-foreground">{selectedRisk.mitigation}</p>
                        </div>
                      )}
                      {!selectedRisk.mitigation && (
                        <p className="text-xs text-muted-foreground italic">No mitigation plan yet — click Edit to add one.</p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="p-8 text-center">
                <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">Click a risk to view and edit details</p>
              </Card>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
