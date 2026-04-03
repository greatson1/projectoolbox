"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { useParams } from "next/navigation";
import { useProjectStakeholders } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Stakeholder Management — Power/interest grid, list, sentiment, comms log.
 */


import { PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";


// ================================================================
// DATA
// ================================================================

interface Stakeholder {
  id: string; name: string; role: string; org: string; power: number; interest: number;
  sentiment: "supportive" | "neutral" | "resistant" | "unknown";
  engagement: "high" | "medium" | "low"; lastContact: string; assignedTo: string;
  email: string; phone: string; strategy: string; commPref: string;
}

const STAKEHOLDERS: Stakeholder[] = [
  { id: "s1", name: "Sarah Chen", role: "Project Sponsor", org: "Acme Construction", power: 5, interest: 5, sentiment: "supportive", engagement: "high", lastContact: "Today", assignedTo: "Maya", email: "sarah@acme.com", phone: "+44 7700 900001", strategy: "Weekly 1-1 updates, involve in all gate decisions", commPref: "Email + Teams call" },
  { id: "s2", name: "James Park", role: "IT Security Director", org: "Acme Construction", power: 4, interest: 3, sentiment: "neutral", engagement: "medium", lastContact: "3 days ago", assignedTo: "Maya", email: "james.p@acme.com", phone: "+44 7700 900002", strategy: "Engage on security gates, provide early visibility of access requests", commPref: "Email" },
  { id: "s3", name: "Dave Wilson", role: "Data Lead", org: "Acme Construction", power: 3, interest: 5, sentiment: "supportive", engagement: "high", lastContact: "Today", assignedTo: "Maya", email: "dave.w@acme.com", phone: "+44 7700 900003", strategy: "Daily standups, involve in all data migration decisions", commPref: "Slack + standup" },
  { id: "s4", name: "Tom Harris", role: "Technical Lead", org: "Acme Construction", power: 3, interest: 4, sentiment: "supportive", engagement: "high", lastContact: "Yesterday", assignedTo: "Maya", email: "tom.h@acme.com", phone: "+44 7700 900004", strategy: "Sprint reviews, technical decision partner", commPref: "Slack" },
  { id: "s5", name: "Lisa Park", role: "Finance Director", org: "Acme Construction", power: 5, interest: 2, sentiment: "neutral", engagement: "low", lastContact: "2 weeks ago", assignedTo: "Sarah Chen", email: "lisa@acme.com", phone: "+44 7700 900005", strategy: "Monthly budget reports, escalate overruns immediately", commPref: "Email report" },
  { id: "s6", name: "Mark Thompson", role: "Head of Sales", org: "Acme Construction", power: 4, interest: 4, sentiment: "resistant", engagement: "medium", lastContact: "1 week ago", assignedTo: "Maya", email: "mark.t@acme.com", phone: "+44 7700 900006", strategy: "Address concerns about CRM transition impact on pipeline", commPref: "Face-to-face" },
  { id: "s7", name: "Emma Roberts", role: "HR Director", org: "Acme Construction", power: 3, interest: 2, sentiment: "neutral", engagement: "low", lastContact: "3 weeks ago", assignedTo: "Sarah Chen", email: "emma.r@acme.com", phone: "+44 7700 900007", strategy: "Engage for training and change management workstream", commPref: "Email" },
  { id: "s8", name: "Raj Patel", role: "Salesforce Architect", org: "CloudForce Consulting", power: 2, interest: 5, sentiment: "supportive", engagement: "high", lastContact: "Today", assignedTo: "Tom Harris", email: "raj@cloudforce.io", phone: "+44 7700 900008", strategy: "Technical partner, daily collaboration on configuration", commPref: "Slack + pair sessions" },
  { id: "s9", name: "Claire Johnson", role: "Marketing Manager", org: "Acme Construction", power: 2, interest: 3, sentiment: "unknown", engagement: "low", lastContact: "1 month ago", assignedTo: "Maya", email: "claire.j@acme.com", phone: "+44 7700 900009", strategy: "Engage when marketing automation module begins", commPref: "Email" },
  { id: "s10", name: "Michael Brown", role: "CRM Vendor Account Mgr", org: "Legacy CRM Inc", power: 2, interest: 4, sentiment: "resistant", engagement: "medium", lastContact: "1 week ago", assignedTo: "Sarah Chen", email: "m.brown@legacycrm.com", phone: "+44 7700 900010", strategy: "Manage contract transition, negotiate extension terms if needed", commPref: "Formal meetings" },
  { id: "s11", name: "Dr. Helen White", role: "Board Member", org: "Acme Construction", power: 5, interest: 1, sentiment: "neutral", engagement: "low", lastContact: "2 months ago", assignedTo: "Sarah Chen", email: "h.white@acme-board.com", phone: "", strategy: "Quarterly board pack, escalate only critical issues", commPref: "Board report" },
];

const SENTIMENT_DATA = [
  { name: "Supportive", value: 4, color: "#34D399" },
  { name: "Neutral", value: 4, color: "#94A3B8" },
  { name: "Resistant", value: 2, color: "#F87171" },
  { name: "Unknown", value: 1, color: "#6366F1" },
];

const RADAR_DATA = [
  { dim: "Communication", value: 78 }, { dim: "Involvement", value: 65 },
  { dim: "Influence", value: 82 }, { dim: "Support", value: 70 }, { dim: "Availability", value: 55 },
];

const COMMS_LOG = [
  { date: "2 Apr", type: "Meeting", name: "Sarah Chen", summary: "Sprint planning — discussed data migration strategy", outcome: "Approved extra resource", next: "Follow up on business case" },
  { date: "1 Apr", type: "Email", name: "Lisa Park", summary: "Monthly budget report sent", outcome: "Acknowledged, no concerns", next: "Next report 1 May" },
  { date: "28 Mar", type: "Call", name: "Mark Thompson", summary: "Addressed sales pipeline concerns during CRM transition", outcome: "Agreed to phased cutover", next: "Demo new system 15 Apr" },
  { date: "25 Mar", type: "Report", name: "Dr. Helen White", summary: "Quarterly board update on digital transformation", outcome: "Board noted progress", next: "Next board report Jul" },
];

const SENTIMENT_ICONS: Record<string, string> = { supportive: "😊", neutral: "😐", resistant: "😟", unknown: "❓" };
const COMMS_ICONS: Record<string, string> = { Meeting: "🤝", Email: "📧", Call: "📞", Report: "📊" };

// ================================================================
// COMPONENT
// ================================================================

export default function StakeholdersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: apiStakeholders } = useProjectStakeholders(projectId);

  const STAKEHOLDERS_DATA: Stakeholder[] = (apiStakeholders && apiStakeholders.length > 0) ? apiStakeholders.map((s: any, idx: number) => ({
    id: s.id || `s${idx + 1}`,
    name: s.name || "",
    role: s.role || "",
    org: s.org || s.organization || "",
    power: s.power ?? 3,
    interest: s.interest ?? 3,
    sentiment: s.sentiment || "unknown",
    engagement: s.engagement || "medium",
    lastContact: s.lastContact || "—",
    assignedTo: s.assignedTo || "",
    email: s.email || "",
    phone: s.phone || "",
    strategy: s.strategy || "",
    commPref: s.commPref || s.communicationPreference || "",
  })) : STAKEHOLDERS;

  const mode = "dark";
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Stakeholder | null>(null);

  const filtered = STAKEHOLDERS_DATA.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.role.toLowerCase().includes(search.toLowerCase()));

  // Grid quadrant positioning
  function gridPos(s: Stakeholder): { x: number; y: number } {
    const jitter = (parseInt(s.id.replace("s", "")) * 17) % 30;
    return { x: (s.interest / 5) * 85 + 5 + (jitter % 10), y: (1 - s.power / 5) * 85 + 5 + (jitter % 8) };
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Stakeholder Management</h1>
        <div className="flex items-center gap-3">
          <div className="w-[240px]"><input className="w-full px-3 py-1.5 rounded-lg text-xs bg-background border border-input" placeholder="Search stakeholders..." value={search} onChange={(e: any) => setSearch(e.target.value)} /></div>
          <div className="flex gap-1 p-0.5 rounded-[8px]" style={{ backgroundColor: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" }}>
            {(["grid", "list"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 rounded-[6px] text-[11px] font-semibold capitalize"
                style={{ backgroundColor: view === v ? (true ? "var(--card)" : "white") : "transparent", color: view === v ? "var(--foreground)" : "var(--muted-foreground)" }}>{v}</button>
            ))}
          </div>
          <Button variant="default" size="sm">Add Stakeholder</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        {/* Main area */}
        <div className="xl:col-span-2 space-y-5">
          {/* Power/Interest Grid */}
          {view === "grid" && (
            <Card>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Power / Interest Grid</p>
              <div className="relative w-full aspect-square max-w-[500px] mx-auto rounded-[12px] overflow-hidden" style={{ border: `1px solid ${"var(--border)"}` }}>
                {/* Quadrants */}
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
                  <div className="flex items-center justify-center" style={{ backgroundColor: true ? "rgba(251,191,36,0.06)" : "rgba(251,191,36,0.08)" }}>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Keep Satisfied</span>
                  </div>
                  <div className="flex items-center justify-center" style={{ backgroundColor: true ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.08)" }}>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Manage Closely</span>
                  </div>
                  <div className="flex items-center justify-center" style={{ backgroundColor: true ? "rgba(100,116,139,0.06)" : "rgba(100,116,139,0.06)" }}>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Monitor</span>
                  </div>
                  <div className="flex items-center justify-center" style={{ backgroundColor: true ? "rgba(99,102,241,0.06)" : "rgba(99,102,241,0.08)" }}>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Keep Informed</span>
                  </div>
                </div>
                {/* Axes */}
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Interest →</div>
                <div className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[9px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Power →</div>
                {/* Dots */}
                {filtered.map((s) => {
                  const pos = gridPos(s);
                  const sentColor = s.sentiment === "supportive" ? "#10B981" : s.sentiment === "resistant" ? "#EF4444" : s.sentiment === "neutral" ? "var(--muted-foreground)" : "var(--primary)";
                  return (
                    <div key={s.id} onClick={() => setSelected(s)}
                      className="absolute w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-bold text-white cursor-pointer transition-all hover:scale-125 hover:z-10"
                      style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)", backgroundColor: sentColor, boxShadow: selected?.id === s.id ? "0 4px 24px rgba(99,102,241,0.4)" : "none", border: selected?.id === s.id ? "2px solid white" : "2px solid transparent" }}
                      title={`${s.name} — ${s.role}`}>
                      {s.name.split(" ").map((n) => n[0]).join("")}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* List View */}
          {view === "list" && (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                      {["Name", "Role", "Power", "Interest", "Sentiment", "Engagement", "Last Contact"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.id} onClick={() => setSelected(s)} className="cursor-pointer transition-colors"
                        style={{ borderBottom: `1px solid ${"var(--border)"}` }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div><div><p className="font-medium" style={{ color: "var(--foreground)" }}>{s.name}</p><p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{s.org}</p></div></div></td>
                        <td className="px-4 py-3" style={{ color: "var(--muted-foreground)" }}>{s.role}</td>
                        <td className="px-4 py-3"><div className="flex gap-0.5">{Array.from({ length: 5 }, (_, i) => <span key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: i < s.power ? "var(--primary)" : "var(--border)" }} />)}</div></td>
                        <td className="px-4 py-3"><div className="flex gap-0.5">{Array.from({ length: 5 }, (_, i) => <span key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: i < s.interest ? "#22D3EE" : "var(--border)" }} />)}</div></td>
                        <td className="px-4 py-3"><span className="text-[14px]">{SENTIMENT_ICONS[s.sentiment]}</span></td>
                        <td className="px-4 py-3"><Badge variant={s.engagement === "high" ? "default" : s.engagement === "medium" ? "secondary" : "outline"}>{s.engagement}</Badge></td>
                        <td className="px-4 py-3" style={{ color: "var(--muted-foreground)" }}>{s.lastContact}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Comms Log */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Communications Log</CardTitle>
              <Button variant="ghost" size="sm">Log Communication</Button>
            </CardHeader>
            <CardContent>
            <div className="space-y-3">
              {COMMS_LOG.map((c, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[14px]" style={{ backgroundColor: "rgba(99,102,241,0.12)" }}>{COMMS_ICONS[c.type]}</div>
                    {i < COMMS_LOG.length - 1 && <div className="w-px flex-1 mt-1" style={{ backgroundColor: "var(--border)" }} />}
                  </div>
                  <div className="pb-3 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{c.name}</span>
                      <Badge variant="outline">{c.type}</Badge>
                      <span className="text-[10px] ml-auto" style={{ color: "var(--muted-foreground)" }}>{c.date}</span>
                    </div>
                    <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{c.summary}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>Outcome: {c.outcome} · Next: {c.next}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent></Card>
        </div>

        {/* Right panel */}
        <div className="space-y-5">
          {/* Sentiment */}
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Sentiment Distribution</p>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={SENTIMENT_DATA} dataKey="value" cx="50%" cy="50%" outerRadius={55} innerRadius={30}>
                  {SENTIMENT_DATA.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1 mt-1">
              {SENTIMENT_DATA.map((s) => (
                <div key={s.name} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} /><span style={{ color: "var(--muted-foreground)" }}>{s.name}</span></div>
                  <span style={{ color: "var(--foreground)" }}>{s.value}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Engagement Radar */}
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Engagement Dimensions</p>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={RADAR_DATA}>
                <PolarGrid stroke={"var(--border)"} />
                <PolarAngleAxis dataKey="dim" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                <Radar dataKey="value" stroke={"var(--primary)"} fill={"var(--primary)"} fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </Card>

          {/* Selected stakeholder detail */}
          {selected && (
            <Card>
              <div className="flex items-center gap-3 mb-3">
                
                <div>
                  <p className="text-[14px] font-bold" style={{ color: "var(--foreground)" }}>{selected.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{selected.role} · {selected.org}</p>
                </div>
              </div>
              <div className="space-y-2 text-[12px]">
                {[
                  { l: "Email", v: selected.email },
                  { l: "Power", v: `${selected.power}/5` },
                  { l: "Interest", v: `${selected.interest}/5` },
                  { l: "Sentiment", v: `${SENTIMENT_ICONS[selected.sentiment]} ${selected.sentiment}` },
                  { l: "Engagement", v: selected.engagement },
                  { l: "Comm Pref", v: selected.commPref },
                  { l: "Assigned To", v: selected.assignedTo },
                ].map((r) => (
                  <div key={r.l} className="flex justify-between" style={{ borderBottom: `1px solid ${"var(--border)"}`, paddingBottom: 6 }}>
                    <span style={{ color: "var(--muted-foreground)" }}>{r.l}</span>
                    <span className="font-medium capitalize" style={{ color: "var(--foreground)" }}>{r.v}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-3 p-2 rounded-[8px]" style={{ backgroundColor: "rgba(99,102,241,0.12)", color: "var(--primary)" }}>
                Strategy: {selected.strategy}
              </p>
              <div className="mt-3"><Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button></div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
