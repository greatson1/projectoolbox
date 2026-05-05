"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { useProjectStakeholders } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { parseSource, SourceBadge, RowReasoning, ExpandChevron } from "@/components/artefacts/source-prefix";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Plus, ShieldAlert, Heart, Eye, Download } from "lucide-react";
import { downloadCSV } from "@/lib/export-csv";
import { toast } from "sonner";

interface Stakeholder {
  id: string;
  name: string;
  role: string;
  org: string;
  power: number;
  interest: number;
  sentiment: string;
  email: string;
  lastContact: string;
  influence: string;
  notes: string;
}

function mapStakeholder(s: any, idx: number): Stakeholder {
  return {
    id: s.id || `s${idx}`,
    name: s.name || "Unnamed",
    role: s.role || "",
    org: s.org || s.organization || s.organisation || "",
    // DB stores power/interest as 0-100 (agent-seeded) or 1-5 (manually added).
    // Normalise everything to the 0-5 scale the UI expects.
    power: s.power != null ? (s.power > 5 ? Math.round(s.power / 20) : s.power) : 3,
    interest: s.interest != null ? (s.interest > 5 ? Math.round(s.interest / 20) : s.interest) : 3,
    sentiment: s.sentiment || "unknown",
    email: s.email || "",
    lastContact: s.lastContact || s.last_contact || "",
    influence: s.influence || "",
    notes: s.notes || "",
  };
}

const SENTIMENT_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  supportive: "default",
  neutral: "secondary",
  resistant: "destructive",
  unknown: "outline",
};

export default function StakeholdersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: raw, isLoading, refetch } = useProjectStakeholders(projectId);
  const [adding, setAdding] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const stakeholders: Stakeholder[] = (raw ?? []).map(mapStakeholder);

  /* ---- Stats ---- */
  const total = stakeholders.length;
  const keyPlayers = stakeholders.filter(s => s.power >= 4).length;
  const supporters = stakeholders.filter(s => s.sentiment === "supportive").length;
  const atRisk = stakeholders.filter(s => s.sentiment === "resistant" || s.sentiment === "unknown").length;

  /* ---- Power/Interest quadrants ---- */
  const manageClosely = stakeholders.filter(s => s.power >= 4 && s.interest >= 4).length;
  const keepSatisfied = stakeholders.filter(s => s.power >= 4 && s.interest < 4).length;
  const keepInformed = stakeholders.filter(s => s.power < 4 && s.interest >= 4).length;
  const monitor = stakeholders.filter(s => s.power < 4 && s.interest < 4).length;

  /* ---- Add stakeholder ---- */
  function handleAdd() {
    const name = prompt("Stakeholder name:");
    if (!name?.trim()) return;
    setAdding(true);
    fetch(`/api/projects/${projectId}/stakeholders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), role: "Stakeholder", power: 3, interest: 3 }),
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed");
        toast.success("Stakeholder added");
        refetch();
      })
      .catch(() => toast.error("Failed to add stakeholder"))
      .finally(() => setAdding(false));
  }

  /* ---- Loading ---- */
  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  /* ---- Empty state ---- */
  if (stakeholders.length === 0) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Stakeholders</h1>
          <Button size="sm" onClick={handleAdd} disabled={adding}>
            <Plus className="w-4 h-4 mr-1" /> Add Stakeholder
          </Button>
        </div>
        <Card>
          <div className="text-center py-20">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">No stakeholders registered</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your AI agent identifies and registers stakeholders from project documentation and meetings.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Stakeholders</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const rows: (string | number | null | undefined)[][] = [
                ["Name", "Role", "Organisation", "Email", "Power", "Interest", "Sentiment", "Last Contact"],
                ...stakeholders.map((s) => [
                  s.name,
                  s.role,
                  s.org,
                  s.email,
                  s.power,
                  s.interest,
                  s.sentiment,
                  s.lastContact,
                ]),
              ];
              downloadCSV(rows, `stakeholders-${projectId}.csv`);
            }}
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            Download CSV
          </Button>
          <Button size="sm" onClick={handleAdd} disabled={adding}>
            <Plus className="w-4 h-4 mr-1" /> Add Stakeholder
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{keyPlayers}</p>
              <p className="text-xs text-muted-foreground">Key Players</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Heart className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{supporters}</p>
              <p className="text-xs text-muted-foreground">Supporters</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Eye className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{atRisk}</p>
              <p className="text-xs text-muted-foreground">At Risk</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Power/Interest Grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Power / Interest Grid</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 grid-rows-2 gap-px rounded-lg overflow-hidden border border-border">
            {/* Row 1: High Power */}
            <div className="bg-amber-500/8 p-4 flex flex-col items-center justify-center min-h-[100px]">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Keep Satisfied</p>
              <p className="text-3xl font-bold">{keepSatisfied}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">High Power, Low Interest</p>
            </div>
            <div className="bg-red-500/8 p-4 flex flex-col items-center justify-center min-h-[100px]">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Manage Closely</p>
              <p className="text-3xl font-bold">{manageClosely}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">High Power, High Interest</p>
            </div>
            {/* Row 2: Low Power */}
            <div className="bg-slate-500/8 p-4 flex flex-col items-center justify-center min-h-[100px]">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Monitor</p>
              <p className="text-3xl font-bold">{monitor}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Low Power, Low Interest</p>
            </div>
            <div className="bg-indigo-500/8 p-4 flex flex-col items-center justify-center min-h-[100px]">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Keep Informed</p>
              <p className="text-3xl font-bold">{keepInformed}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Low Power, High Interest</p>
            </div>
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-muted-foreground px-1">
            <span>Low Interest</span>
            <span>High Interest</span>
          </div>
        </CardContent>
      </Card>

      {/* Stakeholder Table */}
      <Card className="p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {["Name", "Role", "Organisation", "Power", "Interest", "Sentiment", "Last Contact"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stakeholders.map(s => {
              const parsed = parseSource(s.notes);
              const hasReasoning = parsed.kind !== "unknown" && (!!parsed.reasoning || parsed.alternatives.length > 0);
              const isExpanded = expandedRow === s.id;
              return (
                <React.Fragment key={s.id}>
                  <tr
                    className={`border-b border-border hover:bg-muted/50 transition-colors ${hasReasoning ? "cursor-pointer" : ""}`}
                    onClick={() => hasReasoning && setExpandedRow(isExpanded ? null : s.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        {hasReasoning && <span className="mt-1"><ExpandChevron expanded={isExpanded} /></span>}
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">{s.name}</p>
                            {parsed.kind !== "unknown" && <SourceBadge kind={parsed.kind} />}
                          </div>
                          {s.email && <p className="text-[10px] text-muted-foreground">{s.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.role || "-"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.org || "-"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-0.5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <span
                            key={i}
                            className={`w-2.5 h-2.5 rounded-sm ${i < s.power ? "bg-primary" : "bg-border"}`}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-0.5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <span
                            key={i}
                            className={`w-2.5 h-2.5 rounded-sm ${i < s.interest ? "bg-cyan-400" : "bg-border"}`}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={SENTIMENT_BADGE[s.sentiment] ?? "outline"} className="capitalize text-[10px]">
                        {s.sentiment}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.lastContact || "-"}</td>
                  </tr>
                  {isExpanded && hasReasoning && (
                    <tr className="bg-muted/10 border-b border-border/30">
                      <td colSpan={7} className="py-3 px-6">
                        <RowReasoning source={parsed} label="Why this stakeholder + this engagement strategy?" />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
