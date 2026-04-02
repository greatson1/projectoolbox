"use client";

import { useParams } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileBarChart, FileText, Play, Clock } from "lucide-react";

const templates = [
  {
    id: "status",
    name: "Status Report",
    description: "Weekly project status including schedule, budget, risks, and key decisions.",
    frequency: "Weekly",
  },
  {
    id: "executive",
    name: "Executive Summary",
    description: "High-level overview for steering committee and senior stakeholders.",
    frequency: "Monthly",
  },
  {
    id: "risk",
    name: "Risk Report",
    description: "Comprehensive risk analysis with mitigation strategies and trend data.",
    frequency: "Bi-weekly",
  },
  {
    id: "evm",
    name: "EVM Report",
    description: "Earned Value Management metrics including CPI, SPI, EAC, and ETC.",
    frequency: "Monthly",
  },
];

export default function ReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reports</h1>
        <Badge variant="secondary">0 reports generated</Badge>
      </div>

      {/* Report Templates */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Report Templates</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t) => (
            <Card key={t.id} className="hover:bg-muted/50 transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FileBarChart className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                  </div>
                  <Badge variant="outline">{t.frequency}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{t.description}</p>
                <Button size="sm" variant="outline" className="w-full">
                  <Play className="h-4 w-4 mr-2" />Generate Report
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Reports Empty State */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium mb-2">No reports yet</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Reports will be generated automatically by your agent on schedule.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
