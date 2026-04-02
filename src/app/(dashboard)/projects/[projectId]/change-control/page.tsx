"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectChangeRequests } from "@/hooks/use-api";
import { Plus, GitPullRequest } from "lucide-react";

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { SUBMITTED: "outline", UNDER_REVIEW: "secondary", APPROVED: "default", REJECTED: "destructive", DEFERRED: "secondary" };
const COLUMNS = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"];

export default function ChangeControlPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: crs, isLoading } = useProjectChangeRequests(projectId);
  const [view, setView] = useState<"kanban" | "table">("table");
  const [selected, setSelected] = useState<any>(null);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-xl" /></div>;

  const items = crs || [];

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Change Control</h1><p className="text-sm text-muted-foreground mt-1">{items.length} change requests</p></div>
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

      {items.length === 0 ? (
        <div className="text-center py-20">
          <GitPullRequest className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No change requests</h2>
          <p className="text-sm text-muted-foreground mb-4">Change requests will appear here when submitted by users or agents.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Submit First CR</Button>
        </div>
      ) : view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto">
          {COLUMNS.map(col => {
            const colItems = items.filter((cr: any) => cr.status === col);
            return (
              <div key={col} className="flex-1 min-w-[220px] space-y-2">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{col.replace("_", " ")}</span>
                  <Badge variant="outline" className="text-[9px]">{colItems.length}</Badge>
                </div>
                {colItems.map((cr: any) => (
                  <Card key={cr.id} className="cursor-pointer hover:-translate-y-0.5 transition-all" onClick={() => setSelected(cr)}>
                    <CardContent className="pt-3 pb-3">
                      <p className="text-xs font-semibold line-clamp-2">{cr.title}</p>
                      {cr.requestedBy && <p className="text-[10px] text-muted-foreground mt-1">By: {cr.requestedBy}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(cr.createdAt)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="p-0">
          <table className="w-full text-xs"><thead><tr className="border-b border-border">
            {["Title", "Status", "Requested By", "Created"].map(h => <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>)}
          </tr></thead>
            <tbody>{items.map((cr: any) => (
              <tr key={cr.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelected(cr)}>
                <td className="py-2.5 px-4 font-medium max-w-[300px] truncate">{cr.title}</td>
                <td className="py-2.5 px-4"><Badge variant={STATUS_VARIANT[cr.status] || "outline"}>{cr.status}</Badge></td>
                <td className="py-2.5 px-4 text-muted-foreground">{cr.requestedBy || "—"}</td>
                <td className="py-2.5 px-4 text-muted-foreground">{timeAgo(cr.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}

      {/* Detail panel */}
      {selected && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{selected.title}</CardTitle>
              <Badge variant={STATUS_VARIANT[selected.status] || "outline"}>{selected.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected.description && <p className="text-sm text-muted-foreground">{selected.description}</p>}
            {selected.impact && (
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(selected.impact as Record<string, string>).map(([k, v]) => (
                  <div key={k} className="p-2 rounded-lg bg-muted/30 text-center">
                    <p className="text-[10px] text-muted-foreground capitalize">{k}</p>
                    <p className={`text-xs font-bold ${v === "high" ? "text-destructive" : v === "medium" ? "text-amber-500" : "text-green-500"}`}>{v}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm">Approve</Button>
              <Button variant="destructive" size="sm">Reject</Button>
              <Button variant="outline" size="sm" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
