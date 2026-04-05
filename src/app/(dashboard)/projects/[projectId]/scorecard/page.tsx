// @ts-nocheck
"use client";

import { useState, useEffect, use } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Target, Shield, Users, Bug, Zap, CheckCircle2, AlertTriangle } from "lucide-react";

const RAG_STYLES = {
  GREEN: { bg: "bg-emerald-500/10", text: "text-emerald-500", ring: "ring-emerald-500/20", label: "On Track" },
  AMBER: { bg: "bg-amber-500/10", text: "text-amber-500", ring: "ring-amber-500/20", label: "At Risk" },
  RED: { bg: "bg-red-500/10", text: "text-red-500", ring: "ring-red-500/20", label: "Critical" },
};

const OBJECTIVE_ICONS = {
  schedule: TrendingUp,
  budget: Target,
  scope: CheckCircle2,
  risk: AlertTriangle,
  stakeholder: Users,
  quality: Bug,
  responsiveness: Zap,
  compliance: Shield,
};

function ScoreGauge({ score, size = 80 }: { score: number; size?: number }) {
  const color = score >= 75 ? "#10B981" : score >= 50 ? "#F59E0B" : "#EF4444";
  const pct = Math.min(100, Math.max(0, score));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="var(--border)" strokeWidth="6" opacity={0.3} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[8px] text-muted-foreground uppercase">/ 100</span>
      </div>
    </div>
  );
}

export default function ScorecardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  usePageTitle("Project Scorecard");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/scorecard`)
      .then(r => r.json())
      .then(d => { setData(d.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  if (loading) return (
    <div className="space-y-6 max-w-[1200px]">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-32 rounded-xl" />
      <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
    </div>
  );

  if (!data) return <p className="text-center py-16 text-muted-foreground">No scorecard data available</p>;

  const { overall, objectives, agentPerformance } = data;
  const overallStyle = RAG_STYLES[overall.rag] || RAG_STYLES.AMBER;

  return (
    <div className="space-y-6 max-w-[1200px] animate-page-enter">
      <div>
        <h1 className="text-2xl font-bold">Project Scorecard</h1>
        <p className="text-sm text-muted-foreground mt-1">Agent performance against project objectives</p>
      </div>

      {/* Overall Score */}
      <Card className={`overflow-hidden ${overallStyle.ring} ring-1`}>
        <div className={`h-1 ${overall.rag === "GREEN" ? "bg-emerald-500" : overall.rag === "AMBER" ? "bg-amber-500" : "bg-red-500"}`} />
        <CardContent className="p-6">
          <div className="flex items-center gap-8">
            <ScoreGauge score={overall.score} size={100} />
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-xl font-bold">Overall Project Health</h2>
                <Badge className={`${overallStyle.bg} ${overallStyle.text} border-0`}>{overallStyle.label}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Composite score across {objectives.length} objectives. {overall.score >= 75 ? "Project is performing well." : overall.score >= 50 ? "Some areas need attention." : "Multiple objectives are at risk."}
              </p>
            </div>
            {/* Agent stats */}
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-2xl font-bold text-primary">{agentPerformance.decisionAccuracy}%</p>
                <p className="text-[10px] text-muted-foreground">Decision Accuracy</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{agentPerformance.totalActivities}</p>
                <p className="text-[10px] text-muted-foreground">Actions Taken</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{agentPerformance.proactiveAlerts}</p>
                <p className="text-[10px] text-muted-foreground">Proactive Alerts</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Objectives Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {objectives.map((obj: any) => {
          const style = RAG_STYLES[obj.rag] || RAG_STYLES.AMBER;
          const Icon = OBJECTIVE_ICONS[obj.id] || Target;

          return (
            <Card key={obj.id} className={`transition-all hover:-translate-y-1 hover:shadow-lg ${style.ring} ring-1`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${style.bg}`}>
                    <Icon className={`w-4 h-4 ${style.text}`} />
                  </div>
                  <ScoreGauge score={obj.score} size={48} />
                </div>
                <h3 className="text-sm font-bold mb-0.5">{obj.label}</h3>
                <p className="text-xs text-muted-foreground mb-2">{obj.metric}</p>
                <div className={`px-2 py-1 rounded-md text-[10px] ${style.bg} ${style.text} font-medium`}>
                  {obj.detail}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Agent Decision Summary */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Agent Decision Log</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-lg font-bold">{agentPerformance.totalDecisions}</p>
              <p className="text-[10px] text-muted-foreground">Total Decisions</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/10">
              <p className="text-lg font-bold text-emerald-500">{agentPerformance.approved}</p>
              <p className="text-[10px] text-muted-foreground">Approved / Auto-Approved</p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/10">
              <p className="text-lg font-bold text-red-500">{agentPerformance.rejected}</p>
              <p className="text-[10px] text-muted-foreground">Rejected</p>
            </div>
            <div className="p-3 rounded-lg bg-primary/10">
              <p className="text-lg font-bold text-primary">{agentPerformance.decisionAccuracy}%</p>
              <p className="text-[10px] text-muted-foreground">Accuracy Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
