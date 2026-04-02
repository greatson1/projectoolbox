"use client";

import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/use-api";
import { TestTube2, Plus } from "lucide-react";

export default function QATestingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-xl" /></div>;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">QA & Testing</h1><p className="text-sm text-muted-foreground mt-1">{project?.name || "Project"}</p></div>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create Test Case</Button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[{ l: "Test Cases", v: "0" }, { l: "Pass Rate", v: "—" }, { l: "Defects Open", v: "0" }, { l: "Coverage", v: "—" }].map(s => (
          <Card key={s.l} className="p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</p><p className="text-2xl font-bold">{s.v}</p></Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-5 text-center py-12">
          <TestTube2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-bold mb-2">No test data</h2>
          <p className="text-sm text-muted-foreground mb-4">QA metrics will be tracked as your agent creates test cases, logs defects, and monitors quality throughout the project lifecycle.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create First Test Case</Button>
        </CardContent>
      </Card>
    </div>
  );
}
