"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectChangeRequests } from "@/hooks/use-api";
import { Plus, GitPullRequest, Search } from "lucide-react";

const CR_COLUMNS = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "IMPLEMENTED"];
const CR_LABELS: Record<string, string> = { SUBMITTED: "Submitted", UNDER_REVIEW: "Under Review", APPROVED: "Approved", REJECTED: "Rejected", IMPLEMENTED: "Implemented" };
const CR_COLORS: Record<string, string> = { SUBMITTED: "#64748B", UNDER_REVIEW: "#F59E0B", APPROVED: "#10B981", REJECTED: "#EF4444", IMPLEMENTED: "#6366F1" };

export default function ChangeControlPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: crs, isLoading } = useProjectChangeRequests(projectId);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [selectedCR, setSelectedCR] = useState<any>(null);
  const [search, setSearch] = useState("");

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="flex gap-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-64 flex-1 rounded-xl" />)}</div></div>;

  const items = (crs || []).filter((cr: any) => !search || cr.title?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Change Control</h1>
          <p className="text-sm text-muted-foreground mt-1">{(crs || []).length} change requests</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["kanban", "table"] as const).map(v => (
              <button key={v} className={`px-3 py-1.5 text-xs font-semibold capitalize ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Submit CR</Button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border max-w-md">
        <Search className="w-3.5 h-3.5 text-muted-foreground" />
        <input className="bg-transparent text-xs outline-none flex-1" placeholder="Search CRs..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {(crs || []).length === 0 ? (
        <div className="text-center py-20">
          <GitPullRequest className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No change requests</h2>
          <p className="text-sm text-muted-foreground mb-4">Change requests will appear here when scope, schedule, or budget changes are proposed.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Submit First CR</Button>
        </div>
      ) : view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto" style={{ minHeight: 400 }}>
          {CR_COLUMNS.map(col => {
            const colItems = items.filter((cr: any) => (cr.status || "SUBMITTED") === col);
            return (
              <div key={col} className="flex-1 min-w-[200px] max-w-[280px] flex flex-col rounded-xl bg-muted/20">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: CR_COLORS[col] }} />
                    <span className="text-xs font-semibold">{CR_LABELS[col]}</span>
                    <Badge variant="outline" className="text-[9px]">{colItems.length}</Badge>
                  </div>
                </div>
                <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto">
                  {colItems.map((cr: any) => {
                    const impact = cr.impact as any;
                    return (
                      <Card key={cr.id} className="cursor-pointer hover:-translate-y-0.5 transition-all" onClick={() => setSelectedCR(cr)}>
                        <CardContent className="p-2.5">
                          <p className="text-[11px] font-medium line-clamp-2 mb-1.5">{cr.title}</p>
                          {impact && (
                            <div className="flex gap-1 mb-1">
                              {["schedule", "cost", "scope", "risk"].map(dim => {
                                const val = impact[dim];
                                if (!val || val === "none") return null;
                                return (
                                  <span key={dim} className={`text-[8px] px-1 py-0.5 rounded font-semibold ${val === "high" ? "bg-destructive/10 text-destructive" : val === "medium" ? "bg-amber-500/10 text-amber-500" : "bg-green-500/10 text-green-500"}`}>
                                    {dim[0].toUpperCase()}:{val[0].toUpperCase()}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-muted-foreground">{cr.requestedBy || "—"}</span>
                            <span className="text-[9px] text-muted-foreground">{new Date(cr.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border">
              {["Title", "Status", "Impact", "Requested By", "Date"].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {items.map((cr: any) => (
                <tr key={cr.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedCR(cr)}>
                  <td className="py-2.5 px-4 font-medium max-w-[300px] truncate">{cr.title}</td>
                  <td className="py-2.5 px-4"><Badge variant="outline" style={{ color: CR_COLORS[cr.status] }}>{CR_LABELS[cr.status] || cr.status}</Badge></td>
                  <td className="py-2.5 px-4">
                    {cr.impact && (
                      <div className="flex gap-1">
                        {["schedule", "cost", "scope", "risk"].map(dim => {
                          const val = (cr.impact as any)?.[dim];
                          if (!val || val === "none") return null;
                          return <span key={dim} className={`text-[8px] px-1 py-0.5 rounded ${val === "high" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-500"}`}>{dim[0].toUpperCase()}</span>;
                        })}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-muted-foreground">{cr.requestedBy || "—"}</td>
                  <td className="py-2.5 px-4 text-muted-foreground">{new Date(cr.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Detail panel */}
      {selectedCR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedCR(null)}>
          <Card className="w-full max-w-[600px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <Badge variant="outline" style={{ color: CR_COLORS[selectedCR.status] }}>{CR_LABELS[selectedCR.status] || selectedCR.status}</Badge>
                <button onClick={() => setSelectedCR(null)} className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <CardTitle className="text-base mt-2">{selectedCR.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedCR.description && <p className="text-sm text-muted-foreground">{selectedCR.description}</p>}
              {selectedCR.impact && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Impact Analysis</p>
                  <div className="grid grid-cols-4 gap-2">
                    {["schedule", "cost", "scope", "risk"].map(dim => {
                      const val = (selectedCR.impact as any)[dim];
                      return (
                        <div key={dim} className="p-2 rounded-lg bg-muted/30 text-center">
                          <p className="text-[10px] text-muted-foreground capitalize">{dim}</p>
                          <p className={`text-xs font-bold ${val === "high" ? "text-destructive" : val === "medium" ? "text-amber-500" : "text-green-500"}`}>{val || "none"}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1">Approve</Button>
                <Button variant="destructive" size="sm" className="flex-1">Reject</Button>
                <Button variant="outline" size="sm" className="flex-1">Defer</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
