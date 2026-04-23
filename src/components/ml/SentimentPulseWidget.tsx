"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, TrendingUp, TrendingDown, Minus, ArrowRight, Smile, Meh, AlertTriangle, Frown } from "lucide-react";

/** Compact sentiment pulse for the Dashboard. */
export function SentimentPulseWidget() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sentiment/pulse")
      .then(r => r.json())
      .then(j => { setData(j?.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton className="h-40 rounded-xl" />;
  const d = data || {};
  const total = d.total || 0;

  if (total === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold">Sentiment Pulse</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            No signals in the past 7 days. Sentiment populates automatically from approvals, chat, and emails.
          </p>
        </CardContent>
      </Card>
    );
  }

  const pct = (n: number) => Math.round((n / total) * 100);
  const trendIcon = d.trend === "improving" ? <TrendingUp className="w-3 h-3 text-emerald-500" />
    : d.trend === "declining" ? <TrendingDown className="w-3 h-3 text-red-500" />
    : <Minus className="w-3 h-3 text-muted-foreground" />;

  return (
    <Link href="/sentiment">
      <Card className="hover:border-primary/30 cursor-pointer transition-all group">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold">Sentiment Pulse</h3>
              <span className="text-[9px] text-muted-foreground">7d</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              {trendIcon}
              <span className="tabular-nums font-mono text-muted-foreground">{d.weeklyChange > 0 ? "+" : ""}{d.weeklyChange?.toFixed(2)}</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 mb-3">
            <div className="text-center p-1.5 rounded border border-emerald-500/30 bg-emerald-500/10">
              <Smile className="w-3.5 h-3.5 text-emerald-500 mx-auto mb-0.5" />
              <p className="text-xs font-bold text-emerald-500">{d.positive || 0}</p>
              <p className="text-[8px] text-emerald-500/80">{pct(d.positive || 0)}%</p>
            </div>
            <div className="text-center p-1.5 rounded border border-border/40 bg-muted/30">
              <Meh className="w-3.5 h-3.5 text-muted-foreground mx-auto mb-0.5" />
              <p className="text-xs font-bold text-muted-foreground">{d.neutral || 0}</p>
              <p className="text-[8px] text-muted-foreground">{pct(d.neutral || 0)}%</p>
            </div>
            <div className="text-center p-1.5 rounded border border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mx-auto mb-0.5" />
              <p className="text-xs font-bold text-amber-500">{d.concerned || 0}</p>
              <p className="text-[8px] text-amber-500/80">{pct(d.concerned || 0)}%</p>
            </div>
            <div className="text-center p-1.5 rounded border border-red-500/30 bg-red-500/10">
              <Frown className="w-3.5 h-3.5 text-red-500 mx-auto mb-0.5" />
              <p className="text-xs font-bold text-red-500">{d.negative || 0}</p>
              <p className="text-[8px] text-red-500/80">{pct(d.negative || 0)}%</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Avg score: <strong className={d.averageScore > 0.2 ? "text-emerald-500" : d.averageScore < -0.2 ? "text-red-500" : "text-foreground"}>{d.averageScore?.toFixed(2)}</strong></span>
            <span className="flex items-center gap-0.5 text-primary group-hover:translate-x-0.5 transition-transform">
              View heatmap <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
