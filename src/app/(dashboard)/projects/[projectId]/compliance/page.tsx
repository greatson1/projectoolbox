"use client";

import { useParams } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getMethodology } from "@/lib/methodology-definitions";
import { ShieldCheck, CheckCircle2, Clock, BarChart3 } from "lucide-react";

export default function CompliancePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const methodology = getMethodology(project?.methodology || "prince2");
  const phases = methodology.phases || [];

  // Determine gate status from project phases data if available
  const projectPhases: any[] = project?.phases || [];
  const getPhaseStatus = (phaseName: string): string => {
    const match = projectPhases.find(
      (p: any) => p.name?.toLowerCase() === phaseName.toLowerCase() || p.phase?.toLowerCase() === phaseName.toLowerCase()
    );
    return match?.status || match?.gateStatus || "NOT_STARTED";
  };

  const totalGates = phases.length;
  const passedGates = phases.filter((p) => {
    const status = getPhaseStatus(p.name);
    return status === "COMPLETED" || status === "APPROVED" || status === "CLOSED";
  }).length;
  const pendingGates = totalGates - passedGates;
  const complianceScore = totalGates > 0 ? Math.round((passedGates / totalGates) * 100) : 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Governance & Compliance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {methodology.name} methodology - {totalGates} phase gate{totalGates !== 1 ? "s" : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled title="Coming soon">
          <ShieldCheck className="w-4 h-4 mr-1" /> Run Audit
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Gates</p>
              <p className="text-2xl font-bold">{totalGates}</p>
            </div>
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Passed</p>
              <p className="text-2xl font-bold text-green-500">{passedGates}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold text-amber-500">{pendingGates}</p>
            </div>
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Compliance Score</p>
              <p className="text-2xl font-bold">{complianceScore}%</p>
            </div>
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
        </Card>
      </div>

      {/* Phase Gates Checklist */}
      {phases.length === 0 ? (
        <div className="text-center py-20">
          <ShieldCheck className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No compliance data</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Deploy an agent to begin governance tracking.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {phases.map((phase, phaseIdx) => {
            const status = getPhaseStatus(phase.name);
            const isPassed = status === "COMPLETED" || status === "APPROVED" || status === "CLOSED";
            const isInProgress = status === "IN_PROGRESS" || status === "PENDING_APPROVAL";

            return (
              <Card key={phaseIdx}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: phase.color }}
                      />
                      <div>
                        <CardTitle className="text-sm">{phase.gate.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {phase.name} - {phase.description}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={isPassed ? "default" : isInProgress ? "secondary" : "outline"}
                      className="text-[10px]"
                    >
                      {isPassed ? "PASSED" : isInProgress ? "IN PROGRESS" : "PENDING"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground mb-3 italic">{phase.gate.criteria}</p>
                  <div className="space-y-2">
                    {phase.gate.preRequisites.map((prereq, prereqIdx) => (
                      <label
                        key={prereqIdx}
                        className="flex items-start gap-2.5 text-xs cursor-default"
                      >
                        <input
                          type="checkbox"
                          checked={isPassed}
                          readOnly
                          className="mt-0.5 rounded border-border pointer-events-none"
                        />
                        <span className={isPassed ? "text-muted-foreground line-through" : "text-foreground"}>
                          {prereq.description}
                          {prereq.isMandatory && (
                            <span className="text-destructive ml-1">*</span>
                          )}
                          {prereq.requiresHumanApproval && (
                            <Badge variant="outline" className="text-[8px] ml-1.5 py-0">
                              requires approval
                            </Badge>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
