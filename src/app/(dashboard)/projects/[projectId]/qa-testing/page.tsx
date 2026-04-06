"use client";

import { useParams } from "next/navigation";
import { useProjectIssues } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, TestTube2, Bug, CheckCircle2, AlertTriangle } from "lucide-react";

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "destructive",
  MEDIUM: "secondary",
  LOW: "outline",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  OPEN: "destructive",
  IN_PROGRESS: "secondary",
  RESOLVED: "default",
  CLOSED: "default",
};

export default function QATestingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: issues, isLoading } = useProjectIssues(projectId);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  // Filter to quality-related issues if category field exists, otherwise show all
  const allIssues = issues || [];
  const items = allIssues.filter(
    (issue: any) => !issue.category || issue.category === "quality" || issue.category === "defect" || issue.category === "qa"
  );

  const openCount = items.filter((d: any) => {
    const s = (d.status || "").toUpperCase();
    return s === "OPEN" || s === "IN_PROGRESS";
  }).length;
  const resolvedCount = items.filter((d: any) => {
    const s = (d.status || "").toUpperCase();
    return s === "RESOLVED" || s === "CLOSED";
  }).length;
  const hasCritical = items.some((d: any) => (d.severity || "").toUpperCase() === "CRITICAL");

  const qualityGate = items.length === 0 ? "N/A" : hasCritical ? "FAILED" : openCount === 0 ? "PASSED" : "OPEN";
  const gateColor =
    qualityGate === "PASSED" ? "text-green-500" : qualityGate === "FAILED" ? "text-destructive" : "text-amber-500";

  const handleAdd = () => {
    const title = prompt("Defect title:");
    if (!title) return;
    fetch(`/api/projects/${projectId}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, severity: "MEDIUM", status: "OPEN", category: "quality" }),
    })
      .then(() => {
        toast.success("Defect logged");
        window.location.reload();
      })
      .catch(() => toast.error("Failed to log defect"));
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">QA & Testing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length} defect{items.length !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="w-4 h-4 mr-1" /> Log Defect
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Defects</p>
              <p className="text-2xl font-bold">{items.length}</p>
            </div>
            <Bug className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Open</p>
              <p className="text-2xl font-bold text-amber-500">{openCount}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Resolved</p>
              <p className="text-2xl font-bold text-green-500">{resolvedCount}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>
        </Card>
      </div>

      {/* Quality Gate */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TestTube2 className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quality Gate</p>
              <p className={`text-lg font-bold ${gateColor}`}>{qualityGate}</p>
            </div>
          </div>
          {qualityGate === "FAILED" && (
            <p className="text-xs text-muted-foreground">Critical defects must be resolved before gate can pass</p>
          )}
          {qualityGate === "OPEN" && (
            <p className="text-xs text-muted-foreground">{openCount} open defect{openCount !== 1 ? "s" : ""} remaining</p>
          )}
          {qualityGate === "PASSED" && (
            <p className="text-xs text-green-500">All defects resolved</p>
          )}
        </div>
      </Card>

      {/* Empty State or Table */}
      {items.length === 0 ? (
        <div className="text-center py-20">
          <TestTube2 className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No quality issues logged</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Your AI agent monitors quality gates and flags defects during execution.
          </p>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="w-4 h-4 mr-1" /> Log First Defect
          </Button>
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {["ID", "Title", "Severity", "Status", "Component", "Age"].map((h) => (
                    <th
                      key={h}
                      className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((issue: any, idx: number) => {
                  const issueId = issue.id ? `DEF-${String(issue.id).slice(-3).padStart(3, "0")}` : `DEF-${idx + 1}`;
                  const severity = (issue.severity || "MEDIUM").toUpperCase();
                  const status = (issue.status || "OPEN").toUpperCase();
                  const component = issue.component || issue.category || "-";

                  // Calculate age
                  let age = "-";
                  if (issue.createdAt) {
                    const days = Math.floor(
                      (Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    age = days === 0 ? "today" : `${days}d`;
                  }

                  return (
                    <tr key={issue.id || idx} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-primary">{issueId}</td>
                      <td className="py-2.5 px-4 font-medium max-w-[300px] truncate">{issue.title}</td>
                      <td className="py-2.5 px-4">
                        <Badge variant={SEVERITY_VARIANT[severity] || "secondary"} className="text-[10px]">
                          {severity}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant={STATUS_VARIANT[status] || "outline"} className="text-[10px]">
                          {status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground capitalize">{component}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{age}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
