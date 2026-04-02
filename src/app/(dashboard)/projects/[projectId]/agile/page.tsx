"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectTasks } from "@/hooks/use-api";
import { Plus, Columns3, Search } from "lucide-react";

const COLUMNS = [
  { id: "BACKLOG", label: "Backlog", color: "#64748B" },
  { id: "TODO", label: "To Do", color: "#6366F1" },
  { id: "IN_PROGRESS", label: "In Progress", color: "#22D3EE" },
  { id: "IN_REVIEW", label: "In Review", color: "#F59E0B" },
  { id: "DONE", label: "Done", color: "#10B981" },
];

const PRIORITY_BORDER: Record<string, string> = { CRITICAL: "#EF4444", HIGH: "#F97316", MEDIUM: "#6366F1", LOW: "#64748B" };

export default function AgileBoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: tasks, isLoading } = useProjectTasks(projectId);
  const [search, setSearch] = useState("");

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="flex gap-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-96 flex-1 rounded-xl" />)}</div></div>;

  const items = (tasks || []).filter((t: any) => !search || t.title?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Agile Board</h1><p className="text-sm text-muted-foreground mt-1">{(tasks || []).length} items</p></div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border w-[200px]">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input className="bg-transparent text-xs outline-none flex-1" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create Issue</Button>
        </div>
      </div>

      {(tasks || []).length === 0 ? (
        <div className="text-center py-20">
          <Columns3 className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No items on the board</h2>
          <p className="text-sm text-muted-foreground mb-4">Create tasks or let your AI agent populate the backlog from project requirements.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create First Issue</Button>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto" style={{ minHeight: 400 }}>
          {COLUMNS.map(col => {
            const colItems = items.filter((t: any) => (t.status || "TODO") === col.id);
            const totalSP = colItems.reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
            return (
              <div key={col.id} className="flex-1 min-w-[220px] max-w-[300px] flex flex-col rounded-xl bg-muted/20">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                    <span className="text-xs font-semibold">{col.label}</span>
                    <Badge variant="outline" className="text-[9px]">{colItems.length}</Badge>
                  </div>
                  {totalSP > 0 && <span className="text-[10px] text-muted-foreground">{totalSP} SP</span>}
                </div>
                <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto max-h-[500px]">
                  {colItems.map((task: any) => (
                    <Card key={task.id} className="cursor-pointer hover:-translate-y-0.5 transition-all"
                      style={{ borderLeft: `3px solid ${PRIORITY_BORDER[task.priority] || "#64748B"}` }}>
                      <CardContent className="p-2.5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px] font-mono text-muted-foreground">{task.id.slice(-6)}</span>
                          {task.priority && <Badge variant={task.priority === "CRITICAL" || task.priority === "HIGH" ? "destructive" : "outline"} className="text-[8px]">{task.priority}</Badge>}
                        </div>
                        <p className="text-xs font-medium line-clamp-2">{task.title}</p>
                        <div className="flex items-center justify-between mt-2">
                          {task.assigneeId ? (
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[8px] font-bold text-white">{task.assigneeId.slice(0, 2).toUpperCase()}</div>
                          ) : <span />}
                          {task.storyPoints && (
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-primary/10 text-primary">{task.storyPoints}</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
