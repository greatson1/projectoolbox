"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectTasks } from "@/hooks/use-api";
import { Plus, Columns3, Search, X, Filter } from "lucide-react";

const COLUMNS = [
  { id: "BACKLOG", label: "Backlog", color: "#64748B" },
  { id: "TODO", label: "To Do", color: "#6366F1" },
  { id: "IN_PROGRESS", label: "In Progress", color: "#22D3EE", wipLimit: 6 },
  { id: "IN_REVIEW", label: "In Review", color: "#F59E0B" },
  { id: "DONE", label: "Done", color: "#10B981" },
];

const PRIORITY_BORDER: Record<string, string> = { CRITICAL: "#EF4444", HIGH: "#F97316", MEDIUM: "#6366F1", LOW: "#64748B" };

export default function AgileBoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: tasks, isLoading } = useProjectTasks(projectId);
  const [search, setSearch] = useState("");
  const [filterMyItems, setFilterMyItems] = useState(false);
  const [filterBlocked, setFilterBlocked] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const items = useMemo(() => {
    let result = tasks || [];
    if (search) result = result.filter((t: any) => t.title?.toLowerCase().includes(search.toLowerCase()));
    if (filterBlocked) result = result.filter((t: any) => t.status === "BLOCKED");
    return result;
  }, [tasks, search, filterBlocked]);

  const hasFilters = search || filterMyItems || filterBlocked;
  const totalSP = (tasks || []).reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
  const doneSP = (tasks || []).filter((t: any) => t.status === "DONE").reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="flex gap-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-96 flex-1 rounded-xl" />)}</div></div>;

  return (
    <div className="space-y-4 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agile Board</h1>
          <p className="text-sm text-muted-foreground mt-1">{(tasks || []).length} items · {doneSP}/{totalSP} SP completed</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setFilterBlocked(!filterBlocked)} className={filterBlocked ? "bg-destructive/10 text-destructive" : ""}>
            <Filter className="w-3.5 h-3.5 mr-1" /> {filterBlocked ? "Showing Blocked" : "Blocked"}
          </Button>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create Issue</Button>
        </div>
      </div>

      {/* Search + sprint info */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border w-[250px]">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input className="bg-transparent text-xs outline-none flex-1" placeholder="Search issues..." value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button onClick={() => setSearch("")}><X className="w-3 h-3 text-muted-foreground" /></button>}
        </div>
        {totalSP > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sprint Progress:</span>
            <Progress value={totalSP > 0 ? (doneSP / totalSP) * 100 : 0} className="h-1.5 w-24" />
            <span className="text-xs font-semibold">{doneSP}/{totalSP} SP</span>
          </div>
        )}
        {hasFilters && (
          <button className="text-[10px] font-semibold text-destructive px-2 py-1 rounded bg-destructive/5"
            onClick={() => { setSearch(""); setFilterMyItems(false); setFilterBlocked(false); }}>Clear Filters</button>
        )}
      </div>

      {/* Board */}
      {(tasks || []).length === 0 ? (
        <div className="text-center py-20">
          <Columns3 className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No items on the board</h2>
          <p className="text-sm text-muted-foreground mb-4">Create tasks or let your AI agent populate the backlog.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create First Issue</Button>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto" style={{ minHeight: 500 }}>
          {COLUMNS.map(col => {
            const colItems = items.filter((t: any) => {
              const status = t.status || "TODO";
              if (col.id === "BACKLOG") return status === "BACKLOG";
              if (col.id === "IN_REVIEW") return status === "IN_REVIEW";
              return status === col.id;
            });
            const colSP = colItems.reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
            const atLimit = col.wipLimit && colItems.length >= col.wipLimit;
            const overLimit = col.wipLimit && colItems.length > col.wipLimit;

            return (
              <div key={col.id} className="flex-1 min-w-[220px] max-w-[300px] flex flex-col rounded-xl bg-muted/20">
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                    <span className="text-xs font-semibold">{col.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: `${col.color}22`, color: col.color }}>{colItems.length}</span>
                    {col.wipLimit && (
                      <span className={`text-[8px] px-1 py-0.5 rounded font-bold ${overLimit ? "bg-destructive/15 text-destructive" : atLimit ? "bg-amber-500/15 text-amber-500" : ""}`}>
                        {col.wipLimit && `WIP ${col.wipLimit}`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {colSP > 0 && <span className="text-[10px] text-muted-foreground">{colSP} SP</span>}
                    <button className="w-5 h-5 rounded flex items-center justify-center text-sm hover:bg-muted text-muted-foreground">+</button>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 400px)" }}>
                  {colItems.map((task: any) => (
                    <Card key={task.id} className="cursor-pointer transition-all hover:-translate-y-0.5"
                      style={{ borderLeft: `3px solid ${PRIORITY_BORDER[task.priority] || "#64748B"}` }}
                      onClick={() => setSelectedTask(task)}>
                      <CardContent className="p-2.5">
                        {/* Top row */}
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-mono text-muted-foreground">{task.id.slice(-6)}</span>
                            {task.status === "BLOCKED" && <span className="text-[8px] px-1 py-0.5 rounded font-bold bg-destructive/15 text-destructive">BLOCKED</span>}
                          </div>
                          {task.priority && <Badge variant={task.priority === "CRITICAL" || task.priority === "HIGH" ? "destructive" : "outline"} className="text-[8px]">{task.priority}</Badge>}
                        </div>
                        {/* Title */}
                        <p className="text-xs font-medium line-clamp-2 leading-tight">{task.title}</p>
                        {/* Progress bar */}
                        {(task.progress || 0) > 0 && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Progress value={task.progress} className="h-[3px] flex-1" />
                            <span className="text-[8px] text-muted-foreground">{task.progress}%</span>
                          </div>
                        )}
                        {/* Bottom */}
                        <div className="flex items-center justify-between mt-2">
                          {task.assigneeId ? (
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[8px] font-bold text-white">{task.assigneeId.slice(0, 2).toUpperCase()}</div>
                          ) : <span />}
                          {task.storyPoints && (
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold bg-primary/10 text-primary">{task.storyPoints}</span>
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

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedTask(null)}>
          <Card className="w-full max-w-[500px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={selectedTask.priority === "CRITICAL" ? "destructive" : "outline"}>{selectedTask.priority || "—"}</Badge>
                <span className="text-xs font-mono text-muted-foreground">{selectedTask.id.slice(-8)}</span>
              </div>
              <button onClick={() => setSelectedTask(null)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </CardHeader>
            <CardContent className="space-y-4">
              <h2 className="text-base font-bold">{selectedTask.title}</h2>
              {selectedTask.description && <p className="text-sm text-muted-foreground">{selectedTask.description}</p>}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{selectedTask.status}</Badge></div>
                <div><span className="text-muted-foreground">Story Points:</span> <strong>{selectedTask.storyPoints || "—"}</strong></div>
                <div><span className="text-muted-foreground">Progress:</span> <strong>{selectedTask.progress || 0}%</strong></div>
                <div><span className="text-muted-foreground">Assignee:</span> <strong>{selectedTask.assigneeId || "Unassigned"}</strong></div>
                {selectedTask.startDate && <div><span className="text-muted-foreground">Start:</span> <strong>{new Date(selectedTask.startDate).toLocaleDateString()}</strong></div>}
                {selectedTask.endDate && <div><span className="text-muted-foreground">End:</span> <strong>{new Date(selectedTask.endDate).toLocaleDateString()}</strong></div>}
              </div>
              <Progress value={selectedTask.progress || 0} className="h-2" />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
