// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, FileText, Shield } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  task: "bg-primary/10 text-primary",
  risk: "bg-red-500/10 text-red-500",
  artefact: "bg-emerald-500/10 text-emerald-500",
  approval: "bg-amber-500/10 text-amber-500",
  cost_entry: "bg-cyan-500/10 text-cyan-500",
};

export default function ProjectAuditPage() {
  usePageTitle("Audit Trail");
  const { projectId } = useParams<{ projectId: string }>();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/audit?limit=100`)
      .then(r => r.json())
      .then(d => { setLogs(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  const filtered = logs.filter(l => {
    if (search && !l.action?.toLowerCase().includes(search.toLowerCase()) && !l.target?.toLowerCase().includes(search.toLowerCase()) && !l.rationale?.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter && l.entityType !== typeFilter) return false;
    return true;
  });

  if (loading) return <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;

  return (
    <div className="max-w-[1000px] space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Audit Trail</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{logs.length} recorded actions · Full agent decision traceability</p>
        </div>
        <Shield className="w-5 h-5 text-primary" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search actions, targets, rationale..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
        </div>
        {["All", "task", "risk", "artefact", "approval", "cost_entry"].map(t => (
          <button key={t} onClick={() => setTypeFilter(t === "All" ? null : t)}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${typeFilter === (t === "All" ? null : t) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "All" ? "All" : t.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Log entries */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">No audit entries yet</p>
          <p className="text-xs text-muted-foreground mt-1">Agent actions will appear here as the project progresses</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((l: any) => (
            <Card key={l.id} className="hover:ring-1 hover:ring-primary/10 transition-all">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${ACTION_COLORS[l.entityType] || "bg-muted"}`}>
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold">{l.action}</span>
                      {l.entityType && <Badge variant="secondary" className="text-[9px]">{l.entityType}</Badge>}
                    </div>
                    {l.target && <p className="text-xs text-muted-foreground">{l.target}</p>}
                    {l.rationale && (
                      <p className="text-xs text-muted-foreground mt-1 p-2 rounded-md bg-muted/30 leading-relaxed">{l.rationale}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                      <span>{new Date(l.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      {l.agentId && <span>Agent action</span>}
                      {l.userId && <span>User: {l.userId.slice(0, 8)}...</span>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
