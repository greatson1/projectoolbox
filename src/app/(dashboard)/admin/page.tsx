"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamMembers, useAuditLog, useBilling } from "@/hooks/use-api";
import {
  Building2, Users, ShieldCheck, Link2, Key, FileText,
  Plus, Search, Download, UserPlus,
} from "lucide-react";

const TABS: { id: string; label: string; icon: React.ElementType }[] = [
  { id: "org", label: "Organisation", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "roles", label: "Roles", icon: ShieldCheck },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "integrations", label: "Integrations", icon: Link2 },
  { id: "api", label: "API Keys", icon: Key },
  { id: "data", label: "Data", icon: ShieldCheck },
  { id: "audit", label: "Audit Log", icon: FileText },
];

type TabId = "org" | "team" | "roles" | "security" | "integrations" | "api" | "data" | "audit";

const ROLES = [
  { name: "OWNER", color: "#8B5CF6", desc: "Full access. Billing, team, delete org." },
  { name: "ADMIN", color: "#6366F1", desc: "Manage team, settings, all projects." },
  { name: "MEMBER", color: "#10B981", desc: "Contribute to assigned projects." },
  { name: "VIEWER", color: "#64748B", desc: "Read-only access to dashboards." },
];

const PERMISSIONS = [
  { feature: "View dashboards", OWNER: true, ADMIN: true, MEMBER: true, VIEWER: true },
  { feature: "Manage projects", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { feature: "Deploy agents", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { feature: "Approve artefacts", OWNER: true, ADMIN: true, MEMBER: true, VIEWER: false },
  { feature: "Manage team", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { feature: "Billing & plans", OWNER: true, ADMIN: false, MEMBER: false, VIEWER: false },
  { feature: "Security settings", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { feature: "API keys", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { feature: "Audit log", OWNER: true, ADMIN: true, MEMBER: false, VIEWER: false },
  { feature: "Delete org", OWNER: true, ADMIN: false, MEMBER: false, VIEWER: false },
];

const INTEGRATIONS = [
  { name: "Slack", status: "available", icon: "💬" },
  { name: "Jira", status: "available", icon: "🔗" },
  { name: "GitHub", status: "available", icon: "🐙" },
  { name: "Google Calendar", status: "available", icon: "📅" },
  { name: "MS Teams", status: "coming_soon", icon: "📺" },
  { name: "Confluence", status: "coming_soon", icon: "📝" },
];

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function AdminSettingsPage() {
  const [tab, setTab] = useState<TabId>("org");
  const { data: members, isLoading: membersLoading } = useTeamMembers();
  const { data: auditLogs, isLoading: auditLoading } = useAuditLog();
  const { data: billing } = useBilling();
  const [pwdLength, setPwdLength] = useState(12);
  const [require2fa, setRequire2fa] = useState(true);
  const [auditSearch, setAuditSearch] = useState("");

  return (
    <div className="flex gap-6 max-w-[1400px]">
      {/* Vertical tabs */}
      <div className="w-[200px] flex-shrink-0 space-y-1">
        <h2 className="text-lg font-bold mb-4">Settings</h2>
        {TABS.map(t => (
          <button key={t.id} className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${tab === t.id ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/30"}`}
            onClick={() => setTab(t.id as TabId)}>
            <t.icon className="w-4 h-4" />
            <span className="text-sm">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Organisation */}
        {tab === "org" && (
          <>
            <div><h2 className="text-xl font-bold">Organisation Profile</h2><p className="text-sm text-muted-foreground">Manage your workspace identity</p></div>
            <Card>
              <CardContent className="pt-5 grid grid-cols-2 gap-4">
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Organisation</p><p className="text-sm font-semibold">PMGT Solutions</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Plan</p><p className="text-sm font-semibold">{billing?.plan || "—"}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Industry</p><p className="text-sm">Consulting</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Team Size</p><p className="text-sm">{members?.length || 0} members</p></div>
                <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Billing Email</p><p className="text-sm">{billing?.billingEmail || "—"}</p></div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Team */}
        {tab === "team" && (
          <>
            <div className="flex items-center justify-between">
              <div><h2 className="text-xl font-bold">Team Management</h2><p className="text-sm text-muted-foreground">{members?.length || 0} members</p></div>
              <Button size="sm"><UserPlus className="w-4 h-4 mr-1" /> Invite Member</Button>
            </div>
            {membersLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            ) : (
              <Card className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border">
                    {["Member", "Role", "Joined"].map(h => <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(members || []).map((m: any) => (
                      <tr key={m.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-white">
                              {(m.name || m.email || "?").slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold">{m.name || "—"}</p>
                              <p className="text-[10px] text-muted-foreground">{m.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-4"><Badge variant="outline">{m.role}</Badge></td>
                        <td className="py-2.5 px-4 text-muted-foreground">{new Date(m.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}

        {/* Roles */}
        {tab === "roles" && (
          <>
            <div><h2 className="text-xl font-bold">Roles & Permissions</h2><p className="text-sm text-muted-foreground">Access control for your organisation</p></div>
            <div className="grid grid-cols-4 gap-3">
              {ROLES.map(r => {
                const count = (members || []).filter((m: any) => m.role === r.name).length;
                return (
                  <Card key={r.name} className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full" style={{ background: r.color }} />
                      <span className="text-sm font-bold">{r.name}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-1">{r.desc}</p>
                    <p className="text-xs font-semibold" style={{ color: r.color }}>{count} member{count !== 1 ? "s" : ""}</p>
                  </Card>
                );
              })}
            </div>
            <Card className="p-0">
              <table className="w-full text-[11px]">
                <thead><tr className="border-b border-border">
                  <th className="text-left py-2 px-4 text-[10px] font-semibold uppercase text-muted-foreground">Permission</th>
                  {ROLES.map(r => <th key={r.name} className="text-center py-2 px-2 text-[10px] font-semibold uppercase" style={{ color: r.color }}>{r.name}</th>)}
                </tr></thead>
                <tbody>
                  {PERMISSIONS.map(p => (
                    <tr key={p.feature} className="border-b border-border/20">
                      <td className="py-2 px-4 font-medium">{p.feature}</td>
                      {ROLES.map(r => (
                        <td key={r.name} className="text-center py-2">
                          {(p as any)[r.name] ? <span className="text-green-500">✓</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}

        {/* Security */}
        {tab === "security" && (
          <>
            <div><h2 className="text-xl font-bold">Security</h2><p className="text-sm text-muted-foreground">Authentication and access controls</p></div>
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Password Policy</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Minimum length</span>
                      <span className="text-sm font-bold text-primary">{pwdLength}</span>
                    </div>
                    <input type="range" min={8} max={24} value={pwdLength} onChange={e => setPwdLength(Number(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-border accent-primary" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Authentication</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs">Require 2FA</span>
                    <button className={`w-9 h-5 rounded-full relative transition-all ${require2fa ? "bg-primary" : "bg-border"}`}
                      onClick={() => setRequire2fa(!require2fa)}>
                      <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: require2fa ? 18 : 2 }} />
                    </button>
                  </div>
                  {require2fa && (
                    <div className="p-2 rounded-lg bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-muted-foreground">2FA Adoption</span>
                        <span className="text-[11px] font-bold text-green-500">{members?.length || 0}/{members?.length || 0}</span>
                      </div>
                      <Progress value={100} className="h-1.5" />
                    </div>
                  )}
                  <div className="pt-3 border-t border-border/30">
                    <div className="flex items-center justify-between">
                      <div><p className="text-xs font-semibold">SSO</p><p className="text-[10px] text-muted-foreground">SAML / OIDC</p></div>
                      <Badge variant="secondary">Enterprise</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Integrations */}
        {tab === "integrations" && (
          <>
            <div><h2 className="text-xl font-bold">Integrations</h2><p className="text-sm text-muted-foreground">Connect your tools</p></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {INTEGRATIONS.map(int => (
                <Card key={int.name} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{int.icon}</span>
                      <div>
                        <p className="text-sm font-bold">{int.name}</p>
                        <Badge variant={int.status === "available" ? "outline" : "secondary"} className="text-[9px]">{int.status === "available" ? "Available" : "Coming Soon"}</Badge>
                      </div>
                    </div>
                    <Button variant={int.status === "available" ? "default" : "ghost"} size="sm" disabled={int.status !== "available"}>
                      {int.status === "available" ? "Connect" : "Soon"}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* API Keys */}
        {tab === "api" && (
          <>
            <div className="flex items-center justify-between">
              <div><h2 className="text-xl font-bold">API Keys</h2><p className="text-sm text-muted-foreground">Manage API access</p></div>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create Key</Button>
            </div>
            <Card>
              <CardContent className="pt-5 text-center py-12">
                <Key className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No API keys created. Create one to access the Projectoolbox API.</p>
              </CardContent>
            </Card>
          </>
        )}

        {/* Data */}
        {tab === "data" && (
          <>
            <div><h2 className="text-xl font-bold">Data & Compliance</h2><p className="text-sm text-muted-foreground">Data residency and compliance</p></div>
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="pt-5 space-y-3">
                  <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Data Residency</p><p className="text-sm font-semibold">EU (Ireland)</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Retention</p><p className="text-sm">36 months</p></div>
                  <Button variant="ghost" size="sm">📥 GDPR Data Export</Button>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 space-y-2">
                  {["GDPR", "SOC 2", "Cyber Essentials"].map(c => (
                    <div key={c} className="flex items-center justify-between py-1">
                      <span className="text-xs font-semibold">{c}</span>
                      <Badge variant="default" className="text-[9px]">Compliant</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Audit Log */}
        {tab === "audit" && (
          <>
            <div className="flex items-center justify-between">
              <div><h2 className="text-xl font-bold">Audit Log</h2><p className="text-sm text-muted-foreground">Activity history</p></div>
              <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" /> Export</Button>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border max-w-md">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input className="bg-transparent text-sm outline-none flex-1" placeholder="Search audit log..." value={auditSearch} onChange={e => setAuditSearch(e.target.value)} />
            </div>
            {auditLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
            ) : (auditLogs || []).length === 0 ? (
              <Card><CardContent className="pt-5 text-center py-12">
                <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No audit entries yet. Actions like logins, role changes, and agent deployments are logged here.</p>
              </CardContent></Card>
            ) : (
              <Card className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border">
                    {["Time", "User", "Action", "Target"].map(h => <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(auditLogs || []).filter((e: any) => !auditSearch || e.action?.includes(auditSearch) || e.target?.includes(auditSearch)).map((e: any) => (
                      <tr key={e.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="py-2.5 px-4 text-muted-foreground font-mono text-[10px]">{timeAgo(e.createdAt)}</td>
                        <td className="py-2.5 px-4">{e.userId || "System"}</td>
                        <td className="py-2.5 px-4">{e.action}</td>
                        <td className="py-2.5 px-4 text-muted-foreground">{e.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
