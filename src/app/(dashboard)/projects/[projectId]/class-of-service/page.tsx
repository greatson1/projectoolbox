"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers3, AlertCircle, Sparkles, Zap, Clock, Calendar, Cloud } from "lucide-react";
import { classifyClassOfService, classOfServiceStyle } from "@/lib/kanban-cos";

/**
 * Kanban Class of Service Definitions.
 *
 * Each class declares its pull rules, WIP allowance, and target cycle
 * time. The page renders one card per class with the canonical defaults
 * (Expedite / Standard / Fixed Date / Intangible) styled distinctly so a
 * Kanban operator can see at a glance which class governs which kind of
 * work.
 *
 * Classes not in the canonical four still render but with a neutral
 * icon — the artefact author may have introduced a project-specific
 * class and we don't want to drop it.
 *
 * Bucket classification + colours come from the shared kanban-cos
 * helper so the Agile Board's class-of-service swimlane uses the same
 * palette as this page.
 */

const ICONS: Record<string, typeof Zap> = {
  expedite: Zap,
  standard: Clock,
  fixed: Calendar,
  intangible: Cloud,
  other: Layers3,
};

export default function ClassOfServicePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return (
        a.status === "APPROVED" &&
        (n.includes("class of service") || n.includes("classes of service") || n.includes("service classes"))
      );
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const classes = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;
    return rows.map((row) => ({
      name: pick(row, "Class", "Class of Service", "Name", "Type") || "(Unnamed class)",
      pullRule: pick(row, "Pull Rule", "Pull", "Rule", "Trigger", "Policy"),
      wipAllowance: pick(row, "WIP Allowance", "WIP", "WIP Limit", "Allowance"),
      targetCycleTime: pick(row, "Target Cycle Time", "Cycle Time", "Target", "SLE"),
      description: pick(row, "Description", "Definition", "Purpose"),
      examples: pick(row, "Examples", "Example", "Use Case"),
    }));
  }, [artefact?.content]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1200px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers3 className="w-6 h-6 text-primary" />
            Class of Service
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pull rules and WIP allowances for <span className="font-medium text-foreground">{project?.name}</span>.
            Each class governs how a card is prioritised through the flow.
          </p>
        </div>
        {classes && (
          <Badge variant="outline" className="text-xs">
            {classes.length} {classes.length === 1 ? "class" : "classes"}
          </Badge>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Class of Service Definitions artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Kanban without explicit classes of service averages every card against the same
              cycle time — Expedite work and Intangible improvements get the same priority.
              Generate the <strong>Class of Service Definitions</strong> artefact during Setup
              to declare per-class pull rules.
            </p>
            <Link
              href={`/projects/${projectId}/artefacts`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Open Artefacts
            </Link>
          </CardContent>
        </Card>
      )}

      {artefact && !classes && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Class of Service artefact contains no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {classes && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {classes.map((cls, ci) => {
            const bucket = classifyClassOfService(cls.name);
            const style = classOfServiceStyle(cls.name);
            const Icon = ICONS[bucket] || Layers3;
            return (
              <Card key={`cls-${ci}`} className={`${style.bg} overflow-hidden`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${style.color}15` }}
                    >
                      <Icon className="w-5 h-5" style={{ color: style.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold text-base">{cls.name}</h2>
                      {cls.description && (
                        <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                          {cls.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/40">
                    {cls.pullRule && (
                      <Field label="Pull rule" value={cls.pullRule} />
                    )}
                    {cls.wipAllowance && (
                      <Field label="WIP allowance" value={cls.wipAllowance} />
                    )}
                    {cls.targetCycleTime && (
                      <Field label="Target cycle time" value={cls.targetCycleTime} />
                    )}
                    {cls.examples && (
                      <Field label="Examples" value={cls.examples} />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {artefact && (
        <p className="text-[10px] text-muted-foreground/70 text-right">
          Source:{" "}
          <Link href={`/projects/${projectId}/artefacts`} className="underline hover:text-foreground">
            {artefact.name}
          </Link>
          {" · "}
          updated {new Date(artefact.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xs mt-0.5">{value}</p>
    </div>
  );
}
