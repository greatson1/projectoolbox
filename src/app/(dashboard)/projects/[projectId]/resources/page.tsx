"use client";

import { useParams } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserPlus, BarChart3, Clock } from "lucide-react";

export default function ResourcesPage() {
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
        <h1 className="text-2xl font-bold">Resources</h1>
        <Button size="sm">
          <UserPlus className="h-4 w-4 mr-2" />Add Team Member
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">0</p>
                <p className="text-xs text-muted-foreground">Team Size</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">--</p>
                <p className="text-xs text-muted-foreground">Avg Allocation</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">0h</p>
                <p className="text-xs text-muted-foreground">Total Hours/Week</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Directory Empty State */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Team Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium mb-2">No team members assigned</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Resource allocation will appear when team members are assigned to tasks.
            </p>
            <Button variant="outline" size="sm">
              <UserPlus className="h-4 w-4 mr-2" />Add Team Member
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Capacity Empty State */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Capacity vs Allocation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground max-w-md">
              Your AI agent will populate this module as it manages the project.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
