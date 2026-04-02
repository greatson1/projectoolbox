"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreditUsage } from "@/hooks/use-api";
import { Zap, TrendingDown, ArrowRight } from "lucide-react";
import { PLAN_LIMITS } from "@/lib/utils";

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function CreditCentrePage() {
  const { data, isLoading } = useCreditUsage();
  const [autoTopup, setAutoTopup] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-32 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      </div>
    );
  }

  const balance = data?.balance || 0;
  const plan = data?.plan || "FREE";
  const totalAllowed = PLAN_LIMITS[plan]?.credits || 50;
  const totalUsed = data?.totalUsed || 0;
  const usedPct = totalAllowed > 0 ? Math.round((totalUsed / totalAllowed) * 100) : 0;
  const remainPct = Math.max(0, Math.round((balance / totalAllowed) * 100));
  const agentBreakdown = data?.agentBreakdown || [];
  const recentTxns = data?.recentTransactions || [];

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Balance Hero */}
      <div className="rounded-2xl p-6 border border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-transparent">
        <div className="flex items-center gap-8 flex-wrap">
          {/* Circular gauge */}
          <div className="relative w-[120px] h-[120px] flex-shrink-0">
            <svg width={120} height={120} className="-rotate-90">
              <circle cx={60} cy={60} r={52} fill="none" stroke="var(--border)" strokeWidth={10} opacity={0.3} />
              <circle cx={60} cy={60} r={52} fill="none"
                stroke={remainPct > 50 ? "var(--primary)" : remainPct > 25 ? "#F59E0B" : "#EF4444"}
                strokeWidth={10} strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 * (1 - remainPct / 100)} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold">{balance.toLocaleString()}</span>
              <span className="text-[10px] text-muted-foreground">credits left</span>
            </div>
          </div>

          <div className="flex-1 min-w-[300px]">
            <h2 className="text-xl font-bold mb-1">{balance.toLocaleString()} credits remaining</h2>
            <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground mb-3">
              <span>Plan: <strong className="text-foreground">{plan}</strong></span>
              <span>Used this cycle: <strong className="text-foreground">{totalUsed.toLocaleString()}</strong></span>
              <span>Allowance: <strong className="text-primary">{totalAllowed.toLocaleString()}/month</strong></span>
            </div>
            <Progress value={usedPct} className="h-2.5" />
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>{usedPct}% used</span>
              <span>{balance.toLocaleString()} remaining</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Link href="/billing"><Button size="sm">Buy More Credits</Button></Link>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Auto top-up</span>
              <button className={`w-9 h-5 rounded-full relative transition-all ${autoTopup ? "bg-primary" : "bg-border"}`}
                onClick={() => setAutoTopup(!autoTopup)}>
                <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: autoTopup ? 18 : 2 }} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Breakdown + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Agent breakdown */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Usage by Agent</CardTitle></CardHeader>
          <CardContent>
            {agentBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No usage recorded yet. Deploy an agent to start using credits.</p>
            ) : (
              <div className="space-y-3">
                {agentBreakdown.map((a: any) => {
                  const pct = totalUsed > 0 ? Math.round((a.creditsUsed / totalUsed) * 100) : 0;
                  return (
                    <div key={a.agentId || "system"} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                        style={{ background: a.agentGradient || "#6366F1" }}>
                        {a.agentName[0]}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-medium">{a.agentName}</span>
                          <span className="text-xs font-bold">{a.creditsUsed} credits</span>
                        </div>
                        <Progress value={pct} className="h-1.5" />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent transactions */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Transactions</CardTitle></CardHeader>
          <CardContent>
            {recentTxns.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No transactions yet.</p>
            ) : (
              <div className="space-y-0 max-h-[300px] overflow-y-auto">
                {recentTxns.map((txn: any) => (
                  <div key={txn.id} className="flex items-center gap-3 py-2 border-b border-border/10 last:border-0">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${txn.amount > 0 ? "bg-green-500/10 text-green-500" : "bg-destructive/10 text-destructive"}`}>
                      {txn.amount > 0 ? "+" : "−"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate">{txn.description}</p>
                      <p className="text-[10px] text-muted-foreground">{timeAgo(txn.createdAt)}</p>
                    </div>
                    <span className={`text-xs font-bold ${txn.amount > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                      {txn.amount > 0 ? "+" : ""}{txn.amount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Credit costs reference */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Credit Costs</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { action: "Chat query", cost: 1 },
              { action: "Complex analysis", cost: 5 },
              { action: "Report generation", cost: 10 },
              { action: "Document generation", cost: 8 },
              { action: "Autonomous decision", cost: 3 },
              { action: "Monte Carlo sim", cost: 15 },
              { action: "Agent deployment", cost: 10 },
            ].map(c => (
              <div key={c.action} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <span className="text-xs text-muted-foreground">{c.action}</span>
                <span className="text-xs font-bold text-primary">{c.cost}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
