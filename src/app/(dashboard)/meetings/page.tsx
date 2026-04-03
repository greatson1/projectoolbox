"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Search,
  Download,
  Plus,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

// ================================================================
// DATA
// ================================================================

const UPCOMING = [
  {
    id: "u1",
    time: "Today 3:00 PM",
    title: "Sprint Review \u2014 Mobile App",
    platform: "zoom",
    attendees: ["Alex", "Sarah", "Tom"],
    project: "Mobile App MVP",
    agentJoining: true,
  },
  {
    id: "u2",
    time: "Tomorrow 10:00 AM",
    title: "Gate Review: CRM Planning",
    platform: "teams",
    attendees: ["Maya", "Sarah", "Dave", "James"],
    project: "CRM Migration",
    agentJoining: true,
  },
  {
    id: "u3",
    time: "Thu 2:00 PM",
    title: "Risk Review \u2014 Office Renovation",
    platform: "meet",
    attendees: ["Jordan", "Lisa"],
    project: "Office Renovation",
    agentJoining: true,
  },
];

const PAST = [
  {
    id: "m1",
    date: "2 Apr 2026",
    duration: "58 min",
    title: "Sprint Planning \u2014 Data Migration",
    platform: "zoom",
    attendees: 4,
    project: "CRM Migration",
    badges: ["Transcribed", "Summarised", "Actions Extracted"],
    summary: {
      text: "The sprint planning meeting focused on the data migration strategy for 2 million customer records. Dave Wilson flagged significant data quality issues affecting 15% of records, requiring a dedicated cleansing sprint before migration can begin.\n\nSarah Chen approved the request for an additional data analyst resource, reducing the cleansing timeline from 3 to 2 weeks. The team identified the legacy CRM contract expiry as a critical deadline \u2014 failure to complete migration by July triggers a \u00A350K monthly penalty.\n\nTom Harris committed to setting up a test environment for API integration validation by next Wednesday, contingent on security approval for production API credentials from James Park.",
      topics: [
        "Data Migration",
        "Resource Planning",
        "Risk Assessment",
        "Sprint Goals",
      ],
      sentiment: "concerned" as const,
    },
    speakers: [
      { name: "Sarah Chen", mins: 18, color: "#6366F1" },
      { name: "Dave Wilson", mins: 22, color: "#22D3EE" },
      { name: "Tom Harris", mins: 12, color: "#F59E0B" },
      { name: "Maya (Agent)", mins: 6, color: "#8B5CF6" },
    ],
    transcript: [
      {
        time: "00:02",
        speaker: "Sarah Chen",
        text: "Good morning everyone. Let\u2019s kick off sprint planning for the data migration workstream.",
        highlight: null,
      },
      {
        time: "00:45",
        speaker: "Dave Wilson",
        text: "I\u2019ve done the initial data assessment. About 15% of records have quality issues \u2014 missing emails, duplicate entries, outdated phone numbers.",
        highlight: "risk" as const,
      },
      {
        time: "01:30",
        speaker: "Tom Harris",
        text: "That\u2019s concerning. 15% of 2 million is 300,000 records. How long will cleansing take?",
        highlight: null,
      },
      {
        time: "02:15",
        speaker: "Dave Wilson",
        text: "I estimate 3 weeks with the current team. We could do it in 2 weeks if we get an additional data analyst.",
        highlight: null,
      },
      {
        time: "03:00",
        speaker: "Sarah Chen",
        text: "Budget is tight but we can\u2019t afford bad data in Salesforce. Let\u2019s request the extra resource.",
        highlight: "decision" as const,
      },
      {
        time: "05:30",
        speaker: "Dave Wilson",
        text: "One risk I want to flag \u2014 the legacy CRM vendor contract expires in August. If we don\u2019t complete migration by July, we\u2019ll need to extend at \u00A350,000 per month.",
        highlight: "risk" as const,
      },
      {
        time: "07:00",
        speaker: "Sarah Chen",
        text: "That\u2019s a significant risk. Maya, please log that as high priority.",
        highlight: "action" as const,
      },
      {
        time: "08:15",
        speaker: "Tom Harris",
        text: "I\u2019ll need access to the production API credentials. James Park needs to sign off.",
        highlight: "action" as const,
      },
    ],
    actions: [
      {
        id: "a1",
        text: "Prepare business case for additional data analyst headcount",
        assignee: "Dave Wilson",
        deadline: "Friday",
        status: "pending",
      },
      {
        id: "a2",
        text: "Set up test environment for API integration",
        assignee: "Tom Harris",
        deadline: "Next Wednesday",
        status: "pending",
      },
      {
        id: "a3",
        text: "Get IT Security approval for production API access",
        assignee: "Sarah Chen",
        deadline: "Next week",
        status: "pending",
      },
      {
        id: "a4",
        text: "Complete data migration tool comparison (MuleSoft vs Informatica)",
        assignee: "Dave Wilson",
        deadline: "Monday",
        status: "pending",
      },
      {
        id: "a5",
        text: "Log contract expiry risk in risk register",
        assignee: "Maya (Agent)",
        deadline: "Today",
        status: "done",
      },
    ],
    decisions: [
      {
        id: "d1",
        text: "Sprint goal: Complete data cleansing framework and test environment setup",
        by: "Team consensus",
        rationale:
          "Foundational work required before migration can begin",
        time: "03:00",
      },
      {
        id: "d2",
        text: "Approve additional data analyst resource for cleansing sprint",
        by: "Sarah Chen",
        rationale:
          "Reduces cleansing from 3 to 2 weeks, critical for July deadline",
        time: "03:00",
      },
      {
        id: "d3",
        text: "Migration deadline is non-negotiable due to contract penalty",
        by: "Team consensus",
        rationale:
          "\u00A350K/month penalty makes July deadline business-critical",
        time: "05:30",
      },
    ],
    confidence: 94,
  },
];

const PLATFORM_ICONS: Record<string, string> = {
  zoom: "\u{1F4F9}",
  teams: "\u{1F7E6}",
  meet: "\u{1F7E2}",
};

const HIGHLIGHT_STYLES: Record<string, { bg: string; label: string }> = {
  risk: { bg: "bg-red-500/10", label: "Risk" },
  decision: { bg: "bg-violet-500/10", label: "Decision" },
  action: { bg: "bg-emerald-500/10", label: "Action" },
};

// ================================================================
// COMPONENT
// ================================================================

export default function MeetingsPage() {
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<
    "summary" | "transcript" | "actions" | "decisions"
  >("summary");
  const [searchTranscript, setSearchTranscript] = useState("");

  const meeting = PAST.find((m) => m.id === selectedMeeting);

  // Detail view
  if (meeting) {
    const sentimentColorMap = {
      positive: "text-emerald-500",
      neutral: "text-muted-foreground",
      concerned: "text-amber-500",
    };
    const sentimentDotMap = {
      positive: "bg-emerald-500",
      neutral: "bg-muted-foreground",
      concerned: "bg-amber-500",
    };

    return (
      <div className="space-y-5">
        <button
          onClick={() => setSelectedMeeting(null)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to meetings
        </button>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[20px] font-bold text-foreground">
              {meeting.title}
            </h2>
            <div className="flex items-center gap-3 mt-1 text-[12px] text-muted-foreground">
              <span>
                {PLATFORM_ICONS[meeting.platform]} {meeting.platform}
              </span>
              <span>{"\u00B7"} {meeting.date}</span>
              <span>{"\u00B7"} {meeting.duration}</span>
              <span>{"\u00B7"} {meeting.attendees} attendees</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default">
              Transcription {meeting.confidence}%
            </Badge>
            <Button variant="ghost" size="sm">
              <Download className="h-3.5 w-3.5 mr-1" />
              Export
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-[10px] bg-muted/50">
          {(
            ["summary", "transcript", "actions", "decisions"] as const
          ).map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={cn(
                "px-4 py-2 rounded-lg text-[12px] font-semibold capitalize transition-all",
                detailTab === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "actions"
                ? `Actions (${meeting.actions.length})`
                : tab === "decisions"
                  ? `Decisions (${meeting.decisions.length})`
                  : tab}
            </button>
          ))}
        </div>

        {/* SUMMARY */}
        {detailTab === "summary" && (
          <div className="grid grid-cols-3 gap-5">
            <div className="col-span-2 space-y-4">
              <Card>
                <CardContent>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-3 text-muted-foreground">
                    AI Summary
                  </p>
                  {meeting.summary.text
                    .split("\n\n")
                    .map((p: string, i: number) => (
                      <p
                        key={i}
                        className="text-[13px] leading-relaxed mb-3 text-foreground"
                      >
                        {p}
                      </p>
                    ))}
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {meeting.summary.topics.map((t: string) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <CardContent>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-muted-foreground">
                    Sentiment
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-3 h-3 rounded-full",
                        sentimentDotMap[meeting.summary.sentiment]
                      )}
                    />
                    <span
                      className={cn(
                        "text-[13px] font-semibold capitalize",
                        sentimentColorMap[meeting.summary.sentiment]
                      )}
                    >
                      {meeting.summary.sentiment}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-3 text-muted-foreground">
                    Speaker Breakdown
                  </p>
                  {/* Speaker time PieChart */}
                  <div className="flex items-center gap-4">
                    <div style={{ width: 120, height: 120 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={meeting.speakers.map(s => ({ name: s.name, value: s.mins, color: s.color }))}
                            dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={3}>
                            {meeting.speakers.map((s, i) => <Cell key={i} fill={s.color} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-2">
                      {meeting.speakers.map((s) => {
                        const totalMins = meeting.speakers.reduce((sum, sp) => sum + sp.mins, 0);
                        const pct = Math.round((s.mins / totalMins) * 100);
                        return (
                          <div key={s.name} className="flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                              <span>{s.name}</span>
                            </div>
                            <span className="text-muted-foreground">{s.mins}m ({pct}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* TRANSCRIPT */}
        {detailTab === "transcript" && (
          <Card className="!py-0 !gap-0">
            <div className="px-4 py-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={searchTranscript}
                  onChange={(e) => setSearchTranscript(e.target.value)}
                  placeholder="Search transcript..."
                  className="w-full pl-9 pr-3 py-1.5 text-[13px] rounded-lg outline-none bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {meeting.transcript
                .filter(
                  (l) =>
                    !searchTranscript ||
                    l.text
                      .toLowerCase()
                      .includes(searchTranscript.toLowerCase())
                )
                .map((line, i) => {
                  const hl = line.highlight
                    ? HIGHLIGHT_STYLES[line.highlight]
                    : null;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex gap-3 px-4 py-3 transition-colors border-b border-border",
                        hl?.bg || "bg-transparent"
                      )}
                    >
                      <span className="text-[10px] font-mono w-10 flex-shrink-0 pt-0.5 text-muted-foreground">
                        {line.time}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[12px] font-semibold text-primary">
                            {line.speaker}
                          </span>
                          {hl && (
                            <Badge
                              variant={
                                line.highlight === "risk"
                                  ? "destructive"
                                  : line.highlight === "decision"
                                    ? "default"
                                    : "secondary"
                              }
                            >
                              {hl.label}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[13px] text-foreground">
                          {line.text}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        )}

        {/* ACTIONS */}
        {detailTab === "actions" && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button variant="default" size="sm">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add All to Project Tasks
              </Button>
            </div>
            {meeting.actions.map((a) => (
              <Card key={a.id}>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {a.status === "done" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div>
                        <p className="text-[13px] font-medium text-foreground">
                          {a.text}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          <span>{a.assignee}</span>
                          <span>{"\u00B7"}</span>
                          <span>{a.deadline}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <Badge
                        variant={
                          a.status === "done" ? "default" : "secondary"
                        }
                      >
                        {a.status}
                      </Badge>
                      {a.status !== "done" && (
                        <Button variant="ghost" size="sm">
                          Add to Tasks
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* DECISIONS */}
        {detailTab === "decisions" && (
          <div className="space-y-3">
            {meeting.decisions.map((d) => (
              <Card key={d.id}>
                <CardContent>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-violet-500/10">
                      <span className="text-[14px]">{"\u{1F537}"}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-[14px] font-semibold text-foreground">
                        {d.text}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                        <span>
                          Decided by:{" "}
                          <strong className="text-foreground">
                            {d.by}
                          </strong>
                        </span>
                        <span>{"\u00B7"} {d.time}</span>
                      </div>
                      <p className="text-[12px] mt-2 px-3 py-2 rounded-lg bg-muted/50 text-muted-foreground">
                        Rationale: {d.rationale}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm">
                      Add to Decision Log
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6 max-w-[1000px]">
      {/* Upcoming */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            Upcoming Meetings
          </h2>
          <Button variant="default" size="sm">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Schedule New
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {UPCOMING.map((u) => (
            <Card
              key={u.id}
              className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
            >
              <CardContent>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[16px]">
                    {PLATFORM_ICONS[u.platform]}
                  </span>
                  <span className="text-[12px] font-semibold text-foreground">
                    {u.time}
                  </span>
                </div>
                <p className="text-[13px] font-medium text-foreground">
                  {u.title}
                </p>
                <p className="text-[11px] mt-0.5 text-muted-foreground">
                  {u.project}
                </p>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex -space-x-1.5">
                    {u.attendees.slice(0, 3).map((a) => (
                      <div
                        key={a}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-card"
                        style={{
                          background: `linear-gradient(135deg, var(--primary), hsl(var(--primary) / 0.7))`,
                        }}
                      >
                        {a[0]}
                      </div>
                    ))}
                    {u.attendees.length > 3 && (
                      <span className="text-[10px] ml-2 text-muted-foreground">
                        +{u.attendees.length - 3}
                      </span>
                    )}
                  </div>
                  {u.agentJoining && (
                    <Badge variant="default" className="gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Agent joining
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Past */}
      <div>
        <h2 className="text-[15px] font-semibold mb-3 text-foreground">
          Past Meetings
        </h2>
        <div className="space-y-3">
          {PAST.map((m) => (
            <Card
              key={m.id}
              className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
              onClick={() => {
                setSelectedMeeting(m.id);
                setDetailTab("summary");
              }}
            >
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-center w-[50px]">
                      <p className="text-[11px] text-muted-foreground">
                        {m.date.split(" ")[1]}
                      </p>
                      <p className="text-[18px] font-bold text-foreground">
                        {m.date.split(" ")[0]}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span>{PLATFORM_ICONS[m.platform]}</span>
                        <p className="text-[14px] font-semibold text-foreground">
                          {m.title}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span>{m.duration}</span>
                        <span>{"\u00B7"}</span>
                        <span>{m.attendees} attendees</span>
                        <span>{"\u00B7"}</span>
                        <span>{m.project}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {m.badges.map((b) => (
                      <Badge key={b} variant="default">
                        {b}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
