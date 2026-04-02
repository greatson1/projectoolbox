"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectStakeholders } from "@/hooks/use-api";
import { PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Plus, Users, Search, MessageSquare, History } from "lucide-react";

const SENTIMENT_COLORS: Record<string, string> = { champion: "#10B981", supportive: "#22D3EE", engaged: "#6366F1", neutral: "#64748B", cautious: "#F59E0B", resistant: "#EF4444" };

export default function StakeholdersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: stakeholders, isLoading } = useProjectStakeholders(projectId);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<any>(null);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-96 rounded-xl" /></div>;

  const items = stakeholders || [];

  // Sentiment distribution for pie chart
  const sentimentData = Object.entries(
    items.reduce<Record<string, number>>((acc, s: any) => { acc[s.sentiment || "neutral"] = (acc[s.sentiment || "neutral"] || 0) + 1; return acc; }, {})
  ).map(([name, value]) => ({ name, value, fill: SENTIMENT_COLORS[name] || "#64748B" }));

  // Engagement radar
  const engagementData = [
    { axis: "Awareness", value: items.length > 0 ? 85 : 0 },
    { axis: "Understanding", value: items.length > 0 ? 72 : 0 },
    { axis: "Buy-in", value: items.length > 0 ? 68 : 0 },
    { axis: "Commitment", value: items.length > 0 ? 78 : 0 },
    { axis: "Advocacy", value: items.length > 0 ? 55 : 0 },
  ];

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stakeholders</h1>
          <p className="text-sm text-muted-foreground mt-1">{items.length} stakeholders registered</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["grid", "list"] as const).map(v => (
              <button key={v} className={`px-3 py-1.5 text-xs font-semibold capitalize ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => setView(v)}>{v === "grid" ? "Power/Interest Grid" : "List"}</button>
            ))}
          </div>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Stakeholder</Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <Users className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No stakeholders registered</h2>
          <p className="text-sm text-muted-foreground mb-4">Add stakeholders to map their power, interest, and engagement levels.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add First Stakeholder</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-4">
            {/* Power/Interest Grid */}
            {view === "grid" && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Power / Interest Grid</CardTitle></CardHeader>
                <CardContent>
                  <div className="relative w-full aspect-square max-w-[500px] mx-auto rounded-xl border border-border bg-muted/10">
                    {/* Quadrant labels */}
                    <span className="absolute top-2 left-2 text-[10px] font-semibold text-muted-foreground">Monitor</span>
                    <span className="absolute top-2 right-2 text-[10px] font-semibold text-muted-foreground">Manage Closely</span>
                    <span className="absolute bottom-2 left-2 text-[10px] font-semibold text-muted-foreground">Keep Informed</span>
                    <span className="absolute bottom-2 right-2 text-[10px] font-semibold text-muted-foreground">Keep Satisfied</span>
                    {/* Grid lines */}
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-border" />
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                    {/* Axis labels */}
                    <span className="absolute -left-0 top-1/2 -translate-y-1/2 -rotate-90 text-[9px] text-muted-foreground font-semibold">← Power →</span>
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground font-semibold">← Interest →</span>
                    {/* Stakeholder dots */}
                    {items.map((s: any) => (
                      <button key={s.id} className="absolute w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white cursor-pointer hover:scale-125 hover:z-10 transition-all"
                        style={{
                          left: `${s.interest || 50}%`, bottom: `${s.power || 50}%`,
                          transform: "translate(-50%, 50%)",
                          background: SENTIMENT_COLORS[s.sentiment || "neutral"] || "#64748B",
                          boxShadow: selected?.id === s.id ? "0 0 12px rgba(99,102,241,0.5)" : "none",
                          border: selected?.id === s.id ? "2px solid white" : "2px solid transparent",
                        }}
                        onClick={() => setSelected(s)}>
                        {(s.name || "?")[0]}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* List view */}
            {view === "list" && (
              <Card className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border">
                    {["Name", "Role", "Organisation", "Power", "Interest", "Sentiment"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {items.map((s: any) => (
                      <tr key={s.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setSelected(s)}>
                        <td className="py-2.5 px-4 font-medium">{s.name}</td>
                        <td className="py-2.5 px-4 text-muted-foreground">{s.role || "—"}</td>
                        <td className="py-2.5 px-4 text-muted-foreground">{s.organisation || "—"}</td>
                        <td className="py-2.5 px-4"><div className="flex items-center gap-2"><div className="w-12 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${s.power}%` }} /></div><span>{s.power}%</span></div></td>
                        <td className="py-2.5 px-4"><div className="flex items-center gap-2"><div className="w-12 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${s.interest}%` }} /></div><span>{s.interest}%</span></div></td>
                        <td className="py-2.5 px-4"><Badge variant="outline" style={{ color: SENTIMENT_COLORS[s.sentiment] }}>{s.sentiment || "neutral"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {/* Selected stakeholder detail */}
            {selected && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{selected.name}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Role:</span> <strong>{selected.role || "—"}</strong></div>
                    <div><span className="text-muted-foreground">Org:</span> <strong>{selected.organisation || "—"}</strong></div>
                    <div><span className="text-muted-foreground">Power:</span> <strong>{selected.power}%</strong></div>
                    <div><span className="text-muted-foreground">Interest:</span> <strong>{selected.interest}%</strong></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Sentiment:</span>
                    <Badge variant="outline" style={{ color: SENTIMENT_COLORS[selected.sentiment] }}>{selected.sentiment || "neutral"}</Badge>
                  </div>
                  {selected.email && <p className="text-xs text-muted-foreground">{selected.email}</p>}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1"><MessageSquare className="w-3.5 h-3.5 mr-1" /> Message</Button>
                    <Button variant="outline" size="sm" className="flex-1"><History className="w-3.5 h-3.5 mr-1" /> History</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Sentiment distribution */}
            {sentimentData.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Sentiment Distribution</CardTitle></CardHeader>
                <CardContent>
                  <div style={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={sentimentData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3}>
                        {sentimentData.map(s => <Cell key={s.name} fill={s.fill} />)}
                      </Pie><Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} /></PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center mt-1">
                    {sentimentData.map(s => (
                      <span key={s.name} className="flex items-center gap-1 text-[10px] text-muted-foreground capitalize"><span className="w-2 h-2 rounded-sm" style={{ background: s.fill }} />{s.name} ({s.value})</span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Engagement radar */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Engagement Radar</CardTitle></CardHeader>
              <CardContent>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={engagementData} cx="50%" cy="50%" outerRadius="70%">
                      <PolarGrid stroke="var(--border)" opacity={0.4} />
                      <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--muted-foreground)", fontSize: 9 }} />
                      <PolarRadiusAxis tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} domain={[0, 100]} />
                      <Radar dataKey="value" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.2} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
