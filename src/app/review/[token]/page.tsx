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
  const [selectedRiskAction, setSelectedRiskAction] = useState<string | null>(null);
  const [escalateEmail, setEscalateEmail] = useState("");

  useEffect(() => {
    fetch(`/api/review/${token}`).then(r => r.json()).then(d => {
      if (d.data) setData(d.data);
      else setError(d.error || "Invalid or expired link");
      setLoading(false);
    }).catch(() => { setError("Failed to load"); setLoading(false); });
  }, [token]);

  const handleAction = async (action: string) => {
    setActing(true);
    const topRiskId = data?.targetRiskId || data?.risks?.[0]?.id;
    const riskAction = ["ACCEPT", "MITIGATE", "TRANSFER", "AVOID", "ESCALATE"].includes(action);
    try {
      const r = await fetch(`/api/review/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          comment: comment || undefined,
          ...(riskAction && topRiskId ? { riskId: topRiskId, strategy: action } : {}),
          ...(action === "ESCALATE" && escalateEmail ? { escalateToEmail: escalateEmail } : {}),
        }),
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
  // Show the specific risk this escalation is about (not just highest scored)
  const topRisk = data.targetRiskId
    ? data.risks?.find((r: any) => r.id === data.targetRiskId) || data.risks?.[0]
    : data.risks?.[0];
  const isRiskEscalation = data.type === "CHANGE_REQUEST" || data.type === "RISK_RESPONSE" || !!topRisk;

  const RISK_ACTIONS = [
    { id: "ACCEPT", label: "Accept Risk", desc: "Monitor but take no immediate action. Set trigger points for future escalation.", color: "#10B981" },
    { id: "MITIGATE", label: "Mitigate", desc: "Reduce probability or impact. Agent will create mitigation tasks.", color: "#3B82F6" },
    { id: "TRANSFER", label: "Transfer", desc: "Transfer via insurance, contracts, or third-party arrangements.", color: "#8B5CF6" },
    { id: "AVOID", label: "Avoid", desc: "Change project scope or approach to eliminate the risk.", color: "#F59E0B" },
    { id: "ESCALATE", label: "Escalate Further", desc: "Needs higher-level attention. Escalate to programme board.", color: "#EF4444" },
  ];

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <img src="/pt-logo.png" alt="Projectoolbox" className="w-10 h-10 object-contain mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">Review requested by {data.agentName} via Projectoolbox</p>
        </div>

        <Card className="overflow-hidden">
          <div className={`h-2 ${isRiskEscalation ? "bg-gradient-to-r from-red-600 to-red-400" : "bg-gradient-to-r from-primary to-primary/40"}`} />
          <CardContent className="p-6 space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-lg font-bold">{data.title}</h1>
                <Badge variant={isRiskEscalation ? "destructive" : "secondary"}>{data.type?.replace(/_/g, " ")}</Badge>
                {data.urgency && <Badge variant={data.urgency === "HIGH" || data.urgency === "CRITICAL" ? "destructive" : "secondary"}>{data.urgency}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{data.projectName} · Agent: {data.agentName}</p>
            </div>

            {/* Risk detail card */}
            {topRisk && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-600">Escalated Risk</p>
                    <p className="text-sm font-bold text-foreground mt-0.5">{topRisk.title}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-red-600">{topRisk.score}/25</p>
                    <p className="text-[10px] text-muted-foreground">P{topRisk.probability} x I{topRisk.impact}</p>
                  </div>
                </div>
                {topRisk.description && <p className="text-sm text-muted-foreground">{topRisk.description}</p>}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><span className="text-muted-foreground">Category:</span> <span className="font-medium">{topRisk.category || "—"}</span></div>
                  <div><span className="text-muted-foreground">Owner:</span> <span className="font-medium">{topRisk.owner || "Unassigned"}</span></div>
                  <div><span className="text-muted-foreground">Status:</span> <span className="font-medium">{topRisk.status}</span></div>
                  <div><span className="text-muted-foreground">Mitigation:</span> <span className="font-medium">{topRisk.mitigation || "None"}</span></div>
                </div>
              </div>
            )}

            {/* Agent analysis */}
            {data.description && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Agent Analysis</p>
                <p className="text-sm leading-relaxed whitespace-pre-line">{data.description}</p>
              </div>
            )}
            {data.reasoning && data.reasoning !== data.description && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Reasoning</p>
                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{data.reasoning}</p>
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

            {/* Risk response actions */}
            {isRiskEscalation && topRisk ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your Decision</p>
                <p className="text-sm text-muted-foreground">Select a response strategy:</p>
                <div className="space-y-2">
                  {RISK_ACTIONS.map(a => (
                    <button key={a.id} onClick={() => setSelectedRiskAction(a.id)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                        selectedRiskAction === a.id ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                      }`}>
                      <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
                        <div>
                          <p className="text-sm font-semibold">{a.label}</p>
                          <p className="text-[11px] text-muted-foreground">{a.desc}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {selectedRiskAction && (
                  <>
                    {/* Escalate Further: ask WHO to escalate to */}
                    {selectedRiskAction === "ESCALATE" && (
                      <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 space-y-2">
                        <label className="text-xs font-bold text-foreground">Who should this be escalated to?</label>
                        <input type="email" placeholder="Enter their email address"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none"
                          value={escalateEmail} onChange={e => setEscalateEmail(e.target.value)} />
                        <p className="text-[10px] text-muted-foreground">They will receive an escalation email with a review link — no account needed.</p>
                      </div>
                    )}
                    <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
                      placeholder={selectedRiskAction === "ESCALATE" ? "Explain why this needs further escalation..." : "Additional instructions or context for the project team..."}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none resize-y" />
                  </>
                )}

                {selectedRiskAction && (
                  <Button className="w-full" onClick={() => handleAction(selectedRiskAction)}
                    disabled={acting || (selectedRiskAction === "ESCALATE" && !escalateEmail.includes("@"))}>
                    {acting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                    {selectedRiskAction === "ESCALATE"
                      ? (escalateEmail ? `Escalate to ${escalateEmail}` : "Enter email to escalate")
                      : `Confirm: ${RISK_ACTIONS.find(a => a.id === selectedRiskAction)?.label}`}
                  </Button>
                )}
              </div>
            ) : (
              /* Standard approval actions */
              <>
                {showComment && (
                  <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
                    placeholder="Add your comments or feedback..."
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none resize-y" />
                )}
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
              </>
            )}

            {/* Other risks */}
            {data.risks?.length > 1 && (
              <div className="pt-2 border-t border-border/30">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Other Project Risks ({data.risks.length - 1})</p>
                {data.risks.slice(1, 4).map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between py-1.5">
                    <span className="text-xs">{r.title}</span>
                    <span className={`text-xs font-bold ${r.score >= 15 ? "text-red-500" : r.score >= 10 ? "text-amber-500" : ""}`}>{r.score}/25</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-2 border-t border-border/30">
              <Shield className="w-3 h-3" />
              <span>Secure review link. No account required. Expires {new Date(data.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
