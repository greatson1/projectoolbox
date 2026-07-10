"use client";

import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProjectIssues } from "@/hooks/use-api";
import { Card } from "@/components/ui/card";
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

const DEFECT_STATUSES = ["OPEN", "IN_REVIEW", "FIXED", "CLOSED", "WONT_FIX"];
const OPEN_STATES = new Set(["OPEN", "IN_REVIEW", "IN_PROGRESS"]);

export default function QATestingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  // Real Defect rows (quality management model added in review P1).
  const { data: defects, isLoading: defectsLoading } = useQuery({
    queryKey: ["defects", projectId],
    queryFn: () =>
      fetch(`/api/projects/${projectId}/defects`)
        .then((r) => r.json())
        .then((j) => j.data ?? []),
    enabled: !!projectId,
  });
  // Legacy quality-tagged Issues logged before the Defect model existed —
  // kept visible (read-only) so history doesn't vanish.
  const { data: issues, isLoading: issuesLoading } = useProjectIssues(projectId);
  const isLoading = defectsLoading || issuesLoading;

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

  const legacy = (issues || []).filter(
    (issue: any) => issue.category === "quality" || issue.category === "defect" || issue.category === "qa",
  );
  const items = [
    ...(defects || []).map((d: any) => ({ ...d, kind: "defect" })),
    ...legacy.map((i: any) => ({ ...i, kind: "legacy" })),
  ];

  const openCount = items.filter((d: any) => OPEN_STATES.has((d.status || "").toUpperCase())).length;
  const resolvedCount = items.length - openCount;
  const hasCritical = items.some(
    (d: any) => (d.severity || "").toUpperCase() === "CRITICAL" && OPEN_STATES.has((d.status || "").toUpperCase()),
  );

  const qualityGate = items.length === 0 ? "N/A" : hasCritical ? "FAILED" : openCount === 0 ? "PASSED" : "OPEN";
  const gateColor =
    qualityGate === "PASSED" ? "text-green-500" : qualityGate === "FAILED" ? "text-destructive" : "text-amber-500";

  const refresh = () => qc.invalidateQueries({ queryKey: ["defects", projectId] });

  const handleAdd = () => {
    const title = prompt("Defect title:");
    if (!title) return;
    const severityRaw = prompt("Severity (LOW / MEDIUM / HIGH / CRITICAL):", "MEDIUM") || "MEDIUM";
    fetch(`/api/projects/${projectId}/defects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, severity: severityRaw.toUpperCase() }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => {
        toast.success("Defect logged");
        refresh();
      })
      .catch(() => toast.error("Failed to log defect"));
  };

  const handleStatusChange = (defectId: string, status: string) => {
    let resolutionNote: string | null = null;
    if (status === "FIXED" || status === "WONT_FIX") {
      resolutionNote = prompt(status === "FIXED" ? "What fixed it? (optional)" : "Why won't this be fixed? (optional)");
    }
    fetch(`/api/projects/${projectId}/defects/${defectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(resolutionNote ? { resolutionNote } : {}) }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => {
        toast.success("Defect updated");
        refresh();
      })
      .catch(() => toast.error("Failed to update defect"));
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
            <p className="text-xs text-muted-foreground">Open critical defects must be resolved before the gate can pass</p>
          )}
          {qualityGate === "OPEN" && (
            <p className="text-xs text-muted-foreground">{openCount} open defect{openCount !== 1 ? "s" : ""} remaining</p>
          )}
          {qualityGate === "PASSED" && <p className="text-xs text-green-500">All defects resolved</p>}
        </div>
      </Card>

      {/* Empty State or Table */}
      {items.length === 0 ? (
        <div className="text-center py-20">
          <TestTube2 className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No defects logged</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Log snags and quality issues here — critical open defects fail the quality gate.
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
                  {["ID", "Title", "Severity", "Status", "Task / Component", "Age", "Resolution"].map((h) => (
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
                {items.map((item: any, idx: number) => {
                  const rowId = item.id ? `DEF-${String(item.id).slice(-3).padStart(3, "0")}` : `DEF-${idx + 1}`;
                  const severity = (item.severity || "MEDIUM").toUpperCase();
                  const status = (item.status || "OPEN").toUpperCase();
                  const component =
                    item.kind === "defect" ? item.task?.title || "-" : item.component || item.category || "-";

                  let age = "-";
                  if (item.createdAt) {
                    const days = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                    age = days === 0 ? "today" : `${days}d`;
                  }

                  return (
                    <tr key={`${item.kind}-${item.id || idx}`} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-primary">{rowId}</td>
                      <td className="py-2.5 px-4 font-medium max-w-[300px] truncate" title={item.description || item.title}>
                        {item.title}
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant={SEVERITY_VARIANT[severity] || "secondary"} className="text-[10px]">
                          {severity}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        {item.kind === "defect" ? (
                          <select
                            className="bg-transparent border border-border rounded-md px-1.5 py-0.5 text-[11px]"
                            value={status}
                            onChange={(e) => handleStatusChange(item.id, e.target.value)}
                          >
                            {DEFECT_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge variant="outline" className="text-[10px]" title="Legacy issue — managed on the Issues page">
                            {status.replace(/_/g, " ")} (legacy)
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground max-w-[200px] truncate">{component}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{age}</td>
                      <td className="py-2.5 px-4 text-muted-foreground max-w-[220px] truncate" title={item.resolutionNote || ""}>
                        {item.resolutionNote || "-"}
                      </td>
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
