// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Heart, TrendingUp, TrendingDown, Minus, Users, Filter,
  Smile, Meh, Frown, AlertTriangle, Building2, BarChart3,
} from "lucide-react";

const SENTIMENT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: any }> = {
  positive:  { label: "Positive",  color: "text-emerald-500",  bg: "bg-emerald-500/10",  border: "border-emerald-500/30",  icon: Smile },
  neutral:   { label: "Neutral",   color: "text-muted-foreground", bg: "bg-muted/30",     border: "border-border",         icon: Meh },
  concerned: { label: "Concerned", color: "text-amber-500",    bg: "bg-amber-500/10",    border: "border-amber-500/30",    icon: AlertTriangle },
  negative:  { label: "Negative",  color: "text-red-500",      bg: "bg-red-500/10",      border: "border-red-500/30",      icon: Frown },
};

export default function SentimentPage() {
  const [pulse, setPulse] = useState<any>(null);
  const [heatmap, setHeatmap] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/sentiment/pulse").then(r => r.json()),
      fetch("/api/sentiment/heatmap").then(r => r.json()),
    ]).then(([p, h]) => {
      setPulse(p?.data || null);
      setHeatmap(h?.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = filter ? heatmap.filter((s: any) => s.sentiment === filter) : heatmap;

  if (loading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const p = pulse || { total: 0, positive: 0, neutral: 0, concerned: 0, negative: 0, averageScore: 0, trend: "stable", weeklyChange: 0 };
  const pct = (n: number) => p.total > 0 ? Math.round((n / p.total) * 100) : 0;

  // Aggregate heatmap by project
  const byProject = heatmap.reduce((acc: Record<string, any[]>, s: any) => {
    if (!acc[s.projectName]) acc[s.projectName] = [];
    acc[s.projectName].push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Heart className="w-6 h-6 text-primary" />
          Sentiment Intelligence
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live sentiment pulse from approvals, emails, chat, and meetings across your organisation
        </p>
      </div>

      {/* ── Org pulse ── */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Past 7 days</p>
              <h2 className="text-sm font-bold mt-0.5">Organisation Sentiment Pulse</h2>
            </div>
            <div className="flex items-center gap-2">
              {p.trend === "improving" ? (
                <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30"><TrendingUp className="w-3 h-3 mr-1" />Improving</Badge>
              ) : p.trend === "declining" ? (
                <Badge className="bg-red-500/10 text-red-500 border-red-500/30"><TrendingDown className="w-3 h-3 mr-1" />Declining</Badge>
              ) : (
                <Badge variant="outline"><Minus className="w-3 h-3 mr-1" />Stable</Badge>
              )}
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {p.weeklyChange > 0 ? "+" : ""}{p.weeklyChange.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="p-4 rounded-xl border border-border/60 bg-muted/10">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Avg Score</p>
              <p className={`text-2xl font-bold ${p.averageScore > 0.2 ? "text-emerald-500" : p.averageScore < -0.2 ? "text-red-500" : "text-amber-500"}`}>
                {p.averageScore.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">of -1 to +1</p>
            </div>
            {(["positive", "neutral", "concerned", "negative"] as const).map(k => {
              const cfg = SENTIMENT_CONFIG[k];
              const Icon = cfg.icon;
              return (
                <div key={k} className={`p-4 rounded-xl border ${cfg.border} ${cfg.bg}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                    <p className={`text-[9px] font-bold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</p>
                  </div>
                  <p className={`text-2xl font-bold ${cfg.color}`}>{p[k]}</p>
                  <div className="mt-1.5 w-full h-1 rounded-full bg-background overflow-hidden">
                    <div className={`h-full rounded-full ${cfg.color.replace("text-", "bg-")}`} style={{ width: `${pct(p[k])}%` }} />
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1">{pct(p[k])}% of {p.total}</p>
                </div>
              );
            })}
          </div>

          {p.total === 0 && (
            <div className="mt-4 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground text-center">
              No signals yet — sentiment will populate automatically as approvals, emails, and chat accumulate.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Stakeholder heatmap ── */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold flex items-center gap-1.5">
                <Users className="w-4 h-4 text-primary" />
                Stakeholder Sentiment Heatmap
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {heatmap.length} stakeholders · Click a card to open their project
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Filter className="w-3 h-3 text-muted-foreground" />
              {["positive", "neutral", "concerned", "negative"].map(s => (
                <button key={s} onClick={() => setFilter(filter === s ? null : s)}
                  className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${
                    filter === s ? SENTIMENT_CONFIG[s].bg + " " + SENTIMENT_CONFIG[s].border + " " + SENTIMENT_CONFIG[s].color :
                    "border-border/40 text-muted-foreground hover:text-foreground"
                  }`}>
                  {SENTIMENT_CONFIG[s].label}
                </button>
              ))}
              {filter && <button onClick={() => setFilter(null)} className="text-[10px] text-primary">Clear</button>}
            </div>
          </div>

          {heatmap.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No stakeholders yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Add stakeholders to any project to see their sentiment here.</p>
            </div>
          ) : Object.keys(byProject).length === 0 ? (
            <p className="text-xs text-muted-foreground">No matches for filter.</p>
          ) : (
            <div className="space-y-5">
              {Object.entries(byProject).map(([projectName, sts]: any) => {
                const visible = filter ? sts.filter((s: any) => s.sentiment === filter) : sts;
                if (visible.length === 0) return null;
                return (
                  <div key={projectName}>
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-xs font-bold text-foreground">{projectName}</p>
                      <span className="text-[10px] text-muted-foreground">· {visible.length}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {visible.map((s: any) => {
                        const cfg = s.sentiment ? SENTIMENT_CONFIG[s.sentiment] : SENTIMENT_CONFIG.neutral;
                        const Icon = cfg.icon;
                        const importance = (s.power + s.interest) / 2; // 0-100
                        const scale = 0.9 + (importance / 100) * 0.3; // 0.9x → 1.2x
                        return (
                          <Link key={s.stakeholderId} href={`/projects/${s.projectId}/stakeholders`}
                            className={`block p-3 rounded-xl border ${cfg.border} ${cfg.bg} hover:opacity-90 transition-all cursor-pointer`}
                            style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.color}`} />
                              <p className="text-xs font-semibold truncate flex-1">{s.name}</p>
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">{s.role || "—"}{s.organisation ? ` · ${s.organisation}` : ""}</p>
                            <div className="flex items-center gap-2 mt-1.5 text-[9px]">
                              <span className={cfg.color}>{cfg.label}</span>
                              {typeof s.sentimentScore === "number" && (
                                <span className="text-muted-foreground font-mono">
                                  {s.sentimentScore > 0 ? "+" : ""}{s.sentimentScore.toFixed(2)}
                                </span>
                              )}
                              {s.recentSignals > 0 && (
                                <span className="text-muted-foreground">· {s.recentSignals} signals</span>
                              )}
                            </div>
                            <div className="mt-1.5 flex gap-1 text-[8px]">
                              <span className="px-1 py-0.5 rounded bg-muted text-muted-foreground">P{s.power}</span>
                              <span className="px-1 py-0.5 rounded bg-muted text-muted-foreground">I{s.interest}</span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Info card ── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold">How sentiment is captured</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10">
              <p className="font-semibold mb-1">Approvals</p>
              <p className="text-muted-foreground">Sentiment is auto-extracted from each approval comment when you approve, reject, or request changes.</p>
            </div>
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10">
              <p className="font-semibold mb-1">Chat Messages</p>
              <p className="text-muted-foreground">Every message you send to an agent is classified for tone (Haiku model, under 1 second).</p>
            </div>
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10">
              <p className="font-semibold mb-1">Inbound Emails</p>
              <p className="text-muted-foreground">Replies from stakeholders arriving in the agent inbox are analysed on arrival.</p>
            </div>
            <div className="p-3 rounded-lg border border-border/40 bg-muted/10">
              <p className="font-semibold mb-1">Meetings</p>
              <p className="text-muted-foreground">Meeting transcripts are scored and the dominant sentiment is stored on the meeting record.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
