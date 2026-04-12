"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectRisks } from "@/hooks/use-api";
import { toast } from "sonner";
import { Plus, AlertTriangle, Shield, TrendingDown } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { OPEN: "destructive", MITIGATING: "secondary", WATCHING: "outline", CLOSED: "default" };

export default function RiskRegisterPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: risks, isLoading } = useProjectRisks(projectId);
  const [view, setView] = useState<"matrix" | "table">("table");
  const [selectedRisk, setSelectedRisk] = useState<any>(null);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const items = risks || [];
  const highRisks = items.filter((r: any) => (r.score || r.probability * r.impact) >= 15).length;
  const mitigating = items.filter((r: any) => r.status === "MITIGATING").length;
  const avgScore = items.length > 0 ? (items.reduce((s: number, r: any) => s + (r.score || r.probability * r.impact), 0) / items.length).toFixed(1) : "0";

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Risk Register</h1>
          <p className="text-sm text-muted-foreground mt-1">{items.length} risks · {highRisks} critical · {mitigating} mitigating</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["matrix", "table"] as const).map(v => (
              <button key={v} className={`px-3 py-1.5 text-xs font-semibold capitalize ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
          <Button size="sm" onClick={() => { const t = prompt("Risk title:"); if (!t) return; fetch(`/api/projects/${window.location.pathname.split("/")[2]}/risks`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ title: t, probability: 3, impact: 3, status: "OPEN" }) }).then(() => { toast.success("Risk added"); window.location.reload(); }).catch(() => toast.error("Failed")); }}><Plus className="w-4 h-4 mr-1" /> Add Risk</Button>
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
          <Button size="sm" onClick={() => { const t = prompt("Risk title:"); if (!t) return; fetch(`/api/projects/${window.location.pathname.split("/")[2]}/risks`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ title: t, probability: 3, impact: 3, status: "OPEN" }) }).then(() => { toast.success("Risk added"); window.location.reload(); }).catch(() => toast.error("Failed")); }}><Plus className="w-4 h-4 mr-1" /> Add First Risk</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div className="xl:col-span-2">
            {/* Matrix view */}
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
                          const count = items.filter((r: any) => r.probability === p && r.impact === imp).length;
                          const bg = score >= 15 ? "bg-red-500/20 border-red-500/30" : score >= 8 ? "bg-amber-500/20 border-amber-500/30" : "bg-green-500/20 border-green-500/30";
                          return (
                            <div key={`${p}-${imp}`} className={`aspect-square rounded-lg border flex flex-col items-center justify-center ${bg}`}>
                              <span className="text-[10px] font-bold">{score}</span>
                              {count > 0 && <span className="text-[8px] font-bold">{count}</span>}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Table view */}
            {view === "table" && (
              <Card className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border">
                    {["ID", "Risk", "Category", "P", "I", "Score", "Status", "Owner"].map(h => (
                      <th key={h} className="text-left py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {items.map((r: any) => {
                      const score = r.score || r.probability * r.impact;
                      return (
                        <tr key={r.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedRisk(r)}>
                          <td className="py-2.5 px-3 font-semibold text-primary">{r.id.slice(-6)}</td>
                          <td className="py-2.5 px-3 font-medium max-w-[250px] truncate">{r.title}</td>
                          <td className="py-2.5 px-3"><Badge variant="outline">{r.category || "—"}</Badge></td>
                          <td className="py-2.5 px-3">{r.probability}</td>
                          <td className="py-2.5 px-3">{r.impact}</td>
                          <td className="py-2.5 px-3"><span className={`font-bold ${score >= 15 ? "text-destructive" : score >= 8 ? "text-amber-500" : "text-green-500"}`}>{score}</span></td>
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

          {/* Detail panel */}
          <div>
            {selectedRisk ? (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{selectedRisk.id.slice(-6)}</CardTitle>
                    <Badge variant={((selectedRisk.score || selectedRisk.probability * selectedRisk.impact) >= 15) ? "destructive" : "secondary"}>
                      Score: {selectedRisk.score || selectedRisk.probability * selectedRisk.impact}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm font-medium">{selectedRisk.title}</p>
                  {selectedRisk.description && <p className="text-xs text-muted-foreground">{selectedRisk.description}</p>}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Probability:</span> <strong>{selectedRisk.probability}/5</strong></div>
                    <div><span className="text-muted-foreground">Impact:</span> <strong>{selectedRisk.impact}/5</strong></div>
                    <div><span className="text-muted-foreground">Category:</span> <strong>{selectedRisk.category || "—"}</strong></div>
                    <div><span className="text-muted-foreground">Owner:</span> <strong>{selectedRisk.owner || "—"}</strong></div>
                  </div>
                  {selectedRisk.mitigation && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Mitigation</p>
                      <p className="text-xs text-muted-foreground">{selectedRisk.mitigation}</p>
                    </div>
                  )}
                  <div className="flex gap-2"><Button variant="outline" size="sm" className="flex-1" onClick={() => toast.success("Open risk details to edit")}>Edit</Button><Button variant="outline" size="sm" className="flex-1" onClick={() => { fetch(`/api/projects/${window.location.pathname.split("/")[2]}/risks`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ riskId: selectedRisk?.id, status: "ESCALATED" }) }).then(() => { toast.success("Risk escalated"); window.location.reload(); }).catch(() => toast.error("Failed")); }}>Escalate</Button></div>
                </CardContent>
              </Card>
            ) : (
              <Card className="p-8 text-center">
                <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">Click a risk to view details</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
