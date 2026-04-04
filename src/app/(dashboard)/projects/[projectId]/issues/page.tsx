"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectIssues } from "@/hooks/use-api";
import { toast } from "sonner";
import { Plus, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const P_VAR: Record<string, "destructive" | "secondary" | "outline"> = { CRITICAL: "destructive", HIGH: "destructive", MEDIUM: "secondary", LOW: "outline" };

export default function IssuesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: issues, isLoading } = useProjectIssues(projectId);
  const [filter, setFilter] = useState("all");

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-xl" /></div>;

  const items = issues || [];
  const filtered = filter === "all" ? items : items.filter((i: any) => i.status === filter);
  const open = items.filter((i: any) => i.status === "OPEN").length;
  const inProg = items.filter((i: any) => i.status === "IN_PROGRESS").length;
  const resolved = items.filter((i: any) => i.status === "RESOLVED").length;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Issues Log</h1><p className="text-sm text-muted-foreground mt-1">{items.length} issues · {open} open</p></div>
        <Button size="sm" onClick={() => toast.info("Coming soon")}><Plus className="w-4 h-4 mr-1" /> Log Issue</Button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4"><div className="flex items-center gap-3"><AlertTriangle className="w-5 h-5 text-destructive" /><div><p className="text-[10px] uppercase text-muted-foreground">Open</p><p className="text-2xl font-bold text-destructive">{open}</p></div></div></Card>
        <Card className="p-4"><div className="flex items-center gap-3"><Clock className="w-5 h-5 text-amber-500" /><div><p className="text-[10px] uppercase text-muted-foreground">In Progress</p><p className="text-2xl font-bold text-amber-500">{inProg}</p></div></div></Card>
        <Card className="p-4"><div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500" /><div><p className="text-[10px] uppercase text-muted-foreground">Resolved</p><p className="text-2xl font-bold text-green-500">{resolved}</p></div></div></Card>
      </div>
      <div className="flex gap-1">{["all", "OPEN", "IN_PROGRESS", "RESOLVED"].map(f => (
        <button key={f} className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} onClick={() => setFilter(f)}>{f.replace("_", " ").toLowerCase()}</button>
      ))}</div>
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <AlertTriangle className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No issues</h2>
          <p className="text-sm text-muted-foreground">Issues will appear here when logged by you or your AI agent.</p>
        </div>
      ) : (
        <Card className="p-0">
          <table className="w-full text-xs"><thead><tr className="border-b border-border">{["Issue", "Priority", "Status", "Assignee", "Created"].map(h => <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>)}</tr></thead>
            <tbody>{filtered.map((i: any) => (
              <tr key={i.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer">
                <td className="py-2.5 px-4 font-medium max-w-[300px] truncate">{i.title}</td>
                <td className="py-2.5 px-4"><Badge variant={P_VAR[i.priority] || "outline"}>{i.priority}</Badge></td>
                <td className="py-2.5 px-4"><Badge variant={i.status === "RESOLVED" ? "default" : i.status === "IN_PROGRESS" ? "secondary" : "outline"}>{i.status}</Badge></td>
                <td className="py-2.5 px-4 text-muted-foreground">{i.assigneeId || "Unassigned"}</td>
                <td className="py-2.5 px-4 text-muted-foreground">{timeAgo(i.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
