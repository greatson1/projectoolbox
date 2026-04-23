// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Brain, TrendingUp, RefreshCw, Users, AlertTriangle, FileCheck, GitBranch } from "lucide-react";
import { toast } from "sonner";

interface ApprovalLikelihoodInsight {
  type: string;
  probability: number;
  confidence: number;
  sampleSize: number;
  reasoning: string[];
}

export default function MLInsightsPage() {
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);
  const [approvalLikelihoods, setApprovalLikelihoods] = useState<ApprovalLikelihoodInsight[]>([]);
  const [storyPoint, setStoryPoint] = useState<any>(null);
  const [impactCal, setImpactCal] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    const types = ["PHASE_GATE", "CHANGE_REQUEST", "BUDGET", "RISK_RESPONSE", "SCOPE_CHANGE", "RESOURCE", "COMMUNICATION"];
    const results = await Promise.all(types.map(async (type) => {
      const res = await fetch(`/api/ml/predictions?kind=approval_likelihood&type=${type}`);
      const json = await res.json();
      return { type, ...json.data };
    }));
    setApprovalLikelihoods(results.filter(r => r && typeof r.probability === "number"));

    const [sp, ic] = await Promise.all([
      fetch("/api/ml/predictions?kind=story_point_calibration").then(r => r.json()),
      fetch("/api/ml/predictions?kind=impact_calibration&type=CHANGE_REQUEST").then(r => r.json()),
    ]);
    setStoryPoint(sp?.data);
    setImpactCal(ic?.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const retrain = async () => {
    setRetraining(true);
    try {
      const res = await fetch("/api/cron/ml-train", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        const r = json.data?.reports?.[0];
        toast.success(`Retrained: ${r?.approvalBaselines || 0} approval models, ${r?.riskPredictions || 0} risk predictions, ${r?.embeddingsRefreshed || 0} embeddings`);
        load();
      } else {
        toast.error(json.error || "Retrain failed");
      }
    } catch (e: any) {
      toast.error(e.message);
    }
    setRetraining(false);
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            ML Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Learned predictions from your org's approval history, task velocity, risk outcomes, and project similarity
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={retrain} disabled={retraining}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${retraining ? "animate-spin" : ""}`} />
          {retraining ? "Retraining..." : "Retrain Models"}
        </Button>
      </div>

      {/* Approval Likelihood Models */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileCheck className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold">Approval Likelihood by Action Type</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Predicts how likely each type of approval request is to be accepted, based on your org's historical decisions. Used to prioritise and flag approvals.
          </p>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : approvalLikelihoods.length === 0 ? (
            <p className="text-xs text-muted-foreground">No predictions yet — will populate as approvals accumulate.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {approvalLikelihoods.map((a) => (
                <div key={a.type} className="p-3 rounded-lg border border-border/60 bg-muted/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">{a.type.replace(/_/g, " ")}</span>
                    <span className="text-[9px] text-muted-foreground">n={a.sampleSize}</span>
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className={`text-xl font-bold ${a.probability >= 0.7 ? "text-emerald-500" : a.probability >= 0.4 ? "text-amber-500" : "text-red-500"}`}>
                      {Math.round(a.probability * 100)}%
                    </span>
                    <span className="text-[10px] text-muted-foreground">approval rate</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.round(a.probability * 100)}%` }} />
                  </div>
                  <div className="mt-2 text-[9px] text-muted-foreground">
                    Confidence: {Math.round(a.confidence * 100)}% · {a.reasoning?.[0]?.slice(0, 80) || "No detail"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Story Point Calibration */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold">Story Point Calibration</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Learns your team's estimate accuracy from completed tasks. New estimates get auto-adjusted.
            </p>
            {loading ? <Skeleton className="h-32" /> : !storyPoint || storyPoint.sampleSize === 0 ? (
              <p className="text-xs text-muted-foreground">No completed tasks with both estimates and actuals yet.</p>
            ) : (
              <div>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-2xl font-bold font-mono">{storyPoint.multiplier?.toFixed(2)}×</span>
                  <span className="text-[11px] text-muted-foreground">
                    {storyPoint.multiplier > 1.1 ? "Team under-estimates (scale up)" : storyPoint.multiplier < 0.9 ? "Team over-estimates (scale down)" : "Well calibrated"}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mb-3">
                  Based on {storyPoint.sampleSize} completed tasks · Confidence {Math.round(storyPoint.confidence * 100)}%
                </div>
                {storyPoint.byAssignee && Object.keys(storyPoint.byAssignee).length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Per assignee</p>
                    <div className="space-y-1">
                      {Object.entries(storyPoint.byAssignee).slice(0, 5).map(([name, info]: any) => (
                        <div key={name} className="flex justify-between text-[11px] py-1 px-2 rounded bg-muted/20">
                          <span className="truncate flex-1">{name}</span>
                          <span className="font-mono ml-2">{info.multiplier?.toFixed(2)}× <span className="opacity-50">({info.samples})</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Impact Calibration */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold">Impact Score Calibration</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Learns how you adjust agent-proposed impact scores (schedule/cost/scope/stakeholder).
            </p>
            {loading ? <Skeleton className="h-32" /> : !impactCal || impactCal.sampleSize === 0 ? (
              <p className="text-xs text-muted-foreground">No score edits yet — adjust impact scores on Change Request approvals to train this model.</p>
            ) : (
              <div className="space-y-2">
                {(["schedule", "cost", "scope", "stakeholder"] as const).map(d => (
                  <div key={d} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-muted/20">
                    <span className="capitalize">{d}</span>
                    <span className={`font-mono ${impactCal.deltas?.[d] > 0 ? "text-amber-500" : impactCal.deltas?.[d] < 0 ? "text-emerald-500" : ""}`}>
                      {impactCal.deltas?.[d] > 0 ? "+" : ""}{impactCal.deltas?.[d]?.toFixed(1) || "0.0"}
                    </span>
                  </div>
                ))}
                <p className="text-[9px] text-muted-foreground pt-2 border-t border-border/30 mt-2">
                  Based on {impactCal.sampleSize} score edits. Positive = you typically raise the proposed score.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Info card about what's available */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold">What's being learned</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10">
              <p className="font-semibold mb-1">Approval Likelihood</p>
              <p className="text-muted-foreground">Shown on approval cards — "73% likely to approve based on 24 similar decisions."</p>
            </div>
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10">
              <p className="font-semibold mb-1">Risk Materialisation</p>
              <p className="text-muted-foreground">Shown on risk register — probability each open risk becomes an issue, based on past risk outcomes.</p>
            </div>
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10">
              <p className="font-semibold mb-1">Story Point Calibration</p>
              <p className="text-muted-foreground">Sprint planner adjusts raw estimates by your team's historical accuracy multiplier.</p>
            </div>
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10">
              <p className="font-semibold mb-1">Impact Calibration</p>
              <p className="text-muted-foreground">Agent's proposed impact scores pre-adjusted by how you've edited them in the past.</p>
            </div>
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10 md:col-span-2">
              <p className="font-semibold mb-1">Similar Projects</p>
              <p className="text-muted-foreground">Embedding-based similarity search — "This project is 89% similar to 3 past projects. Here's how they went."</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
