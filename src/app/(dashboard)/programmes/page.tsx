"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Layers, FolderKanban, TrendingUp, CheckCircle2 } from "lucide-react";

interface Programme {
  id: string;
  name: string;
  description: string;
  projectCount: number;
  health: "GREEN" | "AMBER" | "RED";
  budget: number;
  spent: number;
  progress: number;
  owner: string;
  startDate: string;
  endDate: string;
}

const DEMO_PROGRAMMES: Programme[] = [
  {
    id: "prg-001",
    name: "Digital Transformation",
    description: "Enterprise-wide digital modernisation covering cloud migration, legacy system retirement, and new digital service delivery channels.",
    projectCount: 8,
    health: "GREEN",
    budget: 2400000,
    spent: 1560000,
    progress: 65,
    owner: "Sarah Mitchell",
    startDate: "2025-03-01",
    endDate: "2027-06-30",
  },
  {
    id: "prg-002",
    name: "Infrastructure Upgrade",
    description: "Data centre consolidation, network refresh, and resilience improvements across all regional offices.",
    projectCount: 5,
    health: "AMBER",
    budget: 1800000,
    spent: 1350000,
    progress: 48,
    owner: "James O'Brien",
    startDate: "2025-09-01",
    endDate: "2027-03-31",
  },
  {
    id: "prg-003",
    name: "Customer Experience Initiative",
    description: "Omni-channel CX redesign including mobile app relaunch, chatbot deployment, and NPS improvement targets.",
    projectCount: 4,
    health: "RED",
    budget: 950000,
    spent: 720000,
    progress: 32,
    owner: "Amina Yusuf",
    startDate: "2026-01-15",
    endDate: "2027-01-15",
  },
];

const HEALTH_DOT: Record<string, string> = {
  GREEN: "bg-green-500",
  AMBER: "bg-amber-500",
  RED: "bg-red-500",
};

const HEALTH_LABEL: Record<string, string> = {
  GREEN: "On Track",
  AMBER: "At Risk",
  RED: "Off Track",
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);
}

export default function ProgrammesPage() {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/programmes")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.data)) setProgrammes(d.data); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const activeProgrammes = programmes.length;
  const totalProjects = programmes.reduce((s, p) => s + p.projectCount, 0);
  const onTrackPct = programmes.length > 0
    ? Math.round((programmes.filter(p => p.health === "GREEN").length / programmes.length) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Programmes</h1>
          <p className="text-sm text-muted-foreground mt-1">Portfolio-level programme groupings and health overview</p>
        </div>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create Programme</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Active Programmes</p>
              <p className="text-2xl font-bold">{activeProgrammes}</p>
            </div>
            <FolderKanban className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Projects</p>
              <p className="text-2xl font-bold">{totalProjects}</p>
            </div>
            <Layers className="w-5 h-5 text-muted-foreground" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">On Track</p>
              <p className="text-2xl font-bold text-green-500">{onTrackPct}%</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>
        </Card>
      </div>

      {/* Programme list */}
      {programmes.length === 0 ? (
        <div className="text-center py-20">
          <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No programmes configured</h2>
          <p className="text-sm text-muted-foreground mb-4">Group related projects into programmes for portfolio-level oversight.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create Programme</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {programmes.map(prg => (
            <Card key={prg.id} className="hover:border-primary/30 transition-colors cursor-pointer">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold truncate">{prg.name}</h3>
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${HEALTH_DOT[prg.health]}`} title={HEALTH_LABEL[prg.health]} />
                      <Badge variant={prg.health === "GREEN" ? "default" : prg.health === "AMBER" ? "secondary" : "destructive"} className="text-[10px]">
                        {HEALTH_LABEL[prg.health]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{prg.description}</p>
                  </div>
                  <div className="text-right ml-4 shrink-0">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Budget</p>
                    <p className="text-sm font-bold">{formatCurrency(prg.budget)}</p>
                    <p className="text-[10px] text-muted-foreground">{formatCurrency(prg.spent)} spent</p>
                  </div>
                </div>

                <div className="flex items-center gap-6 mt-3">
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">{prg.projectCount} projects</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Owner: <span className="font-medium text-foreground">{prg.owner}</span></div>
                  <div className="text-xs text-muted-foreground">{prg.startDate} &rarr; {prg.endDate}</div>
                  <div className="flex-1 flex items-center gap-2 ml-auto">
                    <Progress value={prg.progress} className="h-2 flex-1" />
                    <span className="text-xs font-semibold w-8 text-right">{prg.progress}%</span>
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
