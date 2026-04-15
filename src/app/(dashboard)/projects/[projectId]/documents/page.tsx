"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { SpreadsheetViewer } from "@/components/documents/SpreadsheetViewer";
import { isSpreadsheetArtefact } from "@/lib/artefact-types";
import { marked } from "marked";
import {
  FileText, FolderOpen, Download, Eye, CheckCircle2,
  Clock, ChevronDown, ChevronRight, FileSpreadsheet, Search,
} from "lucide-react";

const STATUS_COLOUR: Record<string, string> = {
  APPROVED: "text-emerald-600 border-emerald-600/30 bg-emerald-500/10",
  DRAFT: "text-muted-foreground border-border",
  PENDING_REVIEW: "text-amber-600 border-amber-600/30 bg-amber-500/10",
  REJECTED: "text-red-600 border-red-600/30 bg-red-500/10",
};

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DocumentsLibraryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [viewingDoc, setViewingDoc] = useState<any>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "approved" | "draft" | "review">("all");
  const [search, setSearch] = useState("");

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1200px]">
        <Skeleton className="h-10 w-64" />
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      </div>
    );
  }

  const docs = (artefacts || []) as any[];

  // Filter
  const filtered = docs.filter(d => {
    if (filter === "approved" && d.status !== "APPROVED") return false;
    if (filter === "draft" && d.status !== "DRAFT") return false;
    if (filter === "review" && d.status !== "PENDING_REVIEW") return false;
    if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Group by phase
  const byPhase = new Map<string, any[]>();
  for (const doc of filtered) {
    const phase = doc.phaseName || doc.phaseId || "Ungrouped";
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase)!.push(doc);
  }

  // Auto-expand all phases on first render
  if (expandedPhases.size === 0 && byPhase.size > 0) {
    setExpandedPhases(new Set(byPhase.keys()));
  }

  const togglePhase = (phase: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      next.has(phase) ? next.delete(phase) : next.add(phase);
      return next;
    });
  };

  const totalDocs = docs.length;
  const approvedCount = docs.filter(d => d.status === "APPROVED").length;
  const draftCount = docs.filter(d => d.status === "DRAFT").length;

  const handleDownload = async (doc: any, format: string) => {
    try {
      const res = await fetch(`/api/agents/artefacts/${doc.id}/export?format=${format}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.name}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalDocs} document{totalDocs !== 1 ? "s" : ""} &middot; {approvedCount} approved &middot; {draftCount} draft
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-muted border border-border outline-none focus:border-primary transition-colors"
          />
        </div>
        {(["all", "approved", "draft", "review"] as const).map(f => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm"
            onClick={() => setFilter(f)} className="text-xs capitalize">
            {f === "review" ? "In Review" : f}
          </Button>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-20">
          <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No documents {filter !== "all" ? `with status "${filter}"` : "yet"}</h2>
          <p className="text-sm text-muted-foreground">Documents will appear here as your agent generates them.</p>
        </div>
      )}

      {/* Documents grouped by phase */}
      {[...byPhase.entries()].map(([phase, phaseDocs]) => {
        const isExpanded = expandedPhases.has(phase);
        const phaseApproved = phaseDocs.filter(d => d.status === "APPROVED").length;

        return (
          <div key={phase}>
            <button onClick={() => togglePhase(phase)}
              className="flex items-center gap-2 w-full text-left py-2 hover:opacity-80 transition-opacity">
              {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <h2 className="text-sm font-bold">{phase}</h2>
              <span className="text-[10px] text-muted-foreground">{phaseApproved}/{phaseDocs.length} approved</span>
            </button>

            {isExpanded && (
              <div className="space-y-2 ml-6 mt-1">
                {phaseDocs.map((doc: any) => {
                  const isSheet = isSpreadsheetArtefact(doc.name);
                  return (
                    <Card key={doc.id} className="hover:border-primary/20 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                            {isSheet
                              ? <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                              : <FileText className="w-4 h-4 text-primary" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold truncate">{doc.name}</span>
                              <Badge variant="outline" className={`text-[9px] ${STATUS_COLOUR[doc.status] || ""}`}>
                                {doc.status === "APPROVED" ? "Approved" : doc.status === "DRAFT" ? "Draft" : doc.status === "PENDING_REVIEW" ? "In Review" : doc.status}
                              </Badge>
                              {isSheet && <Badge variant="outline" className="text-[9px]">Spreadsheet</Badge>}
                              {doc.version > 1 && <span className="text-[9px] text-muted-foreground">v{doc.version}</span>}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDate(doc.updatedAt || doc.createdAt)}</span>
                              {doc.agentName && <span>by {doc.agentName}</span>}
                              {doc.metadata?.approvedByName && (
                                <span className="flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                  Approved by {doc.metadata.approvedByName}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="View"
                              onClick={() => setViewingDoc(doc)}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Download"
                              onClick={() => handleDownload(doc, isSheet ? "xlsx" : "docx")}>
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Document viewer modal */}
      {viewingDoc && (
        isSpreadsheetArtefact(viewingDoc.name) ? (
          <SpreadsheetViewer
            name={viewingDoc.name}
            content={viewingDoc.content}
            status={viewingDoc.status}
            version={viewingDoc.version}
            onClose={() => setViewingDoc(null)}
            onSave={async () => {}}
            onApprove={async () => {}}
            onReject={async () => {}}
            readOnly
          />
        ) : (
          <DocumentEditor
            name={viewingDoc.name}
            content={viewingDoc.format === "markdown" ? marked.parse(viewingDoc.content || "") as string : viewingDoc.content}
            status={viewingDoc.status}
            version={viewingDoc.version}
            onClose={() => setViewingDoc(null)}
            onSave={async () => {}}
            onApprove={async () => {}}
            onReject={async () => {}}
            readOnly
          />
        )
      )}
    </div>
  );
}
