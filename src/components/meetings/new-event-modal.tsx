// @ts-nocheck
"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCreateCalendarEvent, useProjects } from "@/hooks/use-api";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, Bot, X } from "lucide-react";

export function NewEventModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [projectId, setProjectId] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [genBrief, setGenBrief] = useState(true);
  const [useZoom, setUseZoom] = useState(false);
  const [zoomConnected, setZoomConnected] = useState<boolean | null>(null);
  const [zoomAuthUrl, setZoomAuthUrl] = useState<string | null>(null);
  const [inviteEmails, setInviteEmails] = useState("");
  const [agenda, setAgenda] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ joinUrl: string; botDispatched: boolean; botProvider: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: projects } = useProjects();
  const createEvent = useCreateCalendarEvent();
  const queryClient = useQueryClient();

  // Check Zoom connection status (one-shot)
  useState(() => {
    fetch("/api/integrations/zoom").then(r => r.json()).then(d => {
      setZoomConnected(d.data?.connected || false);
      setZoomAuthUrl(d.data?.authUrl || null);
    }).catch(() => setZoomConnected(false));
  });

  const handleSubmit = async () => {
    if (!title || !startTime) return;
    setSubmitting(true);
    setResult(null);

    try {
      if (useZoom) {
        const invitees = inviteEmails.split(/[,;\n]/).map(e => e.trim()).filter(Boolean)
          .map(email => ({ name: email.split("@")[0], email }));

        const r = await fetch("/api/meetings/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title, startTime, duration: parseInt(duration),
            projectId: projectId || undefined,
            invitees, agenda: agenda || undefined,
          }),
        });
        const data = await r.json();

        if (r.ok) {
          // Bust both calendar and meetings caches so the new entry appears immediately
          // on whichever page opened the modal.
          await queryClient.invalidateQueries({ queryKey: ["calendar"] });
          await queryClient.invalidateQueries({ queryKey: ["meetings"] });
          setSuccess({
            joinUrl: data.data?.joinUrl || "",
            botDispatched: !!data.data?.botDispatched,
            botProvider: data.data?.botProvider ?? null,
          });
          setSubmitting(false);
        } else {
          setResult(data.error || "Failed to schedule");
          setSubmitting(false);
        }
      } else {
        await createEvent.mutateAsync({
          title, startTime, endTime: endTime || undefined,
          projectId: projectId || undefined, meetingUrl: meetingUrl || undefined,
          generateBrief: genBrief && !!projectId,
        });
        await queryClient.invalidateQueries({ queryKey: ["meetings"] });
        onClose();
      }
    } catch (e: any) {
      setResult(e.message || "Error");
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Meeting scheduled</h2>
              <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              <span className="font-semibold text-foreground">{title}</span> is on the calendar for{" "}
              {new Date(startTime).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
            </p>

            <div className="rounded-lg border border-border bg-muted/30 p-3 mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Join URL</p>
              <p className="text-xs font-mono break-all text-foreground select-all">{success.joinUrl}</p>
            </div>

            <div className="flex gap-2 mb-4">
              <a
                href={success.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors"
              >
                📹 Join meeting
              </a>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(success.joinUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  } catch {/* noop */}
                }}
                className="px-4 py-2 rounded-lg border border-border hover:bg-muted/40 text-sm font-medium"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>

            <div className={`rounded-lg p-3 text-xs ${success.botDispatched ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300"}`}>
              {success.botDispatched ? (
                <>
                  <span className="font-semibold">Note-taking bot dispatched</span>
                  {success.botProvider ? ` (${success.botProvider})` : ""}.
                  It will join at the meeting's start time, record, and post the
                  transcript-driven summary, decisions, risks, and action items
                  to the Knowledge Base after the call.
                </>
              ) : (
                <>
                  <span className="font-semibold">No note-taking bot will join.</span>{" "}
                  Recording credentials aren't configured for this org, so the
                  agent won't capture the call automatically. You can paste a
                  recap on the calendar event afterwards if you want it on file.
                </>
              )}
            </div>

            <Button className="w-full mt-4" onClick={onClose}>Done</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold">New Meeting / Event</h2>
            <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
          </div>

          {/* Zoom toggle */}
          <div className="flex gap-2 p-1 rounded-lg bg-muted/50 mb-4">
            <button onClick={() => setUseZoom(false)}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${!useZoom ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
              <Calendar className="inline h-3.5 w-3.5 mr-1" /> Calendar Event
            </button>
            <button onClick={() => setUseZoom(true)}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${useZoom ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
              📹 Schedule Zoom Meeting
            </button>
          </div>

          {/* Zoom not connected warning */}
          {useZoom && zoomConnected === false && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-4">
              <p className="text-xs text-amber-600 font-medium mb-2">Zoom not connected</p>
              {zoomAuthUrl ? (
                <a href={zoomAuthUrl} className="inline-block px-3 py-1.5 rounded-md bg-blue-500 text-white text-xs font-semibold">
                  Connect Zoom Account
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">Go to Admin → Integrations to connect Zoom.</p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Title</span>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Sprint Planning — CRM Migration"
                className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Start</span>
                <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
              </label>
              {useZoom ? (
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Duration (min)</span>
                  <select value={duration} onChange={e => setDuration(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none">
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">1 hour</option>
                    <option value="90">1.5 hours</option>
                    <option value="120">2 hours</option>
                  </select>
                </label>
              ) : (
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">End</span>
                  <input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
                </label>
              )}
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Project</span>
              <select value={projectId} onChange={e => setProjectId(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none">
                <option value="">No project</option>
                {(projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            {useZoom ? (
              <>
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Invite Emails (comma-separated)</span>
                  <input value={inviteEmails} onChange={e => setInviteEmails(e.target.value)}
                    placeholder="sarah@company.com, tom@company.com"
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Agenda</span>
                  <textarea value={agenda} onChange={e => setAgenda(e.target.value)} rows={3}
                    placeholder="1. Review sprint progress&#10;2. Discuss blockers&#10;3. Plan next sprint"
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none resize-y" />
                </label>
                <div className="p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
                  <p className="text-[11px] text-muted-foreground">
                    <Bot className="inline h-3.5 w-3.5 mr-1 text-blue-500" />
                    Your agent will create the Zoom meeting, send email invitations to attendees, save the event to the calendar, and generate a pre-meeting brief from project data.
                  </p>
                </div>
              </>
            ) : (
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Meeting URL</span>
                <input value={meetingUrl} onChange={e => setMeetingUrl(e.target.value)} placeholder="https://zoom.us/j/..."
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
              </label>
            )}

            {projectId && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={genBrief} onChange={e => setGenBrief(e.target.checked)} className="rounded" />
                <span className="text-xs text-muted-foreground">Generate pre-meeting brief from project data</span>
              </label>
            )}
          </div>

          {result && (
            <div className={`mt-3 p-2 rounded-lg text-xs ${result.startsWith("http") ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>
              {result.startsWith("http") ? (
                <span>Meeting created! <a href={result} target="_blank" rel="noopener noreferrer" className="underline font-semibold">Join Link</a></span>
              ) : result}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting || !title || !startTime || (useZoom && !zoomConnected)}>
              {submitting ? "Scheduling..." : useZoom ? "📹 Schedule Zoom Meeting" : "Create Event"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
