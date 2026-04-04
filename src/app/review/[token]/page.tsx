// @ts-nocheck
"use client";

import { useState, useEffect, use } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, MessageSquare, Loader2, Shield } from "lucide-react";

export default function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/review/${token}`).then(r => r.json()).then(d => {
      if (d.data) setData(d.data);
      else setError(d.error || "Invalid or expired link");
      setLoading(false);
    }).catch(() => { setError("Failed to load"); setLoading(false); });
  }, [token]);

  const handleAction = async (action: string) => {
    setActing(true);
    try {
      const r = await fetch(`/api/review/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: comment || undefined }),
      });
      const d = await r.json();
      if (r.ok) setResult(action);
      else setError(d.error || "Failed");
    } catch { setError("Network error"); }
    setActing(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md"><CardContent className="p-8 text-center">
        <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Cannot Load Review</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </CardContent></Card>
    </div>
  );

  if (result) return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md"><CardContent className="p-8 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">
          {result === "approve" ? "Approved" : result === "reject" ? "Rejected" : "Feedback Sent"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {result === "approve" ? "The agent will proceed with this action." : result === "reject" ? "The agent will not proceed." : "Your feedback has been sent to the agent."}
        </p>
        <p className="text-xs text-muted-foreground mt-4">You can close this page.</p>
      </CardContent></Card>
    </div>
  );

  const scores = data.impactScores || {};

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-white text-sm font-bold mx-auto mb-3">PT</div>
          <p className="text-xs text-muted-foreground">Review requested by Projectoolbox</p>
        </div>

        <Card className="overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-primary to-primary/40" />
          <CardContent className="p-6 space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-lg font-bold">{data.title}</h1>
                <Badge variant="secondary">{data.type}</Badge>
                {data.urgency && <Badge variant={data.urgency === "HIGH" || data.urgency === "CRITICAL" ? "destructive" : "secondary"}>{data.urgency}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{data.projectName} · Agent: {data.agentName}</p>
            </div>

            {/* Description / Reasoning */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Details</p>
              <p className="text-sm leading-relaxed">{data.description}</p>
            </div>
            {data.reasoning && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Agent Reasoning</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{data.reasoning}</p>
              </div>
            )}

            {/* Impact scores */}
            {(scores.schedule || scores.cost || scores.scope || scores.stakeholder) && (
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Schedule", value: scores.schedule || 1 },
                  { label: "Cost", value: scores.cost || 1 },
                  { label: "Scope", value: scores.scope || 1 },
                  { label: "Stakeholder", value: scores.stakeholder || 1 },
                ].map(dim => (
                  <div key={dim.label} className={`rounded-lg p-2 text-center ${dim.value <= 1 ? "bg-emerald-500/10" : dim.value <= 2 ? "bg-blue-500/10" : dim.value <= 3 ? "bg-amber-500/10" : "bg-red-500/10"}`}>
                    <p className="text-[10px] text-muted-foreground uppercase">{dim.label}</p>
                    <p className="text-lg font-bold">{dim.value}/4</p>
                  </div>
                ))}
              </div>
            )}

            {/* Comment */}
            {showComment && (
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
                placeholder="Add your comments or feedback..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none resize-y" />
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button className="flex-1 bg-emerald-500 hover:bg-emerald-600" onClick={() => handleAction("approve")} disabled={acting}>
                {acting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                Approve
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => { if (!showComment) setShowComment(true); else handleAction("request_changes"); }} disabled={acting}>
                <MessageSquare className="w-4 h-4 mr-1" />
                {showComment ? "Send Feedback" : "Request Changes"}
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={() => handleAction("reject")} disabled={acting}>
                Reject
              </Button>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-2 border-t border-border/30">
              <Shield className="w-3 h-3" />
              <span>This is a secure review link. No account required. Expires {new Date(data.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
