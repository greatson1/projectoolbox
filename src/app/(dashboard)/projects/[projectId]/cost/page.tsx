"use client";

import { useParams } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, PoundSterling, Plus } from "lucide-react";

export default function CostManagementPage() {
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

  const budget = project?.budget;
  const hasBudget = budget !== null && budget !== undefined && budget > 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cost Management</h1>
        {hasBudget && (
          <Badge variant="secondary">
            Budget: {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(budget)}
          </Badge>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <PoundSterling className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">
                  {hasBudget
                    ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(budget)
                    : "--"}
                </p>
                <p className="text-xs text-muted-foreground">Total Budget</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">--</p>
                <p className="text-xs text-muted-foreground">Actual Spend</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">--</p>
                <p className="text-xs text-muted-foreground">CPI</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Budget Breakdown Empty State */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Budget vs Actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <PoundSterling className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium mb-2">No cost data yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Cost tracking begins when tasks are created and resources assigned.
            </p>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />Add Budget Line
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
