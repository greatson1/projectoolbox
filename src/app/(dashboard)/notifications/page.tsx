"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications, useMarkAllRead } from "@/hooks/use-api";
import { Bell, Settings, X, Check } from "lucide-react";

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TYPE_CFG: Record<string, { icon: string; color: string; label: string }> = {
  APPROVAL_REQUEST: { icon: "✅", color: "#6366F1", label: "Approvals" },
  RISK_ESCALATION: { icon: "⚠️", color: "#EF4444", label: "Risks" },
  BILLING: { icon: "💳", color: "#F59E0B", label: "Billing" },
  SYSTEM: { icon: "⚙️", color: "#64748B", label: "System" },
  MILESTONE: { icon: "🎯", color: "#10B981", label: "Milestones" },
  AGENT_ALERT: { icon: "🤖", color: "#22D3EE", label: "Agent" },
};

const FILTER_TABS = ["all", "APPROVAL_REQUEST", "RISK_ESCALATION", "AGENT_ALERT", "BILLING", "MILESTONE", "SYSTEM"];

export default function NotificationsPage() {
  const { data: notifications, isLoading } = useNotifications();
  const { mutate: markAll } = useMarkAllRead();
  const [activeTab, setActiveTab] = useState<string>("all");
  const [highOnly, setHighOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  // Pref state
  const [prefToggles, setPrefToggles] = useState<Record<string, string>>({
    APPROVAL_REQUEST: "always", RISK_ESCALATION: "always", BILLING: "always", AGENT_ALERT: "digest", MILESTONE: "digest", SYSTEM: "off",
  });
  const [deliveryEmail, setDeliveryEmail] = useState(true);
  const [deliverySlack, setDeliverySlack] = useState(true);
  const [deliveryPush, setDeliveryPush] = useState(false);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" />{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;

  const items = useMemo(() => {
    let r = notifications || [];
    if (activeTab !== "all") r = r.filter((n: any) => n.type === activeTab);
    return r;
  }, [notifications, activeTab]);

  const unreadCount = (notifications || []).filter((n: any) => !n.isRead).length;
  const selected = selectedId ? (notifications || []).find((n: any) => n.id === selectedId) : null;

  // Type counts for stats bar
  const typeCounts: Record<string, number> = {};
  (notifications || []).filter((n: any) => !n.isRead).forEach((n: any) => { typeCounts[n.type] = (typeCounts[n.type] || 0) + 1; });

  return (
    <div className="max-w-[1400px] space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Notifications</h1>
          {unreadCount > 0 && <Badge className="bg-primary text-primary-foreground">{unreadCount} unread</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => markAll()}>Mark All Read</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPrefs(!showPrefs)}><Settings className="w-4 h-4 mr-1" /> Preferences</Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {Object.entries(TYPE_CFG).map(([type, cfg]) => {
          const count = typeCounts[type] || 0;
          return (
            <div key={type} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${count > 0 ? "border-border/50" : "border-transparent"}`}
              style={{ background: count > 0 ? `${cfg.color}10` : undefined }}>
              <span className="text-xs">{cfg.icon}</span>
              <span className="text-[11px] font-semibold" style={{ color: count > 0 ? cfg.color : undefined }}>{cfg.label}</span>
              {count > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: cfg.color }}>{count}</span>}
            </div>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">High priority only</span>
          <button className={`w-9 h-5 rounded-full relative transition-all ${highOnly ? "bg-destructive" : "bg-border"}`} onClick={() => setHighOnly(!highOnly)}>
            <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: highOnly ? 18 : 2 }} />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border/30">
        {FILTER_TABS.map(tab => (
          <button key={tab} className={`px-3 py-2 text-xs font-semibold transition-all border-b-2 ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setActiveTab(tab)}>{tab === "all" ? "All" : TYPE_CFG[tab]?.label || tab}</button>
        ))}
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="text-center py-20">
          <Bell className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">All caught up!</h2>
          <p className="text-sm text-muted-foreground">No notifications to show.</p>
          <Link href="/agents"><Button variant="outline" size="sm" className="mt-4">View Agent Fleet</Button></Link>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* List */}
          <div className="flex-1 space-y-2">
            {items.map((n: any) => {
              const cfg = TYPE_CFG[n.type] || { icon: "📋", color: "#64748B", label: "Other" };
              const isSel = selectedId === n.id;
              return (
                <Card key={n.id} className={`cursor-pointer transition-all hover:-translate-y-0.5 ${isSel ? "border-primary/30 shadow-md" : ""} ${!n.isRead ? "border-l-2 border-l-primary" : ""}`}
                  onClick={() => setSelectedId(n.id)}>
                  <CardContent className="py-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: `${cfg.color}15` }}>{cfg.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge variant="outline" className="text-[9px]">{cfg.label}</Badge>
                          <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(n.createdAt)}</span>
                          {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                        </div>
                        <h3 className={`text-sm font-semibold ${n.isRead ? "text-muted-foreground" : ""}`}>{n.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Detail panel */}
          {selected && (
            <Card className="w-[380px] flex-shrink-0 sticky top-4 max-h-[calc(100vh-200px)] overflow-y-auto">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <Badge variant="outline">{TYPE_CFG[selected.type]?.label || selected.type}</Badge>
                <button onClick={() => setSelectedId(null)}><X className="w-4 h-4 text-muted-foreground" /></button>
              </CardHeader>
              <CardContent className="space-y-4">
                <h3 className="text-base font-bold">{selected.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{selected.body}</p>
                {selected.actionUrl && <Link href={selected.actionUrl}><Button className="w-full" size="sm">View Details</Button></Link>}
                <p className="text-[10px] text-center text-muted-foreground">{timeAgo(selected.createdAt)}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Preferences panel */}
      {showPrefs && (
        <Card className="mt-4">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm">Notification Preferences</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowPrefs(false)}>Close</Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Per-type */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">By Type</p>
                <div className="space-y-2">
                  {Object.entries(TYPE_CFG).map(([type, cfg]) => (
                    <div key={type} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{cfg.icon}</span>
                        <span className="text-xs">{cfg.label}</span>
                      </div>
                      <select className="px-2 py-1 rounded text-[10px] font-semibold bg-background border border-input"
                        value={prefToggles[type] || "always"} onChange={e => setPrefToggles({ ...prefToggles, [type]: e.target.value })}>
                        <option value="always">Always</option>
                        <option value="digest">Digest</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              {/* Channels */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Delivery Channels</p>
                <div className="space-y-2">
                  <ToggleRow label="📧 Email" checked={deliveryEmail} onChange={setDeliveryEmail} />
                  <ToggleRow label="💬 Slack" checked={deliverySlack} onChange={setDeliverySlack} />
                  <ToggleRow label="🔔 Push" checked={deliveryPush} onChange={setDeliveryPush} />
                </div>
              </div>
              {/* Quiet hours */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Quiet Hours</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="time" defaultValue="22:00" className="px-2 py-1 rounded bg-background border border-input text-xs" />
                  <span>to</span>
                  <input type="time" defaultValue="07:00" className="px-2 py-1 rounded bg-background border border-input text-xs" />
                </div>
              </div>
            </div>
            <Button size="sm" className="mt-4">Save Preferences</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs">{label}</span>
      <button className={`w-9 h-5 rounded-full relative transition-all ${checked ? "bg-primary" : "bg-border"}`} onClick={() => onChange(!checked)}>
        <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: checked ? 18 : 2 }} />
      </button>
    </div>
  );
}
