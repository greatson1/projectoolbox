"use client";

import { useParams } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, Layers, GitBranch, Plus } from "lucide-react";

export default function ScopeManagementPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Scope Management</h1>
        <Button variant="outline" size="sm">
          <Layers className="h-4 w-4 mr-2" />Export WBS
        </Button>
      </div>

      {/* Project Context */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{project?.name || "Untitled Project"}</p>
                <p className="text-xs text-muted-foreground">Project Name</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{project?.methodology || "Not set"}</p>
                <p className="text-xs text-muted-foreground">Methodology</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{project?.phases?.length ?? 0} phases</p>
                <p className="text-xs text-muted-foreground">Project Phases</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* WBS Empty State */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Work Breakdown Structure</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Layers className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium mb-2">No scope data yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Scope data will be generated when your agent analyses project requirements.
            </p>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />Add Work Package
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Requirements Empty State */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Requirements Traceability</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Target className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground max-w-md">
              Your AI agent will populate this module as it manages the project.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
