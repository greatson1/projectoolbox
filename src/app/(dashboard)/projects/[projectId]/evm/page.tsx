"use client";

import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/hooks/use-api";
import { TrendingUp } from "lucide-react";

export default function EVMDashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div></div>;

  const budget = project?.budget || 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div><h1 className="text-2xl font-bold">Earned Value Management</h1><p className="text-sm text-muted-foreground mt-1">{project?.name || "Project"} · BAC: ${budget.toLocaleString()}</p></div>

      {budget === 0 ? (
        <div className="text-center py-20">
          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">EVM not available</h2>
          <p className="text-sm text-muted-foreground">EVM metrics require a project budget, schedule baseline, and task progress data. Your AI agent will calculate these automatically as the project progresses.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "BAC", value: `$${(budget/1000).toFixed(0)}K`, desc: "Budget at Completion" },
              { label: "PV", value: "—", desc: "Planned Value" },
              { label: "EV", value: "—", desc: "Earned Value" },
              { label: "AC", value: "—", desc: "Actual Cost" },
            ].map(m => (
              <Card key={m.label} className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</p>
                <p className="text-2xl font-bold text-primary">{m.value}</p>
                <p className="text-[10px] text-muted-foreground">{m.desc}</p>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="pt-5 text-center py-12">
              <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">EVM calculations (SPI, CPI, EAC, ETC, VAC, TCPI) will be populated as your agent tracks progress against the schedule and cost baselines.</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
