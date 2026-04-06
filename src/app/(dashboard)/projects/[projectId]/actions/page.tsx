"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ClipboardList, Plus, AlertTriangle, CheckCircle2, Clock, Timer } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  OPEN: "outline",
  IN_PROGRESS: "secondary",
  COMPLETED: "default",
  OVERDUE: "destructive",
};

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HIGH: "destructive",
  MED: "secondary",
  LOW: "outline",
};

interface Action {
  id: string;
  actionId: string;
  title: string;
  owner: string;
  priority: "HIGH" | "MED" | "LOW";
  dueDate: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
}

const demoActions: Action[] = [];

export default function ActionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [isLoading, setIsLoading] = useState(false);
  const [actions] = useState<Action[]>(demoActions);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const overdue = actions.filter(a => a.status === "OVERDUE").length;
  const completedThisWeek = actions.filter(a => {
    if (a.status !== "COMPLETED") return false;
    return true; // placeholder — in real app, filter by completion date within last 7 days
  }).length;
  const avgDaysToClose = actions.length > 0 ? 4.2 : 0;

  const allActions = actions;
  const overdueActions = actions.filter(a => a.status === "OVERDUE");
  const myActions = actions; // placeholder — in real app, filter by current user

  function renderTable(items: Action[]) {
    if (items.length === 0) {
      return (
        <div className="text-center py-20">
          <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No actions logged yet</h2>
          <p className="text-sm text-muted-foreground mb-4">Your AI agent tracks actions from meetings and decisions automatically.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add First Action</Button>
        </div>
      );
    }

    return (
      <Card className="p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {["ID", "Action", "Owner", "Priority", "Due Date", "Status"].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(a => (
              <tr key={a.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer">
                <td className="py-2.5 px-4 font-mono font-medium text-muted-foreground">{a.actionId}</td>
                <td className="py-2.5 px-4 font-medium max-w-[300px] truncate">{a.title}</td>
                <td className="py-2.5 px-4 text-muted-foreground">{a.owner}</td>
                <td className="py-2.5 px-4"><Badge variant={PRIORITY_VARIANT[a.priority] || "outline"}>{a.priority}</Badge></td>
                <td className="py-2.5 px-4 text-muted-foreground">{a.dueDate}</td>
                <td className="py-2.5 px-4"><Badge variant={STATUS_VARIANT[a.status] || "outline"}>{a.status.replace("_", " ")}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Action Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {actions.length} actions · {overdue} overdue · {completedThisWeek} completed this week
          </p>
        </div>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Action</Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Actions</p>
              <p className="text-2xl font-bold">{actions.length}</p>
            </div>
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Overdue</p>
              <p className="text-2xl font-bold text-destructive">{overdue}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Completed This Week</p>
              <p className="text-2xl font-bold text-green-500">{completedThisWeek}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Days to Close</p>
              <p className="text-2xl font-bold">{avgDaysToClose > 0 ? avgDaysToClose.toFixed(1) : "---"}</p>
            </div>
            <Timer className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all" className="text-[13px] font-semibold">All Actions</TabsTrigger>
          <TabsTrigger value="overdue" className="text-[13px] font-semibold">Overdue</TabsTrigger>
          <TabsTrigger value="my-actions" className="text-[13px] font-semibold">My Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {renderTable(allActions)}
        </TabsContent>

        <TabsContent value="overdue" className="space-y-4">
          {overdueActions.length === 0 && actions.length > 0 ? (
            <div className="text-center py-20">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No overdue actions</h2>
              <p className="text-sm text-muted-foreground">All actions are on track. Great job!</p>
            </div>
          ) : (
            renderTable(overdueActions)
          )}
        </TabsContent>

        <TabsContent value="my-actions" className="space-y-4">
          {renderTable(myActions)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
