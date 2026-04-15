"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, TrendingUp, Target, AlertTriangle, CheckCircle2, PoundSterling, Pencil, Trash2, X, Save } from "lucide-react";
import { toast } from "sonner";

type BenefitStatus = "ON_TRACK" | "AT_RISK" | "REALISED" | "NOT_STARTED";

interface Benefit {
  id: string;
  name: string;
  category: string;
  targetValue: number;
  realisedValue: number;
  status: BenefitStatus;
  owner: string | null;
  targetDate: string | null;
  description: string | null;
  measures: string | null;
}

const STATUS_VARIANT: Record<BenefitStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ON_TRACK: "default",
  AT_RISK: "destructive",
  REALISED: "secondary",
  NOT_STARTED: "outline",
};

const STATUS_LABEL: Record<BenefitStatus, string> = {
  ON_TRACK: "On Track",
  AT_RISK: "At Risk",
  REALISED: "Realised",
  NOT_STARTED: "Not Started",
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);
}

export default function BenefitsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Benefit>>({});

  const fetchBenefits = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/benefits`);
      if (res.ok) {
        const data = await res.json();
        setBenefits(data.data || []);
      }
    } catch {} finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchBenefits(); }, [fetchBenefits]);

  const handleAdd = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/benefits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Benefit", category: "Strategic", status: "NOT_STARTED" }),
      });
      if (res.ok) {
        toast.success("Benefit added");
        fetchBenefits();
      }
    } catch { toast.error("Failed to add benefit"); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/benefits?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Benefit deleted");
        setBenefits(prev => prev.filter(b => b.id !== id));
      }
    } catch { toast.error("Failed to delete"); }
  };

  const startEdit = (b: Benefit) => {
    setEditingId(b.id);
    setEditForm({
      name: b.name,
      description: b.description || "",
      category: b.category,
      status: b.status,
      targetValue: b.targetValue,
      realisedValue: b.realisedValue,
      owner: b.owner || "",
      targetDate: b.targetDate ? b.targetDate.split("T")[0] : "",
      measures: b.measures || "",
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/benefits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...editForm }),
      });
      if (res.ok) {
        toast.success("Benefit updated");
        setEditingId(null);
        fetchBenefits();
      }
    } catch { toast.error("Failed to update"); }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const totalBenefits = benefits.length;
  const onTrack = benefits.filter(b => b.status === "ON_TRACK").length;
  const atRisk = benefits.filter(b => b.status === "AT_RISK").length;
  const totalRealised = benefits.reduce((s, b) => s + b.realisedValue, 0);

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Benefits Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">{totalBenefits} benefit{totalBenefits !== 1 ? "s" : ""} &middot; {formatCurrency(totalRealised)} realised to date</p>
        </div>
        <Button size="sm" onClick={handleAdd}><Plus className="w-4 h-4 mr-1" /> Add Benefit</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Benefits</p>
              <p className="text-2xl font-bold">{totalBenefits}</p>
            </div>
            <Target className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">On Track</p>
              <p className="text-2xl font-bold text-green-600">{onTrack}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">At Risk</p>
              <p className="text-2xl font-bold text-destructive">{atRisk}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Realised Value</p>
              <p className="text-2xl font-bold">{formatCurrency(totalRealised)}</p>
            </div>
            <PoundSterling className="w-5 h-5 text-primary" />
          </div>
        </Card>
      </div>

      {/* Benefits list */}
      {benefits.length === 0 ? (
        <div className="text-center py-20">
          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No benefits registered</h2>
          <p className="text-sm text-muted-foreground mb-4">Track expected benefits and measure realisation against targets.</p>
          <Button size="sm" onClick={handleAdd}><Plus className="w-4 h-4 mr-1" /> Add First Benefit</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {benefits.map(b => {
            const pct = b.targetValue > 0 ? Math.round((b.realisedValue / b.targetValue) * 100) : 0;
            const isEditing = editingId === b.id;

            if (isEditing) {
              return (
                <Card key={b.id} className="border-primary/30">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">Editing Benefit</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                        <Button size="sm" onClick={saveEdit}><Save className="w-4 h-4 mr-1" /> Save</Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Name</label>
                        <Input value={editForm.name || ""} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Category</label>
                        <select value={editForm.category || "Strategic"} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                          className="w-full h-8 px-2 rounded-md border border-border bg-background text-sm">
                          <option value="Strategic">Strategic</option>
                          <option value="Financial">Financial</option>
                          <option value="Operational">Operational</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Status</label>
                        <select value={editForm.status || "NOT_STARTED"} onChange={e => setEditForm(p => ({ ...p, status: e.target.value as BenefitStatus }))}
                          className="w-full h-8 px-2 rounded-md border border-border bg-background text-sm">
                          <option value="NOT_STARTED">Not Started</option>
                          <option value="ON_TRACK">On Track</option>
                          <option value="AT_RISK">At Risk</option>
                          <option value="REALISED">Realised</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Owner</label>
                        <Input value={editForm.owner || ""} onChange={e => setEditForm(p => ({ ...p, owner: e.target.value }))} className="h-8 text-sm" placeholder="Role or name" />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Target Value (£)</label>
                        <Input type="number" value={editForm.targetValue || 0} onChange={e => setEditForm(p => ({ ...p, targetValue: Number(e.target.value) }))} className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Realised Value (£)</label>
                        <Input type="number" value={editForm.realisedValue || 0} onChange={e => setEditForm(p => ({ ...p, realisedValue: Number(e.target.value) }))} className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Target Date</label>
                        <Input type="date" value={editForm.targetDate || ""} onChange={e => setEditForm(p => ({ ...p, targetDate: e.target.value }))} className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Measure / KPI</label>
                        <Input value={editForm.measures || ""} onChange={e => setEditForm(p => ({ ...p, measures: e.target.value }))} className="h-8 text-sm" placeholder="How is this measured?" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">Description</label>
                      <Input value={editForm.description || ""} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} className="h-8 text-sm" placeholder="What does this benefit deliver?" />
                    </div>
                  </CardContent>
                </Card>
              );
            }

            return (
              <Card key={b.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold truncate">{b.name}</h3>
                        <Badge variant="outline" className="text-[10px]">{b.category}</Badge>
                        <Badge variant={STATUS_VARIANT[b.status]} className="text-[10px]">{STATUS_LABEL[b.status]}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{b.description}</p>
                    </div>
                    <div className="flex items-center gap-1 ml-4 shrink-0">
                      <div className="text-right mr-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Target</p>
                        <p className="text-sm font-bold">{formatCurrency(b.targetValue)}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEdit(b)}><Pencil className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(b.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 mt-3">
                    {b.owner && <div className="text-xs text-muted-foreground">Owner: <span className="font-medium text-foreground">{b.owner}</span></div>}
                    {b.targetDate && <div className="text-xs text-muted-foreground">Target: <span className="font-medium text-foreground">{new Date(b.targetDate).toLocaleDateString("en-GB")}</span></div>}
                    <div className="text-xs text-muted-foreground">Realised: <span className="font-semibold text-foreground">{formatCurrency(b.realisedValue)}</span></div>
                    <div className="flex-1 flex items-center gap-2 ml-auto">
                      <Progress value={pct} className="h-2 flex-1" />
                      <span className="text-xs font-semibold w-8 text-right">{pct}%</span>
                    </div>
                  </div>
                  {b.measures && <p className="text-[10px] text-muted-foreground mt-2">KPI: {b.measures}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
