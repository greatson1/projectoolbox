"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bot,
  FileText,
  BarChart3,
  AlertTriangle,
  DollarSign,
  Users,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  TrendingUp,
  ArrowRightLeft,
  Clock,
} from "lucide-react";

const TEMPLATES = [
  {
    id: "executive",
    title: "Executive Summary",
    description: "High-level project overview for senior leadership and sponsors",
    icon: FileText,
  },
  {
    id: "weekly",
    title: "Weekly Status",
    description: "Regular progress update with RAG status and key metrics",
    icon: BarChart3,
  },
  {
    id: "risk",
    title: "Risk Report",
    description: "Detailed risk analysis with mitigation strategies and trends",
    icon: AlertTriangle,
  },
  {
    id: "financial",
    title: "Financial Report",
    description: "Budget tracking, cost variance analysis, and forecast",
    icon: DollarSign,
  },
  {
    id: "stakeholder",
    title: "Stakeholder Update",
    description: "Tailored communication for external stakeholders and clients",
    icon: Users,
  },
];

const SECTIONS = [
  { id: "exec-summary", label: "Executive Summary", description: "High-level project health and key messages", default: true },
  { id: "schedule", label: "Schedule Status", description: "Timeline progress, milestones achieved, and upcoming dates", default: true },
  { id: "cost", label: "Cost Status", description: "Budget utilisation, variance analysis, and EAC", default: true },
  { id: "risk-overview", label: "Risk Overview", description: "Top risks, probability/impact matrix summary", default: true },
  { id: "issues", label: "Issues & Actions", description: "Open issues, action items, and resolution progress", default: true },
  { id: "stakeholder", label: "Stakeholder Update", description: "Engagement activities and communication log", default: false },
  { id: "milestones", label: "Upcoming Milestones", description: "Next 30/60/90 day milestone forecast", default: true },
  { id: "change-requests", label: "Change Requests", description: "Pending and recently approved change requests", default: false },
];

export default function ReportComposerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [enabledSections, setEnabledSections] = useState<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map((s) => [s.id, s.default]))
  );
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const toggleSection = (id: string) => {
    setEnabledSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 2000);
  };

  const enabledCount = Object.values(enabledSections).filter(Boolean).length;

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Report Composer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build and generate project reports with AI assistance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <CalendarClock className="w-4 h-4 mr-1" /> Schedule Report
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={generating || !selectedTemplate}>
            <Bot className="w-4 h-4 mr-1" /> {generating ? "Generating..." : "Generate Report"}
          </Button>
        </div>
      </div>

      {/* Template Selector */}
      <div>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
          Report Template
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            const isSelected = selectedTemplate === t.id;
            return (
              <Card
                key={t.id}
                className={`cursor-pointer transition-all hover:border-primary/50 ${
                  isSelected ? "border-primary ring-2 ring-primary/20" : ""
                }`}
                onClick={() => setSelectedTemplate(t.id)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    {isSelected && <Badge variant="default">Selected</Badge>}
                  </div>
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>
                  <Button
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    className="w-full mt-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTemplate(t.id);
                    }}
                  >
                    {isSelected ? "Selected" : "Use Template"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Report Sections */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Report Sections
          </h2>
          <span className="text-xs text-muted-foreground">
            {enabledCount} of {SECTIONS.length} sections enabled
          </span>
        </div>
        <Card>
          <CardContent className="p-0 divide-y">
            {SECTIONS.map((section) => {
              const isEnabled = enabledSections[section.id];
              return (
                <label
                  key={section.id}
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => toggleSection(section.id)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50 accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${!isEnabled ? "text-muted-foreground" : ""}`}>
                      {section.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  </div>
                  {isEnabled && (
                    <Badge variant="secondary" className="text-[10px]">
                      Included
                    </Badge>
                  )}
                </label>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Report Preview */}
      <div>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
          Report Preview
        </h2>
        <Card>
          <CardContent className="p-8">
            {generating ? (
              <div className="space-y-4">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-32 w-full rounded-lg" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : generated ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">
                    {TEMPLATES.find((t) => t.id === selectedTemplate)?.title || "Report"}
                  </h3>
                  <Badge variant="secondary">Draft</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Generated on {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} for Project {projectId}
                </p>
                <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
                  <p className="text-sm font-semibold">Executive Summary</p>
                  <p className="text-sm text-muted-foreground">
                    The project is currently on track with an overall GREEN status. Schedule performance index (SPI) stands at 1.02
                    and cost performance index (CPI) at 0.98, indicating minor budget pressure. Three of five key milestones have been
                    achieved on or ahead of schedule. Two medium-rated risks require continued monitoring.
                  </p>
                  <p className="text-sm font-semibold mt-4">Schedule Status</p>
                  <p className="text-sm text-muted-foreground">
                    Phase 2 deliverables are 87% complete. The critical path has 3 days of float remaining. UAT is scheduled to
                    commence on 14 April 2026.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground italic">
                  Generated by AI Agent. Review and edit before distribution.
                </p>
              </div>
            ) : (
              <div className="text-center py-12">
                <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">
                  Report preview will appear here after generation
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Select a template and click &quot;Generate Report&quot; to begin
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
