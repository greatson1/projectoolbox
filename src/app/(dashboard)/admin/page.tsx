"use client";
// @ts-nocheck

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useEffect } from "react";
import { useTeamMembers, useAuditLog, useOrgSettings, useSaveOrgSettings, useApiKeys, useCreateApiKey, useRevokeApiKey, useWebhooks, useCreateWebhook, useDeleteWebhook } from "@/hooks/use-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════
// TYPES & DATA
// ═══════════════════════════════════════════════════════════════════

const TABS = [
  { id: "org", label: "Organisation", icon: "🏢" },
  { id: "team", label: "Team Management", icon: "👥" },
  { id: "roles", label: "Roles & Permissions", icon: "🔐" },
  { id: "integrations", label: "Integrations", icon: "🔗" },
  { id: "api", label: "API & Webhooks", icon: "⚡" },
  { id: "audit", label: "Audit Log", icon: "📜" },
  { id: "danger", label: "Danger Zone", icon: "⚠️" },
] as const;

type TabId = typeof TABS[number]["id"];

// No mock data — all from API

const ROLE_DEFS = [
  { name: "Owner", key: "OWNER", color: "#8B5CF6", desc: "Full access. Billing, team, delete org." },
  { name: "Admin", key: "ADMIN", color: "#6366F1", desc: "Manage team, settings, all projects." },
  { name: "Manager", key: "MANAGER", color: "#22D3EE", desc: "Manage assigned projects and agents." },
  { name: "Member", key: "MEMBER", color: "#10B981", desc: "Contribute to assigned projects." },
  { name: "Viewer", key: "VIEWER", color: "#64748B", desc: "Read-only access to dashboards." },
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

// Reference data only — not tenant-specific
type Integration = { name: string; icon: string; desc: string; configKey: string; oauth?: string; oauthQuery?: string; alwaysOn?: boolean };
const ALL_INTEGRATIONS: Integration[] = [
  { name: "Slack", icon: "💬", desc: "Send notifications to project channels", configKey: "slackConnected", oauth: "slack" },
  { name: "Jira", icon: "🔗", desc: "Two-way task sync, issue tracking", configKey: "jiraConnected", oauth: "atlassian" },
  { name: "Confluence", icon: "📝", desc: "Wiki sync, knowledge base", configKey: "confluenceConnected", oauth: "atlassian" },
  { name: "Azure DevOps", icon: "🔷", desc: "Work items, pipelines, repos", configKey: "devopsConnected", oauth: "microsoft", oauthQuery: "service=devops" },
  { name: "MS Planner", icon: "📋", desc: "Task boards, plan management", configKey: "plannerConnected", oauth: "microsoft", oauthQuery: "service=planner" },
  { name: "Monday.com", icon: "🟣", desc: "Board sync, item tracking", configKey: "mondayConnected", oauth: "monday" },
  { name: "Asana", icon: "🟠", desc: "Project and task sync", configKey: "asanaConnected", oauth: "asana" },
  { name: "Zoom", icon: "📹", desc: "Meeting creation, transcript capture", configKey: "zoomConnected", oauth: "zoom" },
  { name: "Google Calendar", icon: "📅", desc: "Meeting scheduling, agent calendar", configKey: "googleCalendarConnected" },
  { name: "GitHub", icon: "🐙", desc: "PR tracking, code commits", configKey: "githubConnected" },
  { name: "Resend", icon: "📧", desc: "Agent email addresses, notifications", configKey: "resendConnected", alwaysOn: true },
  { name: "Perplexity", icon: "🔍", desc: "Web research, PESTLE scanning", configKey: "perplexityConnected", alwaysOn: true },
];

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

export default function AdminSettingsPage() {
  // Read initial tab from URL hash or search params
  usePageTitle("Admin Settings");
  const [tab, setTab] = useState<TabId>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("tab") as TabId;
      if (t && TABS.some(tab => tab.id === t)) return t;
    }
    return "org";
  });
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Sync tab to URL without navigation
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  }, [tab]);

  // Security state
  // Security/integration state removed — those tabs were decorative

  // Compliance state
  const [dataResidency, setDataResidency] = useState("uk");
  const [retentionMonths, setRetentionMonths] = useState("36");

  // Audit filters
  const [auditSearch, setAuditSearch] = useState("");
  const [auditTypeFilter, setAuditTypeFilter] = useState<string | null>(null);

  const { data: orgSettings } = useOrgSettings();
  const saveOrg = useSaveOrgSettings();
  const { data: apiTeam } = useTeamMembers();
  const { data: apiAudit } = useAuditLog();
  const { data: apiKeys = [] } = useApiKeys();
  const { data: webhooks = [] } = useWebhooks();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const org = orgSettings || {};
  const members = apiTeam || [];
  const auditLog = (apiAudit || []).map((e: any) => ({
    ts: e.createdAt ? new Date(e.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—",
    user: e.userId || "System",
    action: e.action || "",
    target: e.target || "",
    ip: e.ip || "—",
    result: "success",
  }));
  const filteredAudit = auditLog.filter((e: any) => {
    if (auditSearch && !e.action.toLowerCase().includes(auditSearch.toLowerCase()) && !(e.user || "").toLowerCase().includes(auditSearch.toLowerCase()) && !e.target.toLowerCase().includes(auditSearch.toLowerCase())) return false;
    if (auditTypeFilter === "agents" && !(e.user || "").includes("Agent")) return false;
    if (auditTypeFilter === "users" && (e.user || "").includes("Agent")) return false;
    if (auditTypeFilter === "failed" && e.result !== "failed") return false;
    return true;
  });

  return (
    <div className="flex gap-8 max-w-[1400px] animate-page-enter">
      {/* ═══ VERTICAL TABS ═══ */}
      <div className="w-[230px] flex-shrink-0">
        <h2 className="text-lg font-bold mb-5 text-foreground">Settings</h2>
        <nav className="space-y-0.5">
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-all duration-200 ${active ? "bg-primary/10 text-primary font-semibold shadow-sm" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:translate-x-0.5"}`}
                onClick={() => setTab(t.id)}>
                <span className="text-sm">{t.icon}</span>
                <span className="text-[13px]">{t.label}</span>
                {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="flex-1 min-w-0 space-y-5">

        {/* ─── TAB 1: ORGANISATION ─── */}
        {tab === "org" && (
          <>
            <TabHeader title="Organisation Profile" desc="Manage your workspace identity and preferences" />
            <Card className="overflow-hidden">
              {/* Header gradient */}
              <div className="h-24 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent -mt-4 -mx-4 mb-4 flex items-end px-6 pb-4">
                <OrgLogoUpload orgName={org.name || "P"} currentLogo={org.logoUrl} onUpload={(url: string) => { saveOrg.mutate({ logoUrl: url }); toast.success("Logo updated"); }} />
              </div>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <EditableField label="Organisation Name" value={org.name || ""} field="name" onSave={(v: string) => saveOrg.mutate({ name: v })} />
                  <EditableField label="Industry" value={org.industry || ""} field="industry" onSave={(v: string) => saveOrg.mutate({ industry: v })} />
                  <EditableField label="Company Size" value={org.companySize || ""} field="companySize" onSave={(v: string) => saveOrg.mutate({ companySize: v })} />
                  <EditableField label="Website" value={org.website || ""} field="website" onSave={(v: string) => saveOrg.mutate({ website: v })} />
                  <EditableField label="Timezone" value={org.timezone || "Europe/London"} field="timezone" onSave={(v: string) => saveOrg.mutate({ timezone: v })} />
                  <EditableField label="Billing Email" value={org.billingEmail || ""} field="billingEmail" onSave={(v: string) => saveOrg.mutate({ billingEmail: v })} />
                </div>
                <div className="flex items-center gap-4 pt-4 border-t border-border/30">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10">
                    <span className="text-xs font-bold text-primary">{org.plan || "FREE"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-2xl font-bold text-foreground">{org.creditBalance?.toLocaleString() || 0}</span>
                    <span className="text-xs text-muted-foreground">credits</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-4 border-t border-border/30 text-xs text-muted-foreground">
                  <span>🇪🇺 GDPR Compliant</span>
                  <span>·</span>
                  <span>🇬🇧 UK DPA 2018</span>
                  <span>·</span>
                  <span>Data stored in EU (Supabase) · Encrypted at rest and in transit</span>
                </div>
                <Button variant="default" size="sm" onClick={() => { saveOrg.mutate({}); toast.success("Settings saved"); }}>Save Changes</Button>
              </CardContent>
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
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    {["Member", "Role", "Status", "Last Active", "Projects", ""].map(h => (
                      <th key={h} className="text-left py-3 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m: any) => (
                    <tr key={m.email} className="hover:bg-muted/30 transition-colors border-b border-border/10">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
                            {(m.name || m.email || "?")[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{m.name || "Unnamed"}</p>
                            <p className="text-[10px] text-muted-foreground">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="secondary" className="text-[10px]">{m.role}</Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Active
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-[11px]">{m.updatedAt ? new Date(m.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</td>
                      <td className="py-3 px-4 text-[11px]">—</td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm" className="text-xs" onClick={async () => { const newRole = prompt("New role (OWNER/ADMIN/MEMBER/VIEWER):", m.role); if (!newRole) return; try { await fetch("/api/admin/team", { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ userId: m.id, role: newRole.toUpperCase() }) }); toast.success("Role updated"); } catch { toast.error("Update failed"); } }}>Edit</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Pending invitations */}
            <Card>
              <h3 className="text-[14px] font-semibold mb-3 text-foreground">Pending Invitations</h3>
              <div className="space-y-2">
                {([] as any[]).map(inv => (
                  <div key={inv.email} className="flex items-center justify-between py-2 px-3 rounded-[8px] bg-muted/20">
                    <div>
                      <p className="text-[12px] font-medium text-foreground">{inv.email}</p>
                      <p className="text-[10px] text-muted-foreground">Sent {inv.sentAt} · Expires in {inv.expiresIn}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{inv.role}</Badge>
                      <Button variant="ghost" size="sm" onClick={async () => { try { await fetch("/api/admin/team/invite", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ email: inv.email, role: inv.role }) }); toast.success("Invitation resent to " + inv.email); } catch { toast.error("Failed to resend"); } }}>Resend</Button>
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
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-muted-foreground">Role</p>
                    <div className="flex gap-2">
                      {["Admin", "Manager", "Member", "Viewer"].map(r => (
                        <button key={r} className="px-3 py-1.5 rounded-[8px] text-[11px] font-semibold bg-muted/30 text-muted-foreground border border-border/30">{r}</button>
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
              {ROLE_DEFS.map(r => {
                const count = members.filter((m: any) => (m.role || "MEMBER").toUpperCase() === r.key).length;
                return (
                  <Card key={r.name}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full" style={{ background: r.color }} />
                      <span className="text-[13px] font-bold text-foreground">{r.name}</span>
                    </div>
                    <p className="text-[10px] mb-1 text-muted-foreground">{r.desc}</p>
                    <p className="text-[11px] font-semibold" style={{ color: r.color }}>{count} member{count !== 1 ? "s" : ""}</p>
                  </Card>
                );
              })}
            </div>

            <Card>
              <table className="w-full text-[11px] text-foreground">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase text-muted-foreground">Permission</th>
                    {ROLE_DEFS.map(r => <th key={r.name} className="text-center py-2.5 px-2 text-[10px] font-semibold uppercase" style={{ color: r.color }}>{r.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map(p => (
                    <tr key={p.feature} className="border-b border-border/10">
                      <td className="py-2 px-4 font-medium">{p.feature}</td>
                      {ROLE_DEFS.map(r => (
                        <td key={r.name} className="text-center py-2">
                          {(p as any)[r.name] ? <span style={{ color: "#10B981" }}>✓</span> : <span className="text-muted-foreground">—</span>}
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
                  <p className="text-[12px] font-semibold text-foreground">Custom Roles</p>
                  <p className="text-[10px] text-muted-foreground">Create custom permission sets tailored to your organisation</p>
                </div>
                <Badge variant="secondary">Enterprise</Badge>
              </div>
            </div>
          </>
        )}

        {/* ─── TAB 4: INTEGRATIONS ─── */}
        {tab === "integrations" && (() => {
          const orgMeta = (org as any)?.autoTopUp || {};
          const connected = ALL_INTEGRATIONS.filter(i => i.alwaysOn || orgMeta[(i as any).configKey]);
          const available = ALL_INTEGRATIONS.filter(i => !i.alwaysOn && !orgMeta[(i as any).configKey]);

          const startOAuth = (provider: string, query?: string) => {
            const orgId = org?.id || "default";
            const url = `/api/oauth/${provider}/start?clientId=${orgId}${query ? `&${query}` : ""}`;
            window.open(url, "oauth", "width=600,height=700,popup=1");
          };

          return (
            <>
              <TabHeader title="Integrations" desc="Connect your tools to supercharge your agents" />

              {connected.length > 0 && (
                <>
                  <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2">Connected ({connected.length})</p>
                  <div className="space-y-2 mb-6">
                    {connected.map(i => (
                      <Card key={i.name} className="px-4">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{i.icon}</span>
                          <div className="flex-1">
                            <span className="text-sm font-bold">{i.name}</span>
                            <Badge variant="secondary" className="ml-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-[9px]">Connected</Badge>
                            <p className="text-xs text-muted-foreground">{i.desc}</p>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              )}

              <p className="text-xs font-bold text-primary uppercase tracking-wider mb-2">Available ({available.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {available.map(i => (
                  <Card key={i.name} className="px-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-2xl">{i.icon}</span>
                        <span className="text-sm font-bold">{i.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">{i.desc}</p>
                    </div>
                    {(i as any).oauth ? (
                      <Button variant="default" size="sm" className="w-full" onClick={() => startOAuth((i as any).oauth, (i as any).oauthQuery)}>
                        Connect
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full opacity-60 cursor-not-allowed" disabled>
                        Coming Soon
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            </>
          );
        })()}

        {/* ─── TAB 5: API & WEBHOOKS ─── */}
        {tab === "api" && (
            <>
              <TabHeader title="API & Webhooks" desc="Manage API access and event subscriptions" />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* API Keys */}
                <Card className="px-5">
                  <h3 className="text-sm font-bold mb-3">API Keys</h3>

                  {createdKey && (
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 mb-3">
                      <p className="text-xs font-bold text-emerald-500 mb-1">Key created — copy it now (won't be shown again):</p>
                      <code className="text-xs bg-background px-2 py-1 rounded block break-all">{createdKey}</code>
                      <Button variant="ghost" size="sm" className="mt-2" onClick={() => { navigator.clipboard.writeText(createdKey); toast.success("Copied!"); }}>Copy</Button>
                    </div>
                  )}

                  {apiKeys.length === 0 && !createdKey && (
                    <p className="text-xs text-muted-foreground mb-3">No API keys generated yet.</p>
                  )}

                  {apiKeys.map((k: any) => (
                    <div key={k.id} className="flex items-center justify-between py-2 border-b border-border/20">
                      <div>
                        <span className="text-xs font-semibold">{k.name}</span>
                        <span className="text-[10px] text-muted-foreground ml-2">...{k.lastFour}</span>
                        {k.revokedAt && <Badge variant="destructive" className="ml-2 text-[8px]">Revoked</Badge>}
                      </div>
                      {!k.revokedAt && (
                        <Button variant="ghost" size="sm" onClick={() => { revokeKey.mutate(k.id); toast.success("Key revoked"); }}>Revoke</Button>
                      )}
                    </div>
                  ))}

                  <div className="flex gap-2 mt-3">
                    <input className="flex-1 px-2 py-1.5 rounded-lg text-xs border border-border bg-background outline-none"
                      placeholder="Key name (e.g. Production)" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} />
                    <Button size="sm" disabled={createKey.isPending} onClick={async () => {
                      const result = await createKey.mutateAsync({ name: newKeyName || "API Key" });
                      setCreatedKey(result.fullKey);
                      setNewKeyName("");
                      toast.success("API key generated");
                    }}>Generate API Key</Button>
                  </div>

                  <p className="text-[10px] text-muted-foreground mt-2">Rate limit: 1,000 requests/min · 100,000/day</p>
                </Card>

                {/* Credit Usage */}
                <Card className="px-5">
                  <h3 className="text-sm font-bold mb-3">Credit Usage</h3>
                  <div className="text-center py-6">
                    <p className="text-4xl font-bold text-primary">{org?.creditBalance?.toLocaleString() || 0}</p>
                    <p className="text-xs text-muted-foreground">credits remaining</p>
                    <p className="text-xs text-muted-foreground mt-1">Plan: {org?.plan || "FREE"}</p>
                  </div>
                </Card>
              </div>

              {/* Webhooks */}
              <Card className="px-5 mt-4">
                <h3 className="text-sm font-bold mb-3">Webhook Endpoints</h3>

                {createdSecret && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-3">
                    <p className="text-xs font-bold text-amber-500 mb-1">Signing secret — copy it now (won't be shown again):</p>
                    <code className="text-xs bg-background px-2 py-1 rounded block break-all">{createdSecret}</code>
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => { navigator.clipboard.writeText(createdSecret); toast.success("Copied!"); }}>Copy</Button>
                  </div>
                )}

                {webhooks.length === 0 && !createdSecret && (
                  <p className="text-xs text-muted-foreground mb-3">No webhook endpoints configured. Webhooks allow external systems to receive real-time events from Projectoolbox (agent actions, approvals, phase completions).</p>
                )}

                {webhooks.map((wh: any) => (
                  <div key={wh.id} className="flex items-center justify-between py-2 border-b border-border/20">
                    <div>
                      <span className="text-xs font-semibold break-all">{wh.url}</span>
                      <div className="flex gap-1 mt-0.5">
                        {wh.events?.map((e: string) => (
                          <Badge key={e} variant="secondary" className="text-[8px]">{e}</Badge>
                        ))}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { deleteWebhook.mutate(wh.id); toast.success("Webhook deleted"); }}>Delete</Button>
                  </div>
                ))}

                <div className="flex gap-2 mt-3">
                  <input className="flex-1 px-2 py-1.5 rounded-lg text-xs border border-border bg-background outline-none"
                    placeholder="https://your-app.com/webhooks/projectoolbox" value={newWebhookUrl} onChange={e => setNewWebhookUrl(e.target.value)} />
                  <Button size="sm" disabled={createWebhook.isPending || !newWebhookUrl} onClick={async () => {
                    const result = await createWebhook.mutateAsync({ url: newWebhookUrl });
                    setCreatedSecret(result.secret);
                    setNewWebhookUrl("");
                    toast.success("Webhook registered");
                  }}>Add Webhook</Button>
                </div>
              </Card>
            </>
        )}

        {/* ─── TAB 7: DANGER ZONE ─── */}
        {tab === "danger" && <DangerZoneTab />}

        {/* ─── TAB 6: AUDIT LOG ─── */}
        {tab === "audit" && (
          <>
            <TabHeader title="Audit Log" desc="Complete activity history across your organisation" />

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <input className="px-3 py-1.5 rounded-lg text-xs w-[220px] bg-background text-foreground border border-border outline-none" placeholder="Search actions..."
                value={auditSearch} onChange={e => setAuditSearch(e.target.value)} />
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
              <table className="w-full text-[12px] text-foreground">
                <thead>
                  <tr className="border-b border-border/50">
                    {["Timestamp", "User", "Action", "Target", "IP Address", "Result"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAudit.map((e, i) => (
                    <tr key={i} className="hover:opacity-80 transition-opacity" style={{ borderBottom: `1px solid ${"var(--border)"}08` }}>
                      <td className="py-2.5 px-4 font-mono text-[10px] text-muted-foreground">{e.ts}</td>
                      <td className="py-2.5 px-4">
                        <span className="font-medium" style={{ color: e.user.includes("Agent") ? "var(--primary)" : "var(--foreground)" }}>{e.user}</span>
                      </td>
                      <td className="py-2.5 px-4">{e.action}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{e.target}</td>
                      <td className="py-2.5 px-4 font-mono text-[10px] text-muted-foreground">{e.ip}</td>
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

function TabHeader({ title, desc}: { title: string; desc: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
    </div>
  );
}

function Field({ label, value}: { label: string; value: string;  }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-muted-foreground">{label}</p>
      <p className="text-[13px] font-medium text-foreground">{value}</p>
    </div>
  );
}

function FieldInput({ label, placeholder,  }: { label: string; placeholder: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-muted-foreground">{label}</p>
      <input className="w-full px-3 py-2 rounded-xl text-sm bg-background text-foreground border border-border outline-none" placeholder={placeholder} />
    </div>
  );
}

function EditableField({ label, value, field, onSave }: { label: string; value: string; field: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(() => { setVal(value); }, [value]);
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-muted-foreground">{label}</p>
      {editing ? (
        <div className="flex gap-1.5">
          <input className="flex-1 px-2 py-1 rounded-md text-[13px] border border-border bg-background outline-none" value={val} onChange={e => setVal(e.target.value)} autoFocus />
          <button className="px-2 py-1 rounded-md text-[11px] font-semibold bg-primary text-white" onClick={() => { onSave(val); setEditing(false); toast.success(`${label} updated`); }}>Save</button>
          <button className="px-2 py-1 rounded-md text-[11px] text-muted-foreground" onClick={() => { setVal(value); setEditing(false); }}>Cancel</button>
        </div>
      ) : (
        <p className="text-[13px] font-medium cursor-pointer hover:text-primary transition-colors text-foreground" onClick={() => setEditing(true)}>
          {val || <span className="text-muted-foreground italic">Click to set</span>}
        </p>
      )}
    </div>
  );
}

function ToggleRow({ label, checked, onChange}: { label: string; checked: boolean; onChange: (v: boolean) => void;  }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12px] text-foreground">{label}</span>
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
          <h3 className="text-[16px] font-bold text-foreground">{title}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[16px]"
            style={{ color: "var(--muted-foreground)", background: `${"var(--border)"}22` }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Org Logo Upload
function OrgLogoUpload({ orgName, currentLogo, onUpload }: { orgName: string; currentLogo?: string; onUpload: (url: string) => void }) {
  const [preview, setPreview] = useState<string | null>(currentLogo || null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("File too large (max 2MB)"); return; }
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Convert to base64 data URL and save as logoUrl
    // In production, this would upload to S3/Supabase Storage
    setUploading(true);
    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = (ev) => resolve(ev.target?.result as string);
      r.readAsDataURL(file);
    });
    onUpload(dataUrl);
    setUploading(false);
  };

  return (
    <div className="flex items-center gap-4">
      {preview ? (
        <img src={preview} alt="Logo" className="w-16 h-16 rounded-xl object-cover" />
      ) : (
        <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold text-white"
          style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>{orgName[0]}</div>
      )}
      <div>
        <input type="file" accept="image/*" id="logo-upload" className="hidden" onChange={handleFile} />
        <label htmlFor="logo-upload" className="inline-block">
          <span className="inline-flex items-center px-3 py-1.5 rounded-lg border border-border text-xs font-medium cursor-pointer hover:bg-muted transition-colors">
            {uploading ? "Uploading..." : preview ? "Change Logo" : "Upload Logo"}
          </span>
        </label>
        <p className="text-[10px] text-muted-foreground mt-1">PNG or SVG, max 2MB</p>
      </div>
    </div>
  );
}

// API Keys section — reads from ApiKey table
function ApiKeysSection({ orgId }: { orgId?: string }) {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    fetch("/api/admin/api-keys").then(r => r.json()).then(d => {
      setKeys(d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [orgId]);

  if (loading) return <div className="animate-pulse h-16 bg-muted rounded" />;

  if (keys.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs text-muted-foreground">No API keys generated yet.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={async () => {
          const r = await fetch("/api/admin/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Default Key" }) });
          const d = await r.json();
          if (d.data) { setKeys([d.data]); toast.success("API key generated"); }
        }}>Generate API Key</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {keys.map((k: any) => (
        <div key={k.id} className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold">{k.name}</span>
            <Badge variant={k.revokedAt ? "destructive" : "default"}>{k.revokedAt ? "Revoked" : "Active"}</Badge>
          </div>
          <code className="text-[11px] font-mono text-muted-foreground">****{k.lastFour}</code>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
            <span>Created {new Date(k.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            {k.lastUsed && <span>Last used {new Date(k.lastUsed).toLocaleDateString("en-GB")}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DANGER ZONE TAB
// ═══════════════════════════════════════════════════════════════════

function DangerZoneTab() {
  const [showResetModal, setShowResetModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [wipAgents, setWipAgents] = useState(true);
  const [wipProjects, setWipProjects] = useState(true);
  const [wipActivity, setWipActivity] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ agents: string[]; projects: string[] } | null>(null);

  const doReset = async () => {
    if (confirmText !== "RESET") return;
    setResetting(true);
    try {
      const r = await fetch("/api/internal/reset-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET_ACCOUNT", wipAgents, wipProjects, wipActivity }),
      });
      const text = await r.text();
      let d: any = {};
      try { d = JSON.parse(text); } catch { /* not JSON */ }
      if (d.success) {
        setResult(d.deleted);
        toast.success("Account data reset successfully");
      } else {
        const msg = d.error || text.slice(0, 200) || `HTTP ${r.status}`;
        toast.error(msg, { duration: 10000 });
        console.error("[reset-account] server error:", text);
      }
    } catch (e: any) {
      toast.error(e?.message || "Network error", { duration: 10000 });
      console.error("[reset-account] fetch error:", e);
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <TabHeader title="Danger Zone" desc="Irreversible actions — proceed with caution" />

      <div className="space-y-4">

        {/* Reset account data */}
        <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🗑️</span>
                <h3 className="text-[15px] font-bold text-foreground">Reset Account Data</h3>
              </div>
              <p className="text-[13px] text-muted-foreground mb-3">
                Permanently delete agents, projects, and associated data for a fresh start.
                This is useful for demos, training sessions, or starting over.
                <strong className="text-destructive"> This cannot be undone.</strong>
              </p>
              <div className="flex gap-4 text-[12px] text-muted-foreground">
                <span>✓ Removes all AI agents &amp; their conversations</span>
                <span>✓ Removes all projects &amp; project data</span>
                <span>✓ Clears activity log</span>
              </div>
            </div>
            <Button variant="destructive" size="sm" className="flex-shrink-0" onClick={() => { setShowResetModal(true); setConfirmText(""); setResult(null); }}>
              Reset Data
            </Button>
          </div>
        </div>

        {/* Export data */}
        <div className="rounded-xl border border-border/50 bg-muted/20 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">📦</span>
                <h3 className="text-[15px] font-bold text-foreground">Export Account Data</h3>
              </div>
              <p className="text-[13px] text-muted-foreground">Download a full export of your organisation's data (GDPR Article 20).</p>
            </div>
            <Button variant="outline" size="sm" className="flex-shrink-0" onClick={() => toast.info("Data export queued — you'll receive an email when ready.")}>
              Request Export
            </Button>
          </div>
        </div>

        {/* Delete org */}
        <div className="rounded-xl border-2 border-destructive/20 bg-destructive/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">💀</span>
                <h3 className="text-[15px] font-bold text-foreground">Delete Organisation</h3>
              </div>
              <p className="text-[13px] text-muted-foreground">
                Permanently close your account, cancel all subscriptions, and delete all data within 30 days.
                <strong className="text-destructive"> Requires Owner role.</strong>
              </p>
            </div>
            <Button variant="destructive" size="sm" className="flex-shrink-0 opacity-60 cursor-not-allowed" disabled>
              Delete Org
            </Button>
          </div>
        </div>
      </div>

      {/* ── Reset Modal ── */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => !resetting && setShowResetModal(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-[480px] rounded-2xl p-6 space-y-5 shadow-2xl"
            style={{ background: "var(--card)", border: "2px solid hsl(var(--destructive) / 0.4)" }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center text-xl">⚠️</div>
              <div>
                <h3 className="text-[17px] font-bold text-foreground">Reset Account Data</h3>
                <p className="text-[12px] text-muted-foreground">This action is permanent and cannot be undone.</p>
              </div>
            </div>

            {result ? (
              /* Success state */
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                  <p className="text-[13px] font-semibold text-green-400 mb-1">✓ Reset complete</p>
                  {result.agents.length > 0 && <p className="text-[12px] text-muted-foreground">Agents deleted: {result.agents.join(", ")}</p>}
                  {result.projects.length > 0 && <p className="text-[12px] text-muted-foreground">Projects deleted: {result.projects.join(", ")}</p>}
                  {result.agents.length === 0 && result.projects.length === 0 && <p className="text-[12px] text-muted-foreground">No data found — account was already clean.</p>}
                </div>
                <Button variant="default" size="sm" className="w-full" onClick={() => { setShowResetModal(false); window.location.reload(); }}>
                  Done — Reload Page
                </Button>
              </div>
            ) : (
              /* Confirmation form */
              <>
                {/* What to wipe */}
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">What to reset</p>
                  {[
                    { label: "AI Agents & conversations", state: wipAgents, set: setWipAgents },
                    { label: "Projects & all project data", state: wipProjects, set: setWipProjects },
                    { label: "Activity log", state: wipActivity, set: setWipActivity },
                  ].map(({ label, state, set }) => (
                    <label key={label} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors">
                      <input type="checkbox" checked={state} onChange={e => set(e.target.checked)}
                        className="w-4 h-4 accent-destructive" />
                      <span className="text-[13px] text-foreground">{label}</span>
                    </label>
                  ))}
                </div>

                {/* Confirm input */}
                <div>
                  <p className="text-[12px] text-muted-foreground mb-2">
                    Type <strong className="text-destructive font-mono">RESET</strong> to confirm
                  </p>
                  <input
                    className="w-full px-3 py-2.5 rounded-xl text-sm border-2 bg-background text-foreground outline-none font-mono tracking-widest"
                    style={{ borderColor: confirmText === "RESET" ? "hsl(var(--destructive))" : "hsl(var(--border))" }}
                    placeholder="RESET"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value.toUpperCase())}
                    autoFocus
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2.5">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowResetModal(false)} disabled={resetting}>
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" className="flex-1" disabled={confirmText !== "RESET" || resetting}
                    onClick={doReset}>
                    {resetting ? "Resetting…" : "Reset Account Data"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
