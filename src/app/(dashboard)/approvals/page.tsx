"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApprovals, useApprovalAction } from "@/hooks/use-api";
import { Check, X, Clock, ChevronDown, ChevronUp, MessageSquare, Shield } from "lucide-react";

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TYPE_ICONS: Record<string, string> = { PHASE_GATE: "🚩", BUDGET: "💰", SCOPE_CHANGE: "📐", RISK_RESPONSE: "⚠️", CHANGE_REQUEST: "📝", RESOURCE: "👥", COMMUNICATION: "📧", PROCUREMENT: "🛒" };

export default function ApprovalsPage() {
  const [filter, setFilter] = useState("PENDING");
  const { data: approvals, isLoading } = useApprovals(filter);
  const { mutate: doAction, isPending } = useApprovalAction();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1200px]">
        <Skeleton className="h-10 w-48" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
    );
  }

  const items = approvals || [];

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-muted-foreground mt-1">Human-in-the-loop governance queue</p>
      </div>

      <div className="flex gap-1">
        {["PENDING", "APPROVED", "REJECTED", "DEFERRED", "all"].map(f => (
          <button key={f} className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => setFilter(f)}>
            {f.toLowerCase()} {f === "PENDING" && items.length > 0 ? `(${items.length})` : ""}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">{filter === "PENDING" ? "No pending approvals" : "No approvals found"}</h2>
          <p className="text-sm text-muted-foreground">{filter === "PENDING" ? "Agents escalate decisions that exceed their autonomy level." : "Try a different filter."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item: any) => {
            const expanded = expandedId === item.id;
            const impact = item.impact as any;
            return (
              <Card key={item.id} className={expanded ? "border-primary/30" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpandedId(expanded ? null : item.id)}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-primary/10 flex-shrink-0">
                      {TYPE_ICONS[item.type] || "📋"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge variant="outline" className="text-[9px]">{item.type.replace(/_/g, " ")}</Badge>
                        <span className="text-[10px] text-muted-foreground">{item.project?.name}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(item.createdAt)}</span>
                      </div>
                      <h3 className="text-sm font-semibold">{item.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {item.status === "PENDING" && (
                        <>
                          <Button size="sm" className="h-7 text-xs" disabled={isPending}
                            onClick={(e) => { e.stopPropagation(); doAction({ id: item.id, action: "approve" }); }}>
                            <Check className="w-3 h-3 mr-1" /> Approve
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={isPending}
                            onClick={(e) => { e.stopPropagation(); doAction({ id: item.id, action: "reject" }); }}>
                            <X className="w-3 h-3 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      {item.status !== "PENDING" && (
                        <Badge variant={item.status === "APPROVED" ? "default" : item.status === "REJECTED" ? "destructive" : "secondary"}>{item.status}</Badge>
                      )}
                      {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-4 pt-4 border-t border-border/30 space-y-3">
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                      {impact && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Impact Analysis</p>
                          <div className="grid grid-cols-4 gap-2">
                            {["schedule", "cost", "scope", "risk"].map(dim => (
                              <div key={dim} className="p-2 rounded-lg bg-muted/30 text-center">
                                <p className="text-[10px] text-muted-foreground capitalize">{dim}</p>
                                <p className={`text-xs font-bold ${impact[dim] === "high" ? "text-destructive" : impact[dim] === "medium" ? "text-amber-500" : "text-green-500"}`}>
                                  {impact[dim] || "none"}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {item.status === "PENDING" && (
                        <div className="flex gap-2 pt-2">
                          <Button size="sm" disabled={isPending} onClick={() => doAction({ id: item.id, action: "approve" })}><Check className="w-3.5 h-3.5 mr-1" /> Approve</Button>
                          <Button variant="destructive" size="sm" disabled={isPending} onClick={() => doAction({ id: item.id, action: "reject" })}><X className="w-3.5 h-3.5 mr-1" /> Reject</Button>
                          <Button variant="outline" size="sm" disabled={isPending} onClick={() => doAction({ id: item.id, action: "defer" })}><Clock className="w-3.5 h-3.5 mr-1" /> Defer</Button>
                          <Link href="/agents/chat" className="ml-auto"><Button variant="ghost" size="sm"><MessageSquare className="w-3.5 h-3.5 mr-1" /> Ask Agent</Button></Link>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
