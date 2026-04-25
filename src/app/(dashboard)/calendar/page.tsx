// @ts-nocheck
"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalendarEvents } from "@/hooks/use-api";
import { Calendar, Plus, Clock, MapPin, Users, Bot, FileText, ChevronRight } from "lucide-react";
import { NewEventModal } from "@/components/meetings/new-event-modal";

function timeUntil(date: string | Date) {
  const ms = new Date(date).getTime() - Date.now();
  if (ms < 0) return "past";
  if (ms < 3600000) return `in ${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `in ${Math.round(ms / 3600000)}h`;
  return `in ${Math.round(ms / 86400000)}d`;
}

export default function CalendarPage() {
  usePageTitle("Calendar");
  const [range, setRange] = useState("week");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  const { data, isLoading } = useCalendarEvents(range);

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
    </div>
  );

  const events = data?.events || [];
  const needsBrief = data?.needsBrief || [];

  // Group by date
  const grouped: Record<string, any[]> = {};
  events.forEach((e: any) => {
    const day = new Date(e.startTime).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(e);
  });

  // Event detail view
  if (selectedEvent) {
    return (
      <div className="space-y-5 max-w-[800px]">
        <button onClick={() => setSelectedEvent(null)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-4 w-4 rotate-180" /> Back to calendar
        </button>

        <div>
          <h2 className="text-xl font-bold">{selectedEvent.title}</h2>
          <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
            <span><Clock className="inline h-3.5 w-3.5 mr-1" />{new Date(selectedEvent.startTime).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            {selectedEvent.endTime && <span>→ {new Date(selectedEvent.endTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
            {selectedEvent.location && <span><MapPin className="inline h-3.5 w-3.5 mr-1" />{selectedEvent.location}</span>}
          </div>
        </div>

        {selectedEvent.project && (
          <Badge variant="secondary">{selectedEvent.project.name}</Badge>
        )}

        {selectedEvent.description && (
          <Card><CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Description</p>
            <p className="text-sm text-foreground">{selectedEvent.description}</p>
          </CardContent></Card>
        )}

        {selectedEvent.attendees && (
          <Card><CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              <Users className="inline h-3.5 w-3.5 mr-1" />Attendees
            </p>
            <div className="flex flex-wrap gap-2">
              {(selectedEvent.attendees as any[]).map((a: any, i: number) => (
                <Badge key={i} variant="outline">{a.name || a.email}</Badge>
              ))}
            </div>
          </CardContent></Card>
        )}

        {/* Pre-meeting brief */}
        {selectedEvent.preAgenda ? (
          <Card><CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              <Bot className="inline h-3.5 w-3.5 mr-1 text-primary" />Pre-Meeting Brief
            </p>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: selectedEvent.preAgenda }} />
          </CardContent></Card>
        ) : selectedEvent.projectId ? (
          <Card><CardContent className="p-4 text-center">
            <Bot className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">No pre-meeting brief generated yet</p>
            <Button size="sm" onClick={async () => {
              const r = await fetch(`/api/calendar`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...selectedEvent, generateBrief: true }),
              });
              if (r.ok) window.location.reload();
            }}>
              <FileText className="h-3.5 w-3.5 mr-1" /> Generate Brief
            </Button>
          </CardContent></Card>
        ) : null}

        {selectedEvent.postUpdate && (
          <Card><CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Post-Meeting Update</p>
            <p className="text-sm text-foreground">{selectedEvent.postUpdate}</p>
          </CardContent></Card>
        )}

        {selectedEvent.meetingUrl && (
          <Button asChild><a href={selectedEvent.meetingUrl} target="_blank" rel="noopener noreferrer">Join Meeting</a></Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[900px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Calendar</h1>
          <p className="text-sm text-muted-foreground mt-1">{events.length} events · {needsBrief.length} need briefs</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New Event
        </Button>
      </div>

      {/* Range filter */}
      <div className="flex rounded-lg border border-border overflow-hidden w-fit">
        {[{ id: "today", label: "Today" }, { id: "week", label: "This Week" }, { id: "month", label: "This Month" }].map(r => (
          <button key={r.id} onClick={() => setRange(r.id)}
            className={`px-3 py-1.5 text-xs font-semibold ${range === r.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Needs brief alert */}
      {needsBrief.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-semibold">{needsBrief.length} upcoming meeting{needsBrief.length > 1 ? "s" : ""} need pre-meeting briefs</p>
                <p className="text-[11px] text-muted-foreground">Your agent can prepare agenda and talking points from project data.</p>
              </div>
              <Button size="sm" variant="default" onClick={async () => {
                for (const e of needsBrief) {
                  await fetch(`/api/calendar`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...e, generateBrief: true }),
                  });
                }
                window.location.reload();
              }}>Generate All Briefs</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Events grouped by day */}
      {events.length === 0 ? (
        <div className="text-center py-16">
          <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-bold mb-2">No events</h3>
          <p className="text-sm text-muted-foreground mb-4">Schedule meetings or invite agents via email to populate the calendar.</p>
          <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" /> Add Event</Button>
        </div>
      ) : (
        Object.entries(grouped).map(([day, dayEvents]) => (
          <div key={day}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{day}</p>
            <div className="space-y-2">
              {dayEvents.map((e: any) => {
                const isPast = new Date(e.startTime) < new Date();
                return (
                  <Card key={e.id} className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
                    onClick={() => setSelectedEvent(e)}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="text-center w-[50px] flex-shrink-0">
                          <p className="text-lg font-bold">{new Date(e.startTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
                          {!isPast && <p className="text-[10px] text-primary font-semibold">{timeUntil(e.startTime)}</p>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold truncate">{e.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                            {e.project && <span>{e.project.name}</span>}
                            {e.location && <><span>·</span><span>{e.location}</span></>}
                            {e.source === "EMAIL" && <Badge variant="secondary" className="text-[9px]">via email</Badge>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {e.preAgenda && <Badge variant="default" className="text-[9px]">Brief ready</Badge>}
                          {e.agent && (
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                              style={{ background: e.agent.gradient || "#6366F1" }}>{e.agent.name[0]}</div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Create event modal */}
      {showCreate && <NewEventModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
