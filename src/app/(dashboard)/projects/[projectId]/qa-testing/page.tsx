"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useProject } from "@/hooks/use-api";
import { BarChart, Bar, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";
import { toast } from "sonner";
import { TestTube2, Bug, CheckCircle2, AlertTriangle, Play, Plus } from "lucide-react";

// Mock QA data — will be populated by agent
const TEST_SUITES = [
  { name: "Unit Tests", total: 245, pass: 228, fail: 12, skip: 5, coverage: 87 },
  { name: "Integration Tests", total: 89, pass: 72, fail: 14, skip: 3, coverage: 76 },
  { name: "E2E Tests", total: 34, pass: 28, fail: 4, skip: 2, coverage: 65 },
  { name: "API Tests", total: 156, pass: 148, fail: 6, skip: 2, coverage: 92 },
];

const DEFECTS = [
  { id: "DEF-001", title: "Login timeout not handled", severity: "critical", status: "Open", component: "Auth", age: "5d" },
  { id: "DEF-002", title: "Chart rendering fails on Safari", severity: "major", status: "In Progress", component: "Dashboard", age: "3d" },
  { id: "DEF-003", title: "CSV export includes deleted records", severity: "major", status: "Fixed", component: "Reports", age: "8d" },
  { id: "DEF-004", title: "Missing RBAC check on admin route", severity: "critical", status: "In Progress", component: "Auth", age: "2d" },
  { id: "DEF-005", title: "Email notification delay >30s", severity: "minor", status: "Open", component: "Notifications", age: "1d" },
  { id: "DEF-006", title: "Risk score rounding error", severity: "minor", status: "Verified", component: "Risk", age: "12d" },
  { id: "DEF-007", title: "API rate limit too aggressive", severity: "major", status: "Fixed", component: "API", age: "7d" },
  { id: "DEF-008", title: "Memory leak in polling", severity: "major", status: "Open", component: "Dashboard", age: "4d" },
];

const TREND_DATA = [
  { week: "W1", discovered: 8, closed: 3 }, { week: "W2", discovered: 12, closed: 7 },
  { week: "W3", discovered: 6, closed: 9 }, { week: "W4", discovered: 10, closed: 8 },
  { week: "W5", discovered: 5, closed: 11 }, { week: "W6", discovered: 7, closed: 6 },
];

const COVERAGE_TREND = [
  { week: "W1", coverage: 62 }, { week: "W2", coverage: 68 }, { week: "W3", coverage: 72 },
  { week: "W4", coverage: 76 }, { week: "W5", coverage: 80 }, { week: "W6", coverage: 82 },
];

const COMPONENT_DATA = [
  { name: "Auth", count: 3, fill: "#EF4444" }, { name: "Dashboard", count: 2, fill: "#6366F1" },
  { name: "Reports", count: 1, fill: "#22D3EE" }, { name: "Notifications", count: 1, fill: "#F59E0B" },
  { name: "Risk", count: 1, fill: "#8B5CF6" }, { name: "API", count: 1, fill: "#10B981" },
];

const QUALITY_RADAR = [
  { axis: "Test Coverage", value: 82 }, { axis: "Defect Density", value: 72 },
  { axis: "Review Throughput", value: 85 }, { axis: "Automation", value: 68 },
  { axis: "Response Time", value: 90 }, { axis: "Regression Rate", value: 78 },
];

const SEVERITY_VARIANT: Record<string, "destructive" | "secondary" | "outline"> = { critical: "destructive", major: "secondary", minor: "outline", trivial: "outline" };
const DEFECT_STATUS = ["New", "Open", "In Progress", "Fixed", "Verified"];

export default function QATestingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const [activeTab, setActiveTab] = useState<"tests" | "defects" | "trends">("tests");

  const totalTests = ([] as any[]).reduce((s, t) => s + t.total, 0);
  const totalPass = ([] as any[]).reduce((s, t) => s + t.pass, 0);
  const totalFail = ([] as any[]).reduce((s, t) => s + t.fail, 0);
  const passRate = Math.round((totalPass / totalTests) * 100);
  const openDefects = DEFECTS.filter(d => d.status === "Open" || d.status === "In Progress").length;
  const criticalDefects = DEFECTS.filter(d => d.severity === "critical").length;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">QA & Testing</h1>
          <p className="text-sm text-muted-foreground mt-1">{project?.name || "Project"} · {totalTests} tests · {passRate}% pass rate</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => toast.info("Coming soon")}><Play className="w-4 h-4 mr-1" /> Run Tests</Button>
          <Button size="sm" onClick={() => toast.info("Coming soon")}><Plus className="w-4 h-4 mr-1" /> Log Defect</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">🧪 Tests</p><p className="text-xl font-bold">{totalTests}</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">✅ Pass Rate</p><p className="text-xl font-bold text-green-500">{passRate}%</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">🐛 Open Defects</p><p className="text-xl font-bold text-amber-500">{openDefects}</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">🔧 Fixed</p><p className="text-xl font-bold text-green-500">{([] as any[]).filter(d => d.status === "Fixed" || d.status === "Verified").length}</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">🔴 Critical</p><p className="text-xl font-bold text-destructive">{criticalDefects}</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">📊 Coverage</p><p className="text-xl font-bold text-primary">82%</p></Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/30">
        {(["tests", "defects", "trends"] as const).map(t => (
          <button key={t} className={`px-4 py-2 text-xs font-semibold capitalize border-b-2 transition-all ${activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setActiveTab(t)}>{t === "tests" ? "Test Suites" : t === "defects" ? "Defects" : "Quality Trends"}</button>
        ))}
      </div>

      {/* Test Suites Tab */}
      {activeTab === "tests" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Test Execution by Suite</CardTitle></CardHeader>
            <CardContent>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={TEST_SUITES} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                    <Bar dataKey="pass" stackId="a" fill="#10B981" name="Pass" />
                    <Bar dataKey="fail" stackId="a" fill="#EF4444" name="Fail" />
                    <Bar dataKey="skip" stackId="a" fill="#64748B" name="Skip" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                {["Suite", "Total", "Pass", "Fail", "Skip", "Coverage", "Status"].map(h => (
                  <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {([] as any[]).map(s => (
                  <tr key={s.name} className="border-b border-border/30">
                    <td className="py-2.5 px-4 font-medium">{s.name}</td>
                    <td className="py-2.5 px-4">{s.total}</td>
                    <td className="py-2.5 px-4 text-green-500 font-semibold">{s.pass}</td>
                    <td className="py-2.5 px-4 text-destructive font-semibold">{s.fail}</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{s.skip}</td>
                    <td className="py-2.5 px-4"><div className="flex items-center gap-2"><Progress value={s.coverage} className="h-1.5 w-16" /><span>{s.coverage}%</span></div></td>
                    <td className="py-2.5 px-4"><Badge variant={s.fail === 0 ? "default" : "destructive"}>{s.fail === 0 ? "Pass" : `${s.fail} failures`}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Defects Tab */}
      {activeTab === "defects" && (
        <div className="space-y-4">
          {/* Defect kanban */}
          <div className="flex gap-3 overflow-x-auto">
            {DEFECT_STATUS.map(status => {
              const col = DEFECTS.filter(d => d.status === status);
              return (
                <div key={status} className="flex-1 min-w-[180px] rounded-xl bg-muted/20">
                  <div className="px-3 py-2 flex items-center gap-2">
                    <span className="text-xs font-semibold">{status}</span>
                    <Badge variant="outline" className="text-[9px]">{col.length}</Badge>
                  </div>
                  <div className="px-2 pb-2 space-y-2">
                    {col.map(d => (
                      <Card key={d.id} className="p-2" style={{ borderLeft: `3px solid ${d.severity === "critical" ? "#EF4444" : d.severity === "major" ? "#F59E0B" : "#64748B"}` }}>
                        <div className="flex items-center gap-1 mb-1">
                          <Badge variant={SEVERITY_VARIANT[d.severity]} className="text-[8px]">{d.severity}</Badge>
                          <span className="text-[9px] font-mono text-muted-foreground">{d.id}</span>
                        </div>
                        <p className="text-[11px] font-medium line-clamp-2">{d.title}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[9px] text-muted-foreground">{d.component}</span>
                          <span className="text-[9px] text-muted-foreground">{d.age}</span>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trends Tab */}
      {activeTab === "trends" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Discovery vs Closure Rate</CardTitle></CardHeader>
            <CardContent>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[] as any[]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="week" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                    <Line type="monotone" dataKey="discovered" stroke="#EF4444" strokeWidth={2} dot={{ r: 3 }} name="Discovered" />
                    <Line type="monotone" dataKey="closed" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} name="Closed" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Test Coverage Growth</CardTitle></CardHeader>
            <CardContent>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[] as any[]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="week" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <YAxis domain={[50, 100]} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                    <Line type="monotone" dataKey="coverage" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--primary)" }} name="Coverage %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Defects by Component</CardTitle></CardHeader>
            <CardContent>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={[] as any[]} dataKey="count" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3}>
                    {COMPONENT_DATA.map(c => <Cell key={c.name} fill={c.fill} />)}
                  </Pie><Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} /></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 justify-center">
                {COMPONENT_DATA.map(c => (
                  <span key={c.name} className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-sm" style={{ background: c.fill }} />{c.name} ({c.count})</span>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Quality Dimensions</CardTitle></CardHeader>
            <CardContent>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={[] as any[]} cx="50%" cy="50%" outerRadius="70%">
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
      )}
    </div>
  );
}
