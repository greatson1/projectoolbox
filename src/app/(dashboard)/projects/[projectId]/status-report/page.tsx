"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileDown,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MessageSquare,
  Bot,
} from "lucide-react";

type RagStatus = "green" | "amber" | "red";

interface RagItem {
  label: string;
  status: RagStatus;
  note: string;
}

const RAG_COLOURS: Record<RagStatus, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

const RAG_BADGE_STYLES: Record<RagStatus, string> = {
  green: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  red: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
};

const ragStatuses: RagItem[] = [
  { label: "Overall", status: "green", note: "On track" },
  { label: "Schedule", status: "green", note: "SPI 1.02 — 3 days float on critical path" },
  { label: "Cost", status: "amber", note: "CPI 0.98 — minor overspend on contractor rates" },
  { label: "Risk", status: "amber", note: "2 medium risks require active monitoring" },
  { label: "Quality", status: "green", note: "Defect rate within tolerance at 2.1%" },
];

const achievements = [
  "Completed Phase 2 requirements sign-off with all stakeholder groups",
  "Delivered API integration module 4 days ahead of schedule",
  "Successfully migrated 12,400 records to new data platform with zero data loss",
  "Achieved 94% test pass rate on Sprint 14 deliverables",
  "Onboarded 3 additional team members for Phase 3 workstream",
];

const issuesAndRisks = [
  { id: "R-012", type: "Risk" as const, description: "Third-party vendor may not deliver SDK by 18 Apr", severity: "amber" as RagStatus, owner: "Sarah M.", due: "18 Apr 2026" },
  { id: "R-015", type: "Risk" as const, description: "Resource contention with Programme Delta in May", severity: "amber" as RagStatus, owner: "James K.", due: "01 May 2026" },
  { id: "I-008", type: "Issue" as const, description: "UAT environment intermittently unavailable", severity: "red" as RagStatus, owner: "DevOps", due: "08 Apr 2026" },
  { id: "I-009", type: "Issue" as const, description: "Pending legal review on data sharing agreement", severity: "amber" as RagStatus, owner: "Legal", due: "14 Apr 2026" },
];

const milestones = [
  { date: "14 Apr 2026", title: "UAT Commences", status: "On Track" as const },
  { date: "28 Apr 2026", title: "Phase 2 Go/No-Go Decision", status: "On Track" as const },
  { date: "12 May 2026", title: "Production Deployment (Release 2.1)", status: "At Risk" as const },
  { date: "26 May 2026", title: "Phase 3 Kick-off", status: "On Track" as const },
  { date: "09 Jun 2026", title: "End-User Training Complete", status: "On Track" as const },
];

const decisions = [
  { id: "D-004", description: "Approve additional budget of GBP 18,000 for extended UAT cycle", deadline: "10 Apr 2026", owner: "Project Board" },
  { id: "D-005", description: "Confirm go-live date: 12 May or defer to 19 May contingency slot", deadline: "28 Apr 2026", owner: "Sponsor" },
  { id: "D-006", description: "Approve change request CR-021 for scope addition (reporting module)", deadline: "14 Apr 2026", owner: "Change Board" },
];

const REPORT_DATES = [
  "6 April 2026",
  "30 March 2026",
  "23 March 2026",
  "16 March 2026",
];

export default function StatusReportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedDate, setSelectedDate] = useState(REPORT_DATES[0]);

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Project Status Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Weekly status report for Project {projectId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedDate} onValueChange={setSelectedDate}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <Calendar className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_DATES.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline">
            <FileDown className="w-4 h-4 mr-1" /> Export PDF
          </Button>
        </div>
      </div>

      {/* RAG Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">RAG Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {ragStatuses.map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${RAG_COLOURS[item.status]}`} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${RAG_BADGE_STYLES[item.status]}`}
                >
                  {item.status}
                </span>
                <p className="text-[11px] text-muted-foreground leading-snug">{item.note}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Executive Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The project remains on track with an overall <strong className="text-green-600 dark:text-green-400">GREEN</strong> status.
            Phase 2 deliverables are 87% complete with all critical-path activities progressing to plan. The schedule performance
            index (SPI) stands at 1.02 and cost performance index (CPI) at 0.98, indicating minor budget pressure from increased
            contractor day rates. Two medium-rated risks require continued monitoring: vendor SDK delivery timeline and resource
            contention with Programme Delta. UAT is scheduled to commence on 14 April 2026 pending environment stability
            confirmation from DevOps.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Key Achievements */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <CardTitle className="text-sm">Key Achievements</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {achievements.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0" />
                  {a}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Decisions Required */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm">Decisions Required</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {decisions.map((d) => (
                <div key={d.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px]">
                      {d.id}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">by {d.deadline}</span>
                  </div>
                  <p className="text-sm">{d.description}</p>
                  <p className="text-xs text-muted-foreground">Owner: {d.owner}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Issues & Risks */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <CardTitle className="text-sm">Issues &amp; Risks</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">ID</th>
                  <th className="pb-2 pr-4 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Type</th>
                  <th className="pb-2 pr-4 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Description</th>
                  <th className="pb-2 pr-4 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Severity</th>
                  <th className="pb-2 pr-4 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Owner</th>
                  <th className="pb-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Due</th>
                </tr>
              </thead>
              <tbody>
                {issuesAndRisks.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs">{item.id}</td>
                    <td className="py-2.5 pr-4">
                      <Badge variant={item.type === "Issue" ? "destructive" : "secondary"} className="text-[10px]">
                        {item.type}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{item.description}</td>
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${RAG_COLOURS[item.severity]}`} />
                        <span className="capitalize text-xs">{item.severity}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{item.owner}</td>
                    <td className="py-2.5 text-muted-foreground whitespace-nowrap">{item.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Upcoming Milestones */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm">Upcoming Milestones</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-0">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-start gap-4 pb-4 last:pb-0">
                {/* Timeline dot and line */}
                <div className="flex flex-col items-center">
                  <div
                    className={`w-3 h-3 rounded-full border-2 ${
                      m.status === "On Track"
                        ? "border-green-500 bg-green-500/20"
                        : "border-amber-500 bg-amber-500/20"
                    }`}
                  />
                  {i < milestones.length - 1 && (
                    <div className="w-px h-full min-h-[24px] bg-border" />
                  )}
                </div>
                {/* Content */}
                <div className="flex-1 flex items-start justify-between gap-4 -mt-0.5">
                  <div>
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">{m.date}</p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      m.status === "On Track"
                        ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                    }`}
                  >
                    {m.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground border-t">
        <Bot className="w-3.5 h-3.5" />
        <span>Generated by AI Agent</span>
        <span className="text-border">|</span>
        <span>Last updated: {selectedDate}</span>
      </div>
    </div>
  );
}