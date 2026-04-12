"use client";
// @ts-nocheck

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNotifications, useMarkAllRead } from "@/hooks/use-api";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import Link from "next/link";

/**
 * Notifications Centre — Filterable notification list with detail panel & preferences.
 */



// ═══════════════════════════════════════════════════════════════════
// TYPES & DATA
// ═══════════════════════════════════════════════════════════════════

type NType = "approval" | "risk" | "document" | "meeting" | "billing" | "system";
type Priority = "high" | "medium" | "none";

interface Notification {
  id: number;
  type: NType;
  agentId: string;
  agentName: string;
  agentInitials: string;
  agentColor: string;
  project: string;
  title: string;
  description: string;
  detail: string;
  time: string;
  minutesAgo: number;
  priority: Priority;
  read: boolean;
  actions: string[];
  related?: string[];
}


const TYPE_CONFIG: Record<NType, { icon: string; color: string; label: string }> = {
  approval: { icon: "✅", color: "#6366F1", label: "Approvals" },
  risk: { icon: "⚠️", color: "#EF4444", label: "Risks" },
  document: { icon: "📄", color: "#22D3EE", label: "Documents" },
  meeting: { icon: "🎙️", color: "#10B981", label: "Meetings" },
  billing: { icon: "💳", color: "#F59E0B", label: "Billing" },
  system: { icon: "⚙️", color: "#64748B", label: "System" },
};

const FILTER_TABS: (NType | "all")[] = ["all", "approval", "risk", "document", "meeting", "billing", "system"];

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function NotificationsPage() {
  const mode = "dark";
  const { data: apiNotifs, isLoading: notifsLoading } = useNotifications();
  usePageTitle("Notifications");
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Populate from API when data arrives
  useEffect(() => {
    if (apiNotifs === undefined) return; // still loading
    if (apiNotifs && apiNotifs.length > 0) {
      setNotifications(apiNotifs.map((n: any, i: number) => ({
        id: n.id || i, type: (({ AGENT_ALERT: "system", APPROVAL_REQUEST: "approval", BILLING: "billing", SYSTEM: "system", MILESTONE: "system", RISK_ESCALATION: "risk" } as Record<string, string>)[n.type] || "system") as NType,
        agentId: "", agentName: "System", agentInitials: "S", agentColor: "#6366F1",
        project: n.project || "", title: n.title || "", description: n.body || n.message || "",
        detail: n.body || n.message || "", time: new Date(n.createdAt).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        minutesAgo: Math.round((Date.now() - new Date(n.createdAt).getTime()) / 60000),
        priority: (n.priority === "high" ? "high" : "none") as Priority,
        read: n.isRead || false, actions: ["Acknowledge"],
      })));
    }
  }, [apiNotifs]);
  const [activeTab, setActiveTab] = useState<NType | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [highPriorityOnly, setHighPriorityOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  // Prefs state
  const [prefToggles, setPrefToggles] = useState<Record<NType, "always" | "digest" | "off">>({
    approval: "always", risk: "always", document: "digest", meeting: "digest", billing: "always", system: "off",
  });
  const [deliveryEmail, setDeliveryEmail] = useState(true);
  const [deliverySlack, setDeliverySlack] = useState(true);
  const [deliveryPush, setDeliveryPush] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");

  const unreadCount = notifications.filter(n => !n.read).length;

  const filtered = useMemo(() => {
    let result = [...notifications];
    if (activeTab !== "all") result = result.filter(n => n.type === activeTab);
    if (agentFilter) result = result.filter(n => n.agentId === agentFilter);
    if (highPriorityOnly) result = result.filter(n => n.priority === "high");
    return result;
  }, [notifications, activeTab, agentFilter, highPriorityOnly]);

  const selected = selectedId ? notifications.find(n => n.id === selectedId) : null;

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const markRead = (id: number) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));

  const typeCounts: Record<NType, number> = { approval: 0, risk: 0, document: 0, meeting: 0, billing: 0, system: 0 };
  notifications.filter(n => !n.read).forEach(n => typeCounts[n.type]++);

  // Show loading skeleton while waiting for API
  if (notifsLoading) {
    return (
      <div className="max-w-[1400px] space-y-4">
        <div className="h-9 w-48 rounded-lg bg-muted animate-pulse" />
        {[1,2,3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  // Empty state — shown once API has resolved with nothing
  if (!notifsLoading && filtered.length === 0 && activeTab === "all" && !agentFilter && !highPriorityOnly) {
    return (
      <div className="max-w-[600px] mx-auto text-center py-20">
        <div className="text-[48px] mb-4">🎉</div>
        <h2 className="text-[22px] font-bold mb-2" style={{ color: "var(--foreground)" }}>All caught up!</h2>
        <p className="text-[14px] mb-6" style={{ color: "var(--muted-foreground)" }}>You're all caught up — no notifications right now.</p>
        <Link href="/agents"><Button variant="default" size="sm">View Agent Fleet</Button></Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px]">
      {/* ═══ 1. HEADER ═══ */}
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={markAllRead}>Mark All Read</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowPrefs(!showPrefs)}>⚙ Preferences</Button>
          </div>
        }
      />

      {/* ═══ 2. STATS BAR ═══ */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {(Object.keys(TYPE_CONFIG) as NType[]).map(type => {
          const cfg = TYPE_CONFIG[type];
          const count = typeCounts[type];
          return (
            <div key={type} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px]"
              style={{ background: count > 0 ? `${cfg.color}12` : "transparent", border: `1px solid ${count > 0 ? cfg.color + "33" : "var(--border)" + "22"}` }}>
              <span className="text-[12px]">{cfg.icon}</span>
              <span className="text-[11px] font-semibold" style={{ color: count > 0 ? cfg.color : "var(--muted-foreground)" }}>{cfg.label}</span>
              {count > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: cfg.color }}>{count}</span>}
            </div>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>High priority only</span>
          <Toggle checked={highPriorityOnly} onChange={setHighPriorityOnly} color={"#EF4444"} />
        </div>
      </div>

      {/* ═══ 3. FILTER TABS ═══ */}
      <div className="flex gap-1 mb-3" style={{ borderBottom: `1px solid ${"var(--border)"}22` }}>
        {FILTER_TABS.map(tab => {
          const active = activeTab === tab;
          const label = tab === "all" ? "All" : TYPE_CONFIG[tab].label;
          return (
            <button key={tab} className="px-3 py-2 text-[12px] font-semibold transition-all"
              onClick={() => setActiveTab(tab)}
              style={{
                color: active ? "var(--primary)" : "var(--muted-foreground)",
                borderBottom: active ? `2px solid ${"var(--primary)"}` : "2px solid transparent",
              }}>{label}</button>
          );
        })}
      </div>

      {/* ═══ 4. AGENT FILTER PILLS ═══ */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Agent:</span>
        <button className="px-2 py-1 rounded-[6px] text-[10px] font-semibold transition-all"
          onClick={() => setAgentFilter(null)}
          style={{ background: !agentFilter ? `${"var(--primary)"}22` : "transparent", color: !agentFilter ? "var(--primary)" : "var(--muted-foreground)", border: `1px solid ${!agentFilter ? "var(--primary)" + "44" : "transparent"}` }}>
          All
        </button>
        {([] as any[]).map((a: any) => (
          <button key={a.id} className="flex items-center gap-1 px-2 py-1 rounded-full transition-all"
            onClick={() => setAgentFilter(agentFilter === a.id ? null : a.id)}
            style={{
              background: agentFilter === a.id ? `${a.color}22` : "transparent",
              border: `1px solid ${agentFilter === a.id ? a.color + "44" : "var(--border)" + "33"}`,
              opacity: a.status === "paused" ? 0.5 : 1,
            }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: a.color }}>{a.initials}</div>
            <span className="text-[10px] font-semibold" style={{ color: agentFilter === a.id ? a.color : "var(--muted-foreground)" }}>{a.name}</span>
            {a.status === "paused" && <span className="text-[8px]" style={{ color: "#F59E0B" }}>⏸</span>}
          </button>
        ))}
      </div>

      {/* ═══ 5 + 6. NOTIFICATION LIST + DETAIL PANEL ═══ */}
      <div className="flex gap-4">
        {/* List */}
        <div className="flex-1 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[14px]" style={{ color: "var(--muted-foreground)" }}>No notifications matching your filters.</p>
              <button className="text-[12px] font-semibold mt-2" style={{ color: "var(--primary)" }}
                onClick={() => { setActiveTab("all"); setAgentFilter(null); setHighPriorityOnly(false); }}>
                Clear filters
              </button>
            </div>
          ) : (
            filtered.map(n => {
              const cfg = TYPE_CONFIG[n.type];
              const isSelected = selectedId === n.id;
              return (
                <div key={n.id} className="rounded-[12px] p-3.5 cursor-pointer transition-all duration-150 hover:translate-y-[-1px]"
                  onClick={() => { setSelectedId(n.id); markRead(n.id); }}
                  style={{
                    background: isSelected ? `${cfg.color}08` : "var(--card)",
                    border: isSelected ? `1.5px solid ${cfg.color}33` : `1px solid ${"var(--border)"}`,
                    boxShadow: isSelected ? `0 2px 12px ${cfg.color}12` : "0 1px 3px rgba(0,0,0,0.08)",
                  }}>
                  <div className="flex items-start gap-3">
                    {/* Type icon */}
                    <div className="w-9 h-9 rounded-[8px] flex items-center justify-center text-[16px] flex-shrink-0"
                      style={{ background: `${cfg.color}15` }}>{cfg.icon}</div>

                    <div className="flex-1 min-w-0">
                      {/* Top row */}
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                          style={{ background: n.agentColor }}>{n.agentInitials}</div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] font-semibold"
                          style={{ background: `${n.agentColor}12`, color: n.agentColor }}>{n.project}</span>
                        <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: "var(--muted-foreground)" }}>{n.time}</span>
                        {/* Priority + unread dots */}
                        {n.priority === "high" && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#EF4444" }} />}
                        {n.priority === "medium" && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#F59E0B" }} />}
                        {!n.read && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--primary)" }} />}
                      </div>

                      {/* Title + desc */}
                      <p className="text-[13px] font-semibold leading-snug" style={{ color: n.read ? "var(--muted-foreground)" : "var(--foreground)" }}>{n.title}</p>
                      <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: "var(--muted-foreground)" }}>{n.description}</p>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 mt-2">
                        {n.actions.slice(0, 2).map(a => (
                          <button key={a} className="px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-all hover:opacity-80"
                            onClick={e => e.stopPropagation()}
                            style={{
                              background: a === n.actions[0] ? cfg.color : "transparent",
                              color: a === n.actions[0] ? "#FFF" : "var(--muted-foreground)",
                              border: a === n.actions[0] ? "none" : `1px solid ${"var(--border)"}44`,
                            }}>{a}</button>
                        ))}
                        {n.actions.length > 2 && (
                          <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>+{n.actions.length - 2} more</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ═══ 6. DETAIL PANEL ═══ */}
        {selected && (
          <div className="w-[400px] flex-shrink-0 rounded-[14px] overflow-hidden sticky top-4"
            style={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, boxShadow: "0 10px 15px rgba(0,0,0,0.08)", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
            {/* Header */}
            <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
              <div className="flex items-center gap-2">
                <span className="text-[18px]">{TYPE_CONFIG[selected.type].icon}</span>
                <Badge variant={selected.priority === "high" ? "destructive" : selected.priority === "medium" ? "secondary" : "outline"}>{selected.priority || "info"}</Badge>
              </div>
              <button onClick={() => setSelectedId(null)} className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[16px]"
                style={{ color: "var(--muted-foreground)", background: `${"var(--border)"}22` }}>×</button>
            </div>

            {/* Content */}
            <div className="px-5 py-4">
              {/* Agent + Project */}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: selected.agentColor }}>{selected.agentInitials}</div>
                <span className="text-[12px] font-semibold" style={{ color: selected.agentColor }}>Agent {selected.agentName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-[4px]" style={{ background: `${"var(--border)"}22`, color: "var(--muted-foreground)" }}>{selected.project}</span>
              </div>

              <h3 className="text-[15px] font-bold mb-3 leading-snug" style={{ color: "var(--foreground)" }}>{selected.title}</h3>

              {/* Detail text */}
              <div className="text-[12px] leading-relaxed whitespace-pre-line mb-4" style={{ color: "var(--muted-foreground)" }}>
                {selected.detail}
              </div>

              {/* Related items */}
              {selected.related && (
                <div className="mb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--muted-foreground)" }}>Related Items</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.related.map(r => (
                      <span key={r} className="text-[10px] px-2 py-1 rounded-[6px] font-medium cursor-pointer hover:opacity-80"
                        style={{ background: `${"var(--primary)"}12`, color: "var(--primary)", border: `1px solid ${"var(--primary)"}22` }}>{r}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2 mb-4">
                {selected.actions.map((a, i) => (
                  <button key={a} className="w-full py-2 rounded-[8px] text-[12px] font-semibold transition-all hover:opacity-90"
                    style={{
                      background: i === 0 ? TYPE_CONFIG[selected.type].color : "transparent",
                      color: i === 0 ? "#FFF" : "var(--muted-foreground)",
                      border: i === 0 ? "none" : `1px solid ${"var(--border)"}`,
                    }}>{a}</button>
                ))}
              </div>

              {/* Quick links */}
              <div className="flex gap-2 pt-3" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
                <button className="flex-1 py-2 rounded-[8px] text-[11px] font-semibold" style={{ color: "var(--primary)", background: `${"var(--primary)"}08`, border: `1px solid ${"var(--primary)"}22` }}>
                  Open in Project
                </button>
                <button className="flex-1 py-2 rounded-[8px] text-[11px] font-semibold" style={{ color: selected.agentColor, background: `${selected.agentColor}08`, border: `1px solid ${selected.agentColor}22` }}>
                  💬 Chat with {selected.agentName}
                </button>
              </div>

              <p className="text-[10px] text-center mt-3" style={{ color: "var(--muted-foreground)" }}>{selected.time}</p>
            </div>
          </div>
        )}
      </div>

      {/* ═══ 7. PREFERENCES (expandable) ═══ */}
      {showPrefs && (
        <Card className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Notification Preferences</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowPrefs(false)}>Close</Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Per-type toggles */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Notification Types</p>
              <div className="space-y-2">
                {(Object.keys(TYPE_CONFIG) as NType[]).map(type => {
                  const cfg = TYPE_CONFIG[type];
                  return (
                    <div key={type} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px]">{cfg.icon}</span>
                        <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{cfg.label}</span>
                      </div>
                      <select className="px-2 py-1 rounded-[6px] text-[10px] font-semibold"
                        value={prefToggles[type]}
                        onChange={e => setPrefToggles({ ...prefToggles, [type]: e.target.value as any })}
                        style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
                        <option value="always">Always</option>
                        <option value="digest">Digest</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Delivery channels */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Delivery Channels</p>
              <div className="space-y-2">
                <ToggleRow label="📧 Email" checked={deliveryEmail} onChange={setDeliveryEmail} />
                <ToggleRow label="💬 Slack" checked={deliverySlack} onChange={setDeliverySlack} />
                <ToggleRow label="🔔 Push" checked={deliveryPush} onChange={setDeliveryPush} />
              </div>

              <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Quiet Hours</p>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)}
                    className="px-2 py-1 rounded-[6px]" style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }} />
                  <span>to</span>
                  <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)}
                    className="px-2 py-1 rounded-[6px]" style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }} />
                </div>
              </div>
            </div>

            {/* Per-agent mute */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Agent Mute</p>
              <div className="space-y-2">
                {([] as any[]).map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: a.color }}>{a.initials}</div>
                      <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{a.name}</span>
                    </div>
                    <Toggle checked={true} onChange={() => {}} color={a.color} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Button variant="default" size="sm" className="mt-4" onClick={async () => { try { await fetch("/api/notifications/preferences", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ prefToggles, deliveryEmail, deliverySlack, deliveryPush, quietStart, quietEnd }) }); toast.success("Preferences saved"); } catch { toast.error("Failed to save"); } }}>Save Preferences</Button>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function Toggle({ checked, onChange, color}: { checked: boolean; onChange: (v: boolean) => void; color: string;  }) {
  return (
    <button className="w-9 h-[20px] rounded-full relative transition-all flex-shrink-0" onClick={() => onChange(!checked)}
      style={{ background: checked ? color : `${"var(--border)"}66` }}>
      <div className="absolute top-[2px] w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: checked ? 18 : 2 }} />
    </button>
  );
}

function ToggleRow({ label, checked, onChange}: { label: string; checked: boolean; onChange: (v: boolean) => void;  }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{label}</span>
      <Toggle checked={checked} onChange={onChange} color={"var(--primary)"} />
    </div>
  );
}
