"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications, useMarkAllRead } from "@/hooks/use-api";
import { Bell, Check, Settings, X } from "lucide-react";

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TYPE_ICONS: Record<string, string> = { APPROVAL_REQUEST: "✅", RISK_ESCALATION: "⚠️", BILLING: "💳", SYSTEM: "⚙️", MILESTONE: "🎯", AGENT_ALERT: "🤖" };
const TYPE_COLORS: Record<string, string> = { APPROVAL_REQUEST: "#6366F1", RISK_ESCALATION: "#EF4444", BILLING: "#F59E0B", SYSTEM: "#64748B", MILESTONE: "#10B981", AGENT_ALERT: "#22D3EE" };

export default function NotificationsPage() {
  const { data: notifications, isLoading } = useNotifications();
  const { mutate: markAll } = useMarkAllRead();
  const [filter, setFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  const items = (notifications || []).filter((n: any) => !filter || n.type === filter);
  const unreadCount = (notifications || []).filter((n: any) => !n.isRead).length;
  const selected = selectedId ? (notifications || []).find((n: any) => n.id === selectedId) : null;

  return (
    <div className="max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Notifications</h1>
          {unreadCount > 0 && <Badge className="bg-primary text-primary-foreground">{unreadCount} unread</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => markAll()}>Mark All Read</Button>
        </div>
      </div>

      {/* Type filters */}
      <div className="flex gap-1 border-b border-border/30 pb-1">
        <button className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${!filter ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          onClick={() => setFilter(null)}>All</button>
        {Object.keys(TYPE_ICONS).map(type => (
          <button key={type} className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${filter === type ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            onClick={() => setFilter(filter === type ? null : type)}>
            {TYPE_ICONS[type]} {type.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <Bell className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">All caught up!</h2>
          <p className="text-sm text-muted-foreground">No notifications to show.</p>
          <Link href="/agents"><Button variant="outline" size="sm" className="mt-4">View Agent Fleet</Button></Link>
        </div>
      ) : (
        <div className="flex gap-4">
          <div className="flex-1 space-y-2">
            {items.map((n: any) => (
              <Card key={n.id} className={`cursor-pointer transition-all hover:-translate-y-0.5 ${selectedId === n.id ? "border-primary/30" : ""} ${!n.isRead ? "border-l-2 border-l-primary" : ""}`}
                onClick={() => setSelectedId(n.id)}>
                <CardContent className="py-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                      style={{ background: `${TYPE_COLORS[n.type] || "#6366F1"}15` }}>
                      {TYPE_ICONS[n.type] || "📋"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge variant="outline" className="text-[9px]">{n.type.replace(/_/g, " ")}</Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(n.createdAt)}</span>
                        {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                      </div>
                      <h3 className={`text-sm font-semibold ${n.isRead ? "text-muted-foreground" : ""}`}>{n.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {selected && (
            <Card className="w-[380px] flex-shrink-0 sticky top-4">
              <CardContent className="pt-5 space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{selected.type.replace(/_/g, " ")}</Badge>
                  <button onClick={() => setSelectedId(null)}><X className="w-4 h-4 text-muted-foreground" /></button>
                </div>
                <h3 className="text-base font-bold">{selected.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{selected.body}</p>
                {selected.actionUrl && (
                  <Link href={selected.actionUrl}><Button className="w-full" size="sm">View Details</Button></Link>
                )}
                <p className="text-[10px] text-center text-muted-foreground">{timeAgo(selected.createdAt)}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
