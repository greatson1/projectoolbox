"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTeamMembers, useAuditLog, useBilling } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

/**
 * Admin Settings — 8-tab vertical navigation.
 * Organisation, Team, Roles, Security, Integrations, API, Compliance, Audit.
 */


import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ═══════════════════════════════════════════════════════════════════
// TYPES & DATA
// ═══════════════════════════════════════════════════════════════════

const TABS = [
  { id: "org", label: "Organisation", icon: "🏢" },
  { id: "team", label: "Team Management", icon: "👥" },
  { id: "roles", label: "Roles & Permissions", icon: "🔐" },
  { id: "security", label: "Security", icon: "🛡️" },
  { id: "integrations", label: "Integrations", icon: "🔗" },
  { id: "api", label: "API & Webhooks", icon: "⚡" },
  { id: "compliance", label: "Data & Compliance", icon: "📋" },
  { id: "audit", label: "Audit Log", icon: "📜" },
] as const;

type TabId = typeof TABS[number]["id"];

const MEMBERS = [
  { name: "Dr. Ty Beetseh", email: "ty@pmgtsolutions.com", role: "Owner", status: "active", lastActive: "Now", projects: 5, initials: "TB" },
  { name: "Sarah Chen", email: "sarah@pmgtsolutions.com", role: "Admin", status: "active", lastActive: "2h ago", projects: 4, initials: "SC" },
  { name: "James Okafor", email: "james@pmgtsolutions.com", role: "Manager", status: "active", lastActive: "1h ago", projects: 3, initials: "JO" },
  { name: "Priya Sharma", email: "priya@pmgtsolutions.com", role: "Member", status: "active", lastActive: "30m ago", projects: 2, initials: "PS" },
  { name: "Liam Barrett", email: "liam@pmgtsolutions.com", role: "Member", status: "active", lastActive: "3h ago", projects: 2, initials: "LB" },
  { name: "Mia Novak", email: "mia@pmgtsolutions.com", role: "Member", status: "active", lastActive: "5h ago", projects: 3, initials: "MN" },
  { name: "David Kim", email: "david@pmgtsolutions.com", role: "Viewer", status: "invited", lastActive: "—", projects: 0, initials: "DK" },
];

const PENDING_INVITES = [
  { email: "david@pmgtsolutions.com", role: "Viewer", sentAt: "1 Apr 2026", expiresIn: "6 days" },
  { email: "emma.wright@atlascorp.com", role: "Member", sentAt: "31 Mar 2026", expiresIn: "5 days" },
];

const ROLES = [
  { name: "Owner", color: "#8B5CF6", desc: "Full access. Billing, team, delete org.", count: 1 },
  { name: "Admin", color: "#6366F1", desc: "Manage team, settings, all projects.", count: 1 },
  { name: "Manager", color: "#22D3EE", desc: "Manage assigned projects and agents.", count: 1 },
  { name: "Member", color: "#10B981", desc: "Contribute to assigned projects.", count: 3 },
  { name: "Viewer", color: "#64748B", desc: "Read-only access to dashboards.", count: 1 },
];

const PERMISSIONS = [
  { feature: "View dashboards", Owner: true, Admin: true, Manager: true, Member: true, Viewer: true },
  { feature: "Manage projects", Owner: true, Admin: true, Manager: true, Member: false, Viewer: false },
  { feature: "Deploy agents", Owner: true, Admin: true, Manager: true, Member: false, Viewer: false },
  { feature: "Approve artefacts", Owner: true, Admin: true, Manager: true, Member: true, Viewer: false },
  { feature: "Manage team", Owner: true, Admin: true, Manager: false, Member: false, Viewer: false },
  { feature: "Billing & plans", Owner: true, Admin: false, Manager: false, Member: false, Viewer: false },
  { feature: "Security settings", Owner: true, Admin: true, Manager: false, Member: false, Viewer: false },
  { feature: "API keys", Owner: true, Admin: true, Manager: false, Member: false, Viewer: false },
  { feature: "Audit log", Owner: true, Admin: true, Manager: true, Member: false, Viewer: false },
  { feature: "Data export", Owner: true, Admin: true, Manager: false, Member: false, Viewer: false },
  { feature: "Delete org", Owner: true, Admin: false, Manager: false, Member: false, Viewer: false },
];

const SESSIONS = [
  { device: "Chrome on Windows 11", ip: "82.29.185.213", location: "London, UK", lastActive: "Now", current: true },
  { device: "Safari on macOS", ip: "82.29.185.214", location: "London, UK", lastActive: "2h ago", current: false },
  { device: "Mobile App (iOS)", ip: "86.12.45.67", location: "Manchester, UK", lastActive: "1d ago", current: false },
];

const INTEGRATIONS_CONNECTED = [
  { name: "Slack", icon: "💬", status: "Connected", lastSync: "2 min ago", desc: "Send notifications, sync channels" },
  { name: "Google Calendar", icon: "📅", status: "Connected", lastSync: "5 min ago", desc: "Meeting scheduling, agent calendar" },
  { name: "Jira", icon: "🔗", status: "Connected", lastSync: "12 min ago", desc: "Two-way task sync, issue tracking" },
  { name: "GitHub", icon: "🐙", status: "Connected", lastSync: "30 min ago", desc: "PR tracking, code commits" },
];

const INTEGRATIONS_AVAILABLE = [
  { name: "MS Teams", icon: "📺", desc: "Team chat and meeting integration" },
  { name: "Azure DevOps", icon: "🔵", desc: "Work items, pipelines, boards" },
  { name: "Zoom", icon: "📹", desc: "Meeting bot, transcript capture" },
  { name: "Confluence", icon: "📝", desc: "Wiki sync, knowledge base" },
  { name: "Notion", icon: "📓", desc: "Document sync, databases" },
];

const INTEGRATIONS_SOON = [
  { name: "Basecamp", icon: "🏕️" },
  { name: "Monday.com", icon: "📊" },
  { name: "Asana", icon: "🎯" },
];

const API_KEYS = [
  { name: "Production Key", key: "ptx_live_sk_****...3f8a", created: "15 Jan 2026", lastUsed: "2h ago", status: "active" },
  { name: "Development Key", key: "ptx_test_sk_****...9c2b", created: "20 Feb 2026", lastUsed: "1d ago", status: "active" },
];

const API_USAGE = [
  { day: "Mon", calls: 342 }, { day: "Tue", calls: 456 }, { day: "Wed", calls: 523 },
  { day: "Thu", calls: 478 }, { day: "Fri", calls: 612 }, { day: "Sat", calls: 134 }, { day: "Sun", calls: 89 },
];

const WEBHOOKS = [
  { url: "https://api.pmgtsolutions.com/hooks/ptx", events: ["agent.action", "approval.created", "phase.completed"], status: "active", successRate: "99.2%" },
  { url: "https://slack.pmgtsolutions.com/webhook", events: ["risk.escalated", "budget.threshold"], status: "active", successRate: "100%" },
];

const COMPLIANCE_BADGES = [
  { name: "GDPR", status: "Compliant", icon: "🇪🇺" },
  { name: "DPA 2018", status: "Compliant", icon: "🇬🇧" },
  { name: "SOC 2 Type II", status: "In Progress", icon: "🔒" },
  { name: "ISO 27001", status: "Planned", icon: "📜" },
  { name: "Cyber Essentials", status: "Certified", icon: "🛡️" },
];

const AUDIT_LOG = [
  { ts: "02 Apr 10:24", user: "Alpha (Agent)", action: "Generated document", target: "Risk Register v3", ip: "—", result: "success" },
  { ts: "02 Apr 10:15", user: "Sarah Chen", action: "Approved artefact", target: "Phase Gate Checklist", ip: "82.29.185.213", result: "success" },
  { ts: "02 Apr 09:45", user: "Bravo (Agent)", action: "Processed transcript", target: "Sprint Retro Meeting", ip: "—", result: "success" },
  { ts: "02 Apr 09:30", user: "Ty Beetseh", action: "Updated settings", target: "Security — 2FA enabled", ip: "82.29.185.213", result: "success" },
  { ts: "01 Apr 17:30", user: "James Okafor", action: "Created project", target: "Cloud Migration Q3", ip: "86.12.45.67", result: "success" },
  { ts: "01 Apr 16:00", user: "Charlie (Agent)", action: "Escalated risk", target: "Vendor delay — Riverside", ip: "—", result: "success" },
  { ts: "01 Apr 14:20", user: "Priya Sharma", action: "Login", target: "Web app", ip: "82.29.185.215", result: "success" },
  { ts: "01 Apr 13:00", user: "Unknown", action: "Login attempt", target: "API", ip: "45.33.21.8", result: "failed" },
  { ts: "01 Apr 11:00", user: "Mia Novak", action: "Deployed agent", target: "Echo — Brand Refresh", ip: "82.29.185.213", result: "success" },
  { ts: "31 Mar 16:45", user: "Ty Beetseh", action: "Regenerated API key", target: "Production Key", ip: "82.29.185.213", result: "success" },
];

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

export default function AdminSettingsPage() {
  const mode = "dark";
  const [tab, setTab] = useState<TabId>("org");
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Security state
  const [pwdLength, setPwdLength] = useState(12);
  const [pwdUpper, setPwdUpper] = useState(true);
  const [pwdNumber, setPwdNumber] = useState(true);
  const [pwdSpecial, setPwdSpecial] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState("8");
  const [require2fa, setRequire2fa] = useState(true);

  // Compliance state
  const [dataResidency, setDataResidency] = useState("uk");
  const [retentionMonths, setRetentionMonths] = useState("36");

  // Audit filters
  const [auditSearch, setAuditSearch] = useState("");
  const [auditTypeFilter, setAuditTypeFilter] = useState<string | null>(null);

  const { data: apiTeam } = useTeamMembers();
  const { data: apiAudit } = useAuditLog();
  const members = apiTeam || [];
  const auditLog = apiAudit || [];
  const filteredAudit = auditLog.filter((e: any) => {
    if (auditSearch && !e.action.toLowerCase().includes(auditSearch.toLowerCase()) && !e.user.toLowerCase().includes(auditSearch.toLowerCase()) && !e.target.toLowerCase().includes(auditSearch.toLowerCase())) return false;
    if (auditTypeFilter === "agents" && !e.user.includes("Agent")) return false;
    if (auditTypeFilter === "users" && e.user.includes("Agent")) return false;
    if (auditTypeFilter === "failed" && e.result !== "failed") return false;
    return true;
  });

  return (
    <div className="flex gap-6 max-w-[1400px]">
      {/* ═══ VERTICAL TABS ═══ */}
      <div className="w-[220px] flex-shrink-0 space-y-1">
        <h2 className="text-[18px] font-bold mb-4" style={{ color: "var(--foreground)" }}>Settings</h2>
        {TABS.map(t => (
          <button key={t.id} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-left transition-all"
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? `${"var(--primary)"}15` : "transparent",
              color: tab === t.id ? "var(--primary)" : "var(--muted-foreground)",
              fontWeight: tab === t.id ? 600 : 400,
            }}>
            <span className="text-[14px]">{t.icon}</span>
            <span className="text-[13px]">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="flex-1 min-w-0 space-y-5">

        {/* ─── TAB 1: ORGANISATION ─── */}
        {tab === "org" && (
          <>
            <TabHeader title="Organisation Profile" desc="Manage your workspace identity and preferences" />
            <Card>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Organisation Name" value="PMGT Solutions Ltd" />
                <Field label="Industry" value="Consulting / Professional Services" />
                <Field label="Company Size" value="11–50 employees" />
                <Field label="Website" value="https://pmgtsolutions.com" />
                <Field label="Timezone" value="Europe/London (GMT+1)" />
                <Field label="Billing Email" value="billing@pmgtsolutions.com" />
              </div>
              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Logo</p>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-[12px] flex items-center justify-center text-[24px] font-bold text-white"
                    style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>P</div>
                </div>
              </div>
              <Button variant="default" size="sm" className="mt-4" onClick={() => toast.info("Coming soon")}>Save Changes</Button>
            </Card>
          </>
        )}

        {/* ─── TAB 2: TEAM MANAGEMENT ─── */}
        {tab === "team" && (
          <>
            <div className="flex items-center justify-between">
              <TabHeader title="Team Management" desc={`${members.length} members · ${0} pending invitations`} />
              <Button variant="default" size="sm" onClick={() => setShowInviteModal(true)}>+ Invite Member</Button>
            </div>

            <Card>
              <table className="w-full text-[12px]" style={{ color: "var(--foreground)" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                    {["Member", "Role", "Status", "Last Active", "Projects", ""].map(h => (
                      <th key={h} className="text-left py-3 px-4 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.email} className="hover:opacity-80 transition-opacity" style={{ borderBottom: `1px solid ${"var(--border)"}11` }}>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
                          <div>
                            <p className="font-semibold">{m.name}</p>
                            <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={m.role === "Owner" ? "secondary" : m.role === "Admin" ? "outline" : m.role === "Manager" ? "secondary" : m.role === "Member" ? "default" : "outline"}>{m.role}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status}</Badge>
                      </td>
                      <td className="py-3 px-4" style={{ color: "var(--muted-foreground)" }}>{m.lastActive}</td>
                      <td className="py-3 px-4">{m.projects}</td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm" onClick={() => toast.info("Coming soon")}>Edit</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Pending invitations */}
            <Card>
              <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Pending Invitations</h3>
              <div className="space-y-2">
                {([] as any[]).map(inv => (
                  <div key={inv.email} className="flex items-center justify-between py-2 px-3 rounded-[8px]"
                    style={{ background: true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                    <div>
                      <p className="text-[12px] font-medium" style={{ color: "var(--foreground)" }}>{inv.email}</p>
                      <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Sent {inv.sentAt} · Expires in {inv.expiresIn}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{inv.role}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => toast.info("Coming soon")}>Resend</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Invite Modal */}
            {showInviteModal && (
              <Modal title="Invite Team Member" onClose={() => setShowInviteModal(false)}>
                <div className="space-y-3">
                  <FieldInput label="Email Address" placeholder="colleague@company.com" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--muted-foreground)" }}>Role</p>
                    <div className="flex gap-2">
                      {["Admin", "Manager", "Member", "Viewer"].map(r => (
                        <button key={r} className="px-3 py-1.5 rounded-[8px] text-[11px] font-semibold" style={{ background: `${"var(--border)"}22`, color: "var(--muted-foreground)", border: `1px solid ${"var(--border)"}33` }}>{r}</button>
                      ))}
                    </div>
                  </div>
                  <FieldInput label="Personal Message (optional)" placeholder="Welcome to the team!" />
                  <Button variant="default" size="sm" className="w-full" onClick={() => setShowInviteModal(false)}>Send Invitation</Button>
                </div>
              </Modal>
            )}
          </>
        )}

        {/* ─── TAB 3: ROLES & PERMISSIONS ─── */}
        {tab === "roles" && (
          <>
            <TabHeader title="Roles & Permissions" desc="Manage access levels across your organisation" />

            <div className="grid grid-cols-5 gap-3 mb-4">
              {ROLES.map(r => (
                <Card key={r.name}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full" style={{ background: r.color }} />
                    <span className="text-[13px] font-bold" style={{ color: "var(--foreground)" }}>{r.name}</span>
                  </div>
                  <p className="text-[10px] mb-1" style={{ color: "var(--muted-foreground)" }}>{r.desc}</p>
                  <p className="text-[11px] font-semibold" style={{ color: r.color }}>{r.count} member{r.count !== 1 ? "s" : ""}</p>
                </Card>
              ))}
            </div>

            <Card>
              <table className="w-full text-[11px]" style={{ color: "var(--foreground)" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                    <th className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase" style={{ color: "var(--muted-foreground)" }}>Permission</th>
                    {ROLES.map(r => <th key={r.name} className="text-center py-2.5 px-2 text-[10px] font-semibold uppercase" style={{ color: r.color }}>{r.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {([] as any[]).map(p => (
                    <tr key={p.feature} style={{ borderBottom: `1px solid ${"var(--border)"}08` }}>
                      <td className="py-2 px-4 font-medium">{p.feature}</td>
                      {ROLES.map(r => (
                        <td key={r.name} className="text-center py-2">
                          {(p as any)[r.name] ? <span style={{ color: "#10B981" }}>✓</span> : <span style={{ color: "var(--muted-foreground)" }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="p-3 rounded-[10px]" style={{ background: `${"var(--primary)"}06`, border: `1px solid ${"var(--primary)"}18` }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>Custom Roles</p>
                  <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Create custom permission sets tailored to your organisation</p>
                </div>
                <Badge variant="secondary">Enterprise</Badge>
              </div>
            </div>
          </>
        )}

        {/* ─── TAB 4: SECURITY ─── */}
        {tab === "security" && (
          <>
            <TabHeader title="Security" desc="Configure authentication, sessions, and access controls" />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Password policy */}
              <Card>
                <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Password Policy</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>Minimum length</span>
                      <span className="text-[13px] font-bold" style={{ color: "var(--primary)" }}>{pwdLength} characters</span>
                    </div>
                    <input type="range" min={8} max={24} value={pwdLength} onChange={e => setPwdLength(Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ background: `linear-gradient(to right, ${"var(--primary)"} ${((pwdLength - 8) / 16) * 100}%, ${"var(--border)"}44 ${((pwdLength - 8) / 16) * 100}%)` }} />
                  </div>
                  <ToggleRow label="Require uppercase letter" checked={pwdUpper} onChange={setPwdUpper} />
                  <ToggleRow label="Require number" checked={pwdNumber} onChange={setPwdNumber} />
                  <ToggleRow label="Require special character" checked={pwdSpecial} onChange={setPwdSpecial} />
                </div>
              </Card>

              {/* 2FA + Session */}
              <Card>
                <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Authentication</h3>
                <div className="space-y-3">
                  <ToggleRow label="Require 2FA for all members" checked={require2fa} onChange={setRequire2fa} />
                  {require2fa && (
                    <div className="p-2.5 rounded-[8px]" style={{ background: true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>2FA Adoption</span>
                        <span className="text-[11px] font-bold" style={{ color: "#10B981" }}>5/7 members</span>
                      </div>
                      <Progress value={71} className="h-1.5" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>Session timeout</span>
                      <select className="px-2 py-1 rounded-[6px] text-[11px]" value={sessionTimeout}
                        onChange={e => setSessionTimeout(e.target.value)}
                        style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
                        {["1", "4", "8", "24", "168"].map(h => <option key={h} value={h}>{h === "168" ? "7 days" : `${h} hours`}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* SSO */}
                <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>SSO Configuration</p>
                      <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>SAML 2.0 or OpenID Connect</p>
                    </div>
                    <Badge variant="secondary">Enterprise</Badge>
                  </div>
                </div>

                <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>IP Allowlisting</p>
                      <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Restrict access to approved IPs</p>
                    </div>
                    <Badge variant="secondary">Enterprise</Badge>
                  </div>
                </div>
              </Card>
            </div>

            {/* Active Sessions */}
            <Card>
              <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Active Sessions</h3>
              <div className="space-y-2">
                {([] as any[]).map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-[8px]"
                    style={{ background: s.current ? `${"var(--primary)"}06` : "transparent", border: `1px solid ${s.current ? "var(--primary)" + "22" : "var(--border)" + "11"}` }}>
                    <div className="flex items-center gap-3">
                      <span className="text-[16px]">{s.device.includes("Chrome") ? "🖥️" : s.device.includes("Safari") ? "💻" : "📱"}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[12px] font-medium" style={{ color: "var(--foreground)" }}>{s.device}</p>
                          {s.current && <Badge variant="default">Current</Badge>}
                        </div>
                        <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{s.ip} · {s.location} · {s.lastActive}</p>
                      </div>
                    </div>
                    {!s.current && <Button variant="ghost" size="sm" disabled title="Coming soon">Revoke</Button>}
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ─── TAB 5: INTEGRATIONS ─── */}
        {tab === "integrations" && (
          <>
            <TabHeader title="Integrations" desc="Connect your tools to supercharge your agents" />

            <h4 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "#10B981" }}>Connected</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
              {([] as any[]).map(int => (
                <Card key={int.name}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-[24px]">{int.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-bold" style={{ color: "var(--foreground)" }}>{int.name}</span>
                          <Badge variant="default">Connected</Badge>
                        </div>
                        <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{int.desc}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>Last sync: {int.lastSync}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" disabled title="Coming soon">Configure</Button>
                  </div>
                </Card>
              ))}
            </div>

            <h4 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--primary)" }}>Available</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              {([] as any[]).map(int => (
                <Card key={int.name}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[20px]">{int.icon}</span>
                    <span className="text-[13px] font-bold" style={{ color: "var(--foreground)" }}>{int.name}</span>
                  </div>
                  <p className="text-[11px] mb-3" style={{ color: "var(--muted-foreground)" }}>{int.desc}</p>
                  <Button variant="default" size="sm" className="w-full" disabled title="Coming soon">Connect</Button>
                </Card>
              ))}
            </div>

            <h4 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Coming Soon</h4>
            <div className="flex gap-3">
              {([] as any[]).map(int => (
                <div key={int.name} className="flex items-center gap-2 px-3 py-2 rounded-[8px]" style={{ background: `${"var(--border)"}11`, border: `1px solid ${"var(--border)"}22` }}>
                  <span className="text-[16px]">{int.icon}</span>
                  <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{int.name}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ─── TAB 6: API & WEBHOOKS ─── */}
        {tab === "api" && (
          <>
            <TabHeader title="API & Webhooks" desc="Manage API access and event subscriptions" />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* API Keys */}
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>API Keys</h3>
                </div>
                <div className="space-y-2">
                  {([] as any[]).map(k => (
                    <div key={k.name} className="p-3 rounded-[8px]" style={{ background: true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{k.name}</span>
                        <Badge variant="default">{k.status}</Badge>
                      </div>
                      <code className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>{k.key}</code>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                        <span>Created {k.created}</span><span>Last used {k.lastUsed}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 p-2 rounded-[6px] text-[10px]" style={{ background: `${"#F59E0B"}08`, color: "#F59E0B" }}>
                  Rate limit: 1,000 requests/min · 100,000/day
                </div>
              </Card>

              {/* API Usage */}
              <Card>
                <h3 className="text-[14px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>API Usage (7 Days)</h3>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[] as any[]}>
                      <CartesianGrid strokeDasharray="3 3" stroke={`${"var(--border)"}33`} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                      <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                      <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                      <Bar dataKey="calls" fill={"var(--primary)"} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-center mt-1" style={{ color: "var(--muted-foreground)" }}>Total: {([] as any[]).reduce((s, d) => s + d.calls, 0).toLocaleString()} calls this week</p>
              </Card>
            </div>

            {/* Webhooks */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Webhook Endpoints</h3>
              </div>
              <div className="space-y-2">
                {([] as any[]).map((wh, i) => (
                  <div key={i} className="p-3 rounded-[8px]" style={{ background: true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                    <div className="flex items-center justify-between mb-1">
                      <code className="text-[11px] font-mono" style={{ color: "var(--primary)" }}>{wh.url}</code>
                      <div className="flex items-center gap-2">
                        <Badge variant="default">{wh.status}</Badge>
                        <span className="text-[10px]" style={{ color: "#10B981" }}>{wh.successRate} success</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {wh.events.map(ev => (
                        <span key={ev} className="text-[9px] px-1.5 py-0.5 rounded-[4px] font-mono"
                          style={{ background: `${"var(--primary)"}12`, color: "var(--primary)" }}>{ev}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ─── TAB 7: DATA & COMPLIANCE ─── */}
        {tab === "compliance" && (
          <>
            <TabHeader title="Data & Compliance" desc="Data residency, retention, GDPR compliance, and governance" />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Residency + Retention */}
              <Card>
                <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Data Residency & Retention</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--muted-foreground)" }}>Data Residency</p>
                    <div className="flex gap-2">
                      {[{ id: "uk", label: "🇬🇧 United Kingdom" }, { id: "eu", label: "🇪🇺 EU (Frankfurt)" }, { id: "us", label: "🇺🇸 US (Virginia)" }].map(r => (
                        <button key={r.id} className="flex-1 py-2 rounded-[8px] text-[11px] font-semibold transition-all"
                          onClick={() => setDataResidency(r.id)}
                          style={{
                            background: dataResidency === r.id ? `${"var(--primary)"}15` : "transparent",
                            color: dataResidency === r.id ? "var(--primary)" : "var(--muted-foreground)",
                            border: `1px solid ${dataResidency === r.id ? "var(--primary)" + "44" : "var(--border)" + "33"}`,
                          }}>{r.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>Data retention period</span>
                      <select className="px-2 py-1 rounded-[6px] text-[11px]" value={retentionMonths}
                        onChange={e => setRetentionMonths(e.target.value)}
                        style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
                        {["12", "24", "36", "60", "84"].map(m => <option key={m} value={m}>{m} months</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Compliance badges */}
              <Card>
                <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Compliance Certifications</h3>
                <div className="space-y-2">
                  {([] as any[]).map(b => (
                    <div key={b.name} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[16px]">{b.icon}</span>
                        <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{b.name}</span>
                      </div>
                      <Badge variant={b.status === "Compliant" || b.status === "Certified" ? "default" : b.status === "In Progress" ? "secondary" : "outline"}>
                        {b.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}

        {/* ─── TAB 8: AUDIT LOG ─── */}
        {tab === "audit" && (
          <>
            <TabHeader title="Audit Log" desc="Complete activity history across your organisation" />

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <input className="px-3 py-1.5 rounded-[8px] text-[12px] w-[200px]" placeholder="Search actions..."
                value={auditSearch} onChange={e => setAuditSearch(e.target.value)}
                style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}`, outline: "none" }} />
              {["All", "Users", "Agents", "Failed"].map(f => {
                const fKey = f === "All" ? null : f.toLowerCase();
                return (
                  <button key={f} className="px-2.5 py-1.5 rounded-[6px] text-[11px] font-semibold transition-all"
                    onClick={() => setAuditTypeFilter(fKey)}
                    style={{
                      background: auditTypeFilter === fKey ? `${"var(--primary)"}22` : "transparent",
                      color: auditTypeFilter === fKey ? "var(--primary)" : "var(--muted-foreground)",
                      border: `1px solid ${auditTypeFilter === fKey ? "var(--primary)" + "44" : "transparent"}`,
                    }}>{f}</button>
                );
              })}
            </div>

            <Card>
              <table className="w-full text-[12px]" style={{ color: "var(--foreground)" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                    {["Timestamp", "User", "Action", "Target", "IP Address", "Result"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAudit.map((e, i) => (
                    <tr key={i} className="hover:opacity-80 transition-opacity" style={{ borderBottom: `1px solid ${"var(--border)"}08` }}>
                      <td className="py-2.5 px-4 font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{e.ts}</td>
                      <td className="py-2.5 px-4">
                        <span className="font-medium" style={{ color: e.user.includes("Agent") ? "var(--primary)" : "var(--foreground)" }}>{e.user}</span>
                      </td>
                      <td className="py-2.5 px-4">{e.action}</td>
                      <td className="py-2.5 px-4" style={{ color: "var(--muted-foreground)" }}>{e.target}</td>
                      <td className="py-2.5 px-4 font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{e.ip}</td>
                      <td className="py-2.5 px-4">
                        <Badge variant={e.result === "success" ? "default" : "destructive"}>{e.result}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function TabHeader({ title, desc}: { title: string; desc: string;  }) {
  return (
    <div className="mb-1">
      <h2 className="text-[20px] font-bold" style={{ color: "var(--foreground)" }}>{title}</h2>
      <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>{desc}</p>
    </div>
  );
}

function Field({ label, value}: { label: string; value: string;  }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      <p className="text-[13px] font-medium" style={{ color: "var(--foreground)" }}>{value}</p>
    </div>
  );
}

function FieldInput({ label, placeholder,  }: { label: string; placeholder: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      <input className="w-full px-3 py-2 rounded-[10px] text-[13px]" placeholder={placeholder}
        style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}`, outline: "none" }} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange}: { label: string; checked: boolean; onChange: (v: boolean) => void;  }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{label}</span>
      <button className="w-9 h-5 rounded-full relative transition-all flex-shrink-0" onClick={() => onChange(!checked)}
        style={{ background: checked ? "var(--primary)" : `${"var(--border)"}66` }}>
        <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: checked ? 18 : 2 }} />
      </button>
    </div>
  );
}

function Modal({ title, onClose, children,  }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} />
      <div className="relative w-full max-w-[440px] rounded-[16px] p-6" onClick={e => e.stopPropagation()}
        style={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, boxShadow: "0 24px 48px rgba(0,0,0,0.3)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold" style={{ color: "var(--foreground)" }}>{title}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[16px]"
            style={{ color: "var(--muted-foreground)", background: `${"var(--border)"}22` }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
