"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FolderArchive, Sparkles, Printer, CheckSquare, Square, FileText } from "lucide-react";

/**
 * Documentation Bundle.
 *
 * Packages the canonical subsidiary documents of a methodology into a
 * single scrollable, print-ready view so a PM can hand over a complete
 * "Project Management Plan" / "PID pack" to a sponsor without copying
 * artefacts one at a time.
 *
 * The methodology determines which subsidiary documents to look for:
 *   - PMBOK / Waterfall / Traditional / Hybrid → PMBOK-style subsidiary
 *     plans (Scope, Schedule, Cost, Quality, Resource, Communications,
 *     Risk, Procurement, Stakeholder)
 *   - Traditional / PRINCE2-aligned → PID + Strategy documents
 *
 * The user picks which approved artefacts to include via checkboxes,
 * then clicks Print to use the browser's print dialog (which produces
 * a clean PDF on any modern browser). Print-only CSS hides the
 * controls.
 */

interface SubsidiarySpec {
  /** Display label for the section. */
  label: string;
  /** Lower-cased name fragments to match candidate artefacts against. */
  patterns: string[];
}

/**
 * Methodology → ordered list of subsidiary documents to look for. Order
 * matters: it's the order the section renders in the bundle.
 */
const SUBSIDIARIES_BY_METHODOLOGY: Record<string, SubsidiarySpec[]> = {
  pmbok: [
    { label: "Project Charter", patterns: ["project charter"] },
    { label: "Stakeholder Register", patterns: ["stakeholder register", "initial stakeholder register"] },
    { label: "Scope Management Plan", patterns: ["scope management plan"] },
    { label: "Schedule Management Plan", patterns: ["schedule management plan"] },
    { label: "Cost Management Plan", patterns: ["cost management plan"] },
    { label: "Quality Management Plan", patterns: ["quality management plan"] },
    { label: "Resource Management Plan", patterns: ["resource management plan"] },
    { label: "Communications Management Plan", patterns: ["communications management plan", "communication plan"] },
    { label: "Risk Management Plan", patterns: ["risk management plan", "risk management strategy"] },
    { label: "Procurement Management Plan", patterns: ["procurement management plan", "procurement plan"] },
    { label: "Stakeholder Engagement Plan", patterns: ["stakeholder engagement plan"] },
  ],
  waterfall: [
    { label: "Project Charter", patterns: ["project charter"] },
    { label: "Business Case", patterns: ["business case"] },
    { label: "Requirements Documentation", patterns: ["requirements documentation", "requirements specification"] },
    { label: "Scope Statement", patterns: ["scope statement"] },
    { label: "WBS", patterns: ["work breakdown structure", "wbs"] },
    { label: "Schedule", patterns: ["schedule with dependencies", "project schedule", "schedule"] },
    { label: "Cost Management Plan", patterns: ["cost management plan"] },
    { label: "Quality Management Plan", patterns: ["quality management plan"] },
    { label: "Resource Management Plan", patterns: ["resource management plan"] },
    { label: "Communication Plan", patterns: ["communication plan"] },
    { label: "Risk Management Plan", patterns: ["risk management plan", "risk management strategy"] },
  ],
  traditional: [
    { label: "Project Brief", patterns: ["project brief"] },
    { label: "Business Case", patterns: ["business case", "outline business case"] },
    { label: "Project Initiation Documentation (PID)", patterns: ["project initiation document", "pid"] },
    { label: "Project Charter", patterns: ["project charter"] },
    { label: "Stakeholder Register", patterns: ["stakeholder register", "initial stakeholder register"] },
    { label: "Risk Management Strategy", patterns: ["risk management strategy", "risk management plan"] },
    { label: "Quality Management Strategy", patterns: ["quality management strategy", "quality management plan"] },
    { label: "Configuration Management Strategy", patterns: ["configuration management strategy"] },
    { label: "Communication Plan", patterns: ["communication plan", "communications management plan"] },
    { label: "WBS", patterns: ["work breakdown structure", "wbs"] },
    { label: "Schedule", patterns: ["schedule with dependencies", "project schedule", "schedule"] },
    { label: "Cost Management Plan", patterns: ["cost management plan"] },
  ],
  hybrid: [
    { label: "Hybrid Charter", patterns: ["hybrid charter", "project charter"] },
    { label: "Delivery Approach", patterns: ["delivery approach"] },
    { label: "Business Case", patterns: ["business case"] },
    { label: "Initial Stakeholder Register", patterns: ["stakeholder register", "initial stakeholder register"] },
    { label: "Initial Risk Register", patterns: ["risk register", "initial risk register"] },
    { label: "Governance Cadence", patterns: ["governance cadence", "governance plan"] },
    { label: "Communication Plan", patterns: ["communication plan"] },
    { label: "Cost Management Plan", patterns: ["cost management plan"] },
  ],
};

function resolveMethodology(id: string | null | undefined): keyof typeof SUBSIDIARIES_BY_METHODOLOGY {
  if (!id) return "traditional";
  const n = id.toLowerCase();
  if (n.includes("pmbok")) return "pmbok";
  if (n.includes("waterfall")) return "waterfall";
  if (n.includes("hybrid")) return "hybrid";
  return "traditional";
}

export default function DocumentBundlePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const methodology = resolveMethodology((project as any)?.methodology);
  const subsidiaries = SUBSIDIARIES_BY_METHODOLOGY[methodology];
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  type Section = {
    label: string;
    artefact: { id: string; name: string; content: string; updatedAt: string } | null;
  };

  const sections = useMemo<Section[]>(() => {
    if (!artefacts) return [];
    return subsidiaries.map((spec) => {
      const candidates = artefacts.filter((a: any) => {
        if (a.status !== "APPROVED") return false;
        const n = (a.name || "").toLowerCase();
        return spec.patterns.some((p) => n.includes(p));
      });
      const winner = candidates.length > 0
        ? candidates.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
        : null;
      return {
        label: spec.label,
        artefact: winner ? { id: winner.id, name: winner.name, content: winner.content || "", updatedAt: winner.updatedAt } : null,
      };
    });
  }, [artefacts, subsidiaries]);

  const found = sections.filter((s) => s.artefact);
  const missing = sections.filter((s) => !s.artefact);
  const included = found.filter((s) => !excluded.has(s.label));

  const toggleExclude = (label: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1200px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1100px]">
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white !important; color: black !important; }
          .doc-section { break-inside: avoid; page-break-before: always; }
          .doc-section:first-of-type { page-break-before: auto; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="flex items-start justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderArchive className="w-6 h-6 text-primary" />
            Documentation Bundle
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hand-over pack for <span className="font-medium text-foreground">{project?.name}</span>.
            Pick the sections to include, then print or save as PDF.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={included.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Printer className="w-3.5 h-3.5" />
          Print / Save as PDF
        </button>
      </div>

      <div className="no-print">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {found.length} of {sections.length} subsidiary documents approved
              </h2>
              <Badge variant="outline" className="text-xs">{included.length} included</Badge>
            </div>
            {found.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No subsidiary documents are approved yet. Generate and approve any of the artefacts
                this methodology defines, then return here.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {found.map((s) => {
                  const isIncluded = !excluded.has(s.label);
                  return (
                    <button
                      key={s.label}
                      onClick={() => toggleExclude(s.label)}
                      className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors text-left"
                    >
                      {isIncluded ? (
                        <CheckSquare className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${isIncluded ? "" : "text-muted-foreground line-through"}`}>
                          {s.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {s.artefact!.name}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {missing.length > 0 && (
              <details className="mt-2 group">
                <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                  Show {missing.length} missing subsidiary{missing.length === 1 ? "" : "s"} (not yet approved)
                </summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2 pl-6">
                  {missing.map((s) => (
                    <p key={s.label} className="text-[11px] text-muted-foreground/70 italic">
                      {s.label}
                    </p>
                  ))}
                </div>
                <div className="pl-6 pt-2">
                  <Link
                    href={`/projects/${projectId}/artefacts`}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <Sparkles className="w-3 h-3" />
                    Generate missing artefacts
                  </Link>
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Render bundle — visible on screen as a preview, primary on print */}
      <div className="bg-card rounded-xl border border-border print:border-0 print:rounded-none print:bg-white">
        <div className="p-6 sm:p-10 space-y-8">
          {/* Cover */}
          <div className="text-center border-b border-border/40 pb-6 doc-section">
            <h1 className="text-3xl font-bold">{project?.name || "Project Bundle"}</h1>
            <p className="text-sm text-muted-foreground mt-2">Documentation Bundle</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Generated {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
            <p className="text-[11px] text-muted-foreground mt-3">
              {included.length} section{included.length === 1 ? "" : "s"} · methodology: {methodology}
            </p>
          </div>

          {included.length === 0 && (
            <p className="text-center text-sm text-muted-foreground italic py-12">
              No sections included in the bundle yet.
            </p>
          )}

          {included.map((s) => (
            <section key={s.label} className="doc-section space-y-3">
              <div className="border-b border-border/40 pb-2">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  {s.label}
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Source: {s.artefact!.name} · updated{" "}
                  {new Date(s.artefact!.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                {s.artefact!.content.trimStart().startsWith("<") ? (
                  <div dangerouslySetInnerHTML={{ __html: s.artefact!.content }} />
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.artefact!.content}</ReactMarkdown>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
