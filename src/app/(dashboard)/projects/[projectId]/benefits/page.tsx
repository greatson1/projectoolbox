"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, TrendingUp, Target, AlertTriangle, CheckCircle2, PoundSterling } from "lucide-react";

type BenefitStatus = "ON_TRACK" | "AT_RISK" | "REALISED" | "NOT_STARTED";
type BenefitCategory = "Strategic" | "Financial" | "Operational";

interface Benefit {
  id: string;
  name: string;
  category: BenefitCategory;
  targetValue: number;
  realisedValue: number;
  status: BenefitStatus;
  owner: string;
  targetDate: string;
  description: string;
}

const DEMO_BENEFITS: Benefit[] = [
  {
    id: "ben-001",
    name: "Reduced Operational Costs",
    category: "Financial",
    targetValue: 350000,
    realisedValue: 210000,
    status: "ON_TRACK",
    owner: "David Chen",
    targetDate: "2026-12-31",
    description: "Annual cost savings from process automation and headcount optimisation.",
  },
  {
    id: "ben-002",
    name: "Improved Customer Satisfaction",
    category: "Strategic",
    targetValue: 500000,
    realisedValue: 125000,
    status: "AT_RISK",
    owner: "Priya Sharma",
    targetDate: "2027-03-31",
    description: "Revenue uplift from NPS improvement and reduced churn rate across key accounts.",
  },
  {
    id: "ben-003",
    name: "Faster Time-to-Market",
    category: "Operational",
    targetValue: 200000,
    realisedValue: 200000,
    status: "REALISED",
    owner: "Tom Gallagher",
    targetDate: "2026-06-30",
    description: "Value of accelerated delivery cycles through CI/CD pipeline and agile adoption.",
  },
  {
    id: "ben-004",
    name: "Regulatory Compliance",
    category: "Strategic",
    targetValue: 150000,
    realisedValue: 0,
    status: "NOT_STARTED",
    owner: "Claire Dubois",
    targetDate: "2027-06-30",
    description: "Risk avoidance value from meeting updated data protection and audit requirements.",
  },
  {
    id: "ben-005",
    name: "Staff Productivity Gains",
    category: "Operational",
    targetValue: 275000,
    realisedValue: 165000,
    status: "ON_TRACK",
    owner: "Kwame Mensah",
    targetDate: "2026-09-30",
    description: "Productivity improvement from new tooling, training programme, and workflow redesign.",
  },
];

const STATUS_VARIANT: Record<BenefitStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ON_TRACK: "default",
  AT_RISK: "destructive",
  REALISED: "secondary",
  NOT_STARTED: "outline",
};

const STATUS_LABEL: Record<BenefitStatus, string> = {
  ON_TRACK: "On Track",
  AT_RISK: "At Risk",
  REALISED: "Realised",
  NOT_STARTED: "Not Started",
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);
}

export default function BenefitsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [benefits] = useState<Benefit[]>(DEMO_BENEFITS);
  const [isLoading] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const totalBenefits = benefits.length;
  const onTrack = benefits.filter(b => b.status === "ON_TRACK").length;
  const atRisk = benefits.filter(b => b.status === "AT_RISK").length;
  const totalRealised = benefits.reduce((s, b) => s + b.realisedValue, 0);

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Benefits Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">{totalBenefits} benefits &middot; {formatCurrency(totalRealised)} realised to date</p>
        </div>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Benefit</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Benefits</p>
              <p className="text-2xl font-bold">{totalBenefits}</p>
            </div>
            <Target className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">On Track</p>
              <p className="text-2xl font-bold text-green-500">{onTrack}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">At Risk</p>
              <p className="text-2xl font-bold text-destructive">{atRisk}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Realised Value</p>
              <p className="text-2xl font-bold">{formatCurrency(totalRealised)}</p>
            </div>
            <PoundSterling className="w-5 h-5 text-primary" />
          </div>
        </Card>
      </div>

      {/* Benefits list */}
      {benefits.length === 0 ? (
        <div className="text-center py-20">
          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No benefits registered</h2>
          <p className="text-sm text-muted-foreground mb-4">Track expected benefits and measure realisation against targets.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add First Benefit</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {benefits.map(b => {
            const pct = b.targetValue > 0 ? Math.round((b.realisedValue / b.targetValue) * 100) : 0;
            return (
              <Card key={b.id} className="hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold truncate">{b.name}</h3>
                        <Badge variant="outline" className="text-[10px]">{b.category}</Badge>
                        <Badge variant={STATUS_VARIANT[b.status]} className="text-[10px]">{STATUS_LABEL[b.status]}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{b.description}</p>
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Target</p>
                      <p className="text-sm font-bold">{formatCurrency(b.targetValue)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 mt-3">
                    <div className="text-xs text-muted-foreground">Owner: <span className="font-medium text-foreground">{b.owner}</span></div>
                    <div className="text-xs text-muted-foreground">Target date: <span className="font-medium text-foreground">{b.targetDate}</span></div>
                    <div className="text-xs text-muted-foreground">Realised: <span className="font-semibold text-foreground">{formatCurrency(b.realisedValue)}</span></div>
                    <div className="flex-1 flex items-center gap-2 ml-auto">
                      <Progress value={pct} className="h-2 flex-1" />
                      <span className="text-xs font-semibold w-8 text-right">{pct}%</span>
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
}
