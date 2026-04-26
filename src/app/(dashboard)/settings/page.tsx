"use client";
// @ts-nocheck

export const dynamic = "force-dynamic";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { User, Bell, Shield, Palette, Building2, Key, Moon, Sun, Check, Plug, Activity, AlertTriangle, CheckCircle2, MinusCircle, RefreshCw, Loader2 } from "lucide-react";
import Link from "next/link";
import { useAppStore, type AccentTheme } from "@/stores/app";
import { useOrgCurrency, useUpdateOrgCurrency } from "@/hooks/use-currency";
import { SUPPORTED_CURRENCIES, CURRENCY_NAME, CURRENCY_SYMBOL, CurrencyCode } from "@/lib/currency";
import { toast } from "sonner";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "organisation", label: "Organisation", icon: Building2 },
  { id: "api", label: "API Keys", icon: Key },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "health", label: "Health", icon: Activity },
];

const ACCENT_THEMES: { id: AccentTheme; label: string; color: string; desc: string }[] = [
  { id: "indigo", label: "Indigo", color: "#6366F1", desc: "Default" },
  { id: "midnight", label: "Midnight Blue", color: "#2563EB", desc: "Corporate" },
  { id: "emerald", label: "Emerald", color: "#059669", desc: "Growth" },
];

type IntegrationStatus = { connected: boolean; authUrl: string | null } | null;

export default function SettingsPage() {
  usePageTitle("Settings");
  const sessionResult = useSession();
  const [active, setActive] = useState("profile");
  const { theme, setTheme } = useTheme();
  const { accentTheme, setAccentTheme } = useAppStore();
  const user = (sessionResult as any)?.data?.user ?? {};

  const [zoomStatus, setZoomStatus] = useState<IntegrationStatus>(null);
  const [gcalStatus, setGcalStatus] = useState<IntegrationStatus>(null);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);

  const fetchIntegrationStatuses = useCallback(async () => {
    setLoadingIntegrations(true);
    try {
      const [zoomRes, gcalRes] = await Promise.all([
        fetch("/api/integrations/zoom"),
        fetch("/api/integrations/google-calendar/status"),
      ]);
      if (zoomRes.ok) {
        const json = await zoomRes.json();
        setZoomStatus(json?.data ?? null);
      }
      if (gcalRes.ok) {
        const json = await gcalRes.json();
        setGcalStatus(json?.data ?? null);
      }
    } finally {
      setLoadingIntegrations(false);
    }
  }, []);

  useEffect(() => {
    if (active === "integrations") {
      fetchIntegrationStatuses();
    }
  }, [active, fetchIntegrationStatuses]);

  return (
    <div className="max-w-[1100px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account, notifications, and workspace preferences.</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <nav className="w-48 shrink-0 space-y-1">
          {SECTIONS.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left"
                style={{
                  background: active === s.id ? "var(--primary)" : "transparent",
                  color: active === s.id ? "#fff" : "var(--muted-foreground)",
                }}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 space-y-4">

          {active === "profile" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 pb-4 border-b border-border">
                  <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-2xl font-bold text-white">
                    {user?.name?.[0] ?? "U"}
                  </div>
                  <div>
                    <p className="font-semibold">{user?.name ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">{user?.email ?? "—"}</p>
                    <Badge variant="outline" className="text-xs mt-1">Professional Plan</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Full Name</Label>
                    <Input defaultValue={user?.name ?? ""} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input defaultValue={user?.email ?? ""} className="mt-1" disabled />
                  </div>
                </div>
                <Button size="sm">Save Changes</Button>
              </CardContent>
            </Card>
          )}

          {active === "notifications" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Agent risk alerts", desc: "Get notified when your agent flags a high-severity risk" },
                  { label: "Approval requests", desc: "Notify me when an agent action requires my approval" },
                  { label: "Weekly digest", desc: "Receive a weekly summary of project progress" },
                  { label: "Credit warnings", desc: "Alert me when credits fall below 20%" },
                  { label: "Phase gate completions", desc: "Notify me when a project phase is completed" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <input type="checkbox" defaultChecked className="w-4 h-4 accent-primary" />
                  </div>
                ))}
                <Link href="/notifications"><Button variant="outline" size="sm">View All Notifications</Button></Link>
              </CardContent>
            </Card>
          )}

          {active === "security" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Security</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <p className="text-sm font-medium">Password</p>
                    <p className="text-xs text-muted-foreground">Last changed: never (Google SSO account)</p>
                  </div>
                  <Button variant="outline" size="sm" disabled>Change Password</Button>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <p className="text-sm font-medium">Two-Factor Authentication</p>
                    <p className="text-xs text-muted-foreground">Add an extra layer of security to your account</p>
                  </div>
                  <Button variant="outline" size="sm">Enable 2FA</Button>
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">Active Sessions</p>
                    <p className="text-xs text-muted-foreground">Manage where you're logged in</p>
                  </div>
                  <Button variant="outline" size="sm">View Sessions</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {active === "appearance" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Appearance</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {/* Dark / Light */}
                <div>
                  <Label className="text-xs mb-2 block">Mode</Label>
                  <div className="flex gap-3">
                    {(["dark", "light"] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors"
                        style={{
                          borderColor: theme === t ? "var(--primary)" : "var(--border)",
                          color: theme === t ? "var(--primary)" : "var(--muted-foreground)",
                          background: theme === t ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "transparent",
                        }}
                      >
                        {t === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Accent colour */}
                <div>
                  <Label className="text-xs mb-3 block">Accent Colour</Label>
                  <div className="flex gap-3 flex-wrap">
                    {ACCENT_THEMES.map(t => {
                      const isActive = accentTheme === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setAccentTheme(t.id)}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all"
                          style={{
                            borderColor: isActive ? t.color : "var(--border)",
                            background: isActive ? `${t.color}15` : "transparent",
                          }}
                        >
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: t.color }}
                          >
                            {isActive && <Check className="w-3 h-3 text-white" />}
                          </span>
                          <span>
                            <span className="block text-sm font-semibold" style={{ color: isActive ? t.color : "var(--foreground)" }}>{t.label}</span>
                            <span className="block text-[10px] text-muted-foreground">{t.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">Changes apply instantly across the entire app.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {active === "organisation" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Organisation</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Organisation Name</Label>
                  <Input defaultValue="PMGT Solutions" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Billing Email</Label>
                  <Input defaultValue={user?.email ?? ""} className="mt-1" />
                </div>
                <CurrencyPicker />
                <Button size="sm">Save Changes</Button>
              </CardContent>
            </Card>
          )}

          {active === "api" && (
            <Card>
              <CardHeader><CardTitle className="text-base">API Keys</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Use API keys to connect Projectoolbox to your own tools and workflows.
                  Keys are scoped to your workspace and inherit your plan limits.
                </p>
                <div className="rounded-lg border border-border p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">No API keys yet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Generate a key to start using the Projectoolbox API</p>
                  </div>
                  <Button size="sm">Generate Key</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  API documentation is available at{" "}
                  <Link href="/docs" className="text-primary hover:underline">/docs</Link>.
                </p>
              </CardContent>
            </Card>
          )}

          {active === "health" && <IntegrationHealthPanel />}

          {active === "integrations" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Integrations</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Connect third-party services to your workspace. Your agent will use these connections to join meetings, transcribe conversations, and update your project plan automatically.
                </p>

                {/* Zoom */}
                <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔵</span>
                    <div>
                      <p className="text-sm font-semibold">Zoom</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Let your agent join Zoom meetings, transcribe conversations, and extract action items.
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {loadingIntegrations ? (
                      <span className="text-xs text-muted-foreground">Checking…</span>
                    ) : zoomStatus?.connected ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-500/10 px-3 py-1.5 rounded-full">
                        <Check className="w-3.5 h-3.5" />
                        Connected
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          if (zoomStatus?.authUrl) {
                            window.location.href = zoomStatus.authUrl;
                          }
                        }}
                        disabled={!zoomStatus?.authUrl}
                      >
                        Connect Zoom
                      </Button>
                    )}
                  </div>
                </div>

                {/* Google Calendar */}
                <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🟢</span>
                    <div>
                      <p className="text-sm font-semibold">Google Calendar</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Allow your agent to create Google Meet links and sync project milestones with your calendar.
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {loadingIntegrations ? (
                      <span className="text-xs text-muted-foreground">Checking…</span>
                    ) : gcalStatus?.connected ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-500/10 px-3 py-1.5 rounded-full">
                        <Check className="w-3.5 h-3.5" />
                        Connected
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          window.location.href = "/api/integrations/google-calendar/connect";
                        }}
                      >
                        Connect Google Calendar
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}

function CurrencyPicker() {
  const current = useOrgCurrency();
  const update = useUpdateOrgCurrency();
  return (
    <div>
      <Label className="text-xs">Display Currency</Label>
      <p className="text-[11px] text-muted-foreground mb-2">
        Controls how budgets, costs, and billing amounts are shown across the app and which currency Stripe charges.
      </p>
      <div className="flex gap-2 flex-wrap">
        {SUPPORTED_CURRENCIES.map((c) => (
          <button
            key={c}
            onClick={() => {
              update.mutate(c as CurrencyCode, {
                onSuccess: () => toast.success(`Currency changed to ${CURRENCY_NAME[c]}`),
                onError: () => toast.error("Could not update currency"),
              });
            }}
            className={`px-3 py-2 rounded-lg border text-sm transition-all ${current === c ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-muted/40"}`}
            disabled={update.isPending}
          >
            <span className="mr-1.5 font-bold">{CURRENCY_SYMBOL[c]}</span>
            {CURRENCY_NAME[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

function IntegrationHealthPanel() {
  const [services, setServices] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingedAt, setPingedAt] = useState<string | null>(null);

  const fetchHealth = useCallback(async (ping: boolean) => {
    if (ping) setPinging(true); else setLoading(true);
    try {
      const r = await fetch(`/api/admin/integration-health${ping ? "?ping=true" : ""}`);
      const d = await r.json();
      setServices(d.data?.services || []);
      setPingedAt(d.data?.pingedAt || null);
    } catch (e: any) {
      toast.error(e?.message || "Health check failed");
    } finally {
      if (ping) setPinging(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(false); }, [fetchHealth]);

  const groups: Record<string, string> = {
    ai: "AI providers",
    research: "Research",
    meetings: "Meetings & calendar",
    payments: "Payments",
    comms: "Communications",
    storage: "Storage",
  };

  const grouped: Record<string, any[]> = {};
  (services || []).forEach((s: any) => {
    if (!grouped[s.group]) grouped[s.group] = [];
    grouped[s.group].push(s);
  });

  const summary = (services || []).reduce(
    (acc: any, s: any) => {
      if (!s.configured && s.required) acc.broken++;
      else if (!s.configured) acc.missing++;
      else if (s.reachable === "fail") acc.broken++;
      else if (s.reachable === "ok") acc.healthy++;
      else acc.healthy++;
      return acc;
    },
    { healthy: 0, missing: 0, broken: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Integration health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Status of every external service the platform relies on. Configured = env keys are present. Reachable = a live API call succeeded.
          </p>
          <Button size="sm" variant="outline" onClick={() => fetchHealth(true)} disabled={pinging || loading}>
            {pinging ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Run live checks
          </Button>
        </div>

        {/* Summary chips */}
        {services && (
          <div className="flex gap-2 text-[11px]">
            <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">{summary.healthy} healthy</span>
            <span className="px-2 py-1 rounded bg-muted text-muted-foreground font-semibold">{summary.missing} not configured</span>
            <span className="px-2 py-1 rounded bg-destructive/10 text-destructive font-semibold">{summary.broken} broken</span>
            {pingedAt && <span className="ml-auto text-muted-foreground">Last live check: {new Date(pingedAt).toLocaleTimeString("en-GB")}</span>}
          </div>
        )}

        {loading && !services && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
          </div>
        )}

        {/* Service rows grouped */}
        {services && Object.entries(groups).map(([key, label]) => {
          const items = grouped[key] || [];
          if (items.length === 0) return null;
          return (
            <div key={key}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
              <div className="space-y-1.5">
                {items.map((s: any) => {
                  let icon = <MinusCircle className="w-4 h-4 text-muted-foreground" />;
                  let pillClass = "bg-muted text-muted-foreground";
                  let pillLabel = "Not configured";
                  if (!s.configured && s.required) {
                    icon = <AlertTriangle className="w-4 h-4 text-destructive" />;
                    pillClass = "bg-destructive/10 text-destructive";
                    pillLabel = "Missing (required)";
                  } else if (!s.configured) {
                    pillLabel = "Not configured";
                  } else if (s.reachable === "ok") {
                    icon = <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
                    pillClass = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
                    pillLabel = "Healthy";
                  } else if (s.reachable === "fail") {
                    icon = <AlertTriangle className="w-4 h-4 text-destructive" />;
                    pillClass = "bg-destructive/10 text-destructive";
                    pillLabel = "Unreachable";
                  } else {
                    icon = <CheckCircle2 className="w-4 h-4 text-blue-500" />;
                    pillClass = "bg-blue-500/10 text-blue-600 dark:text-blue-400";
                    pillLabel = "Configured";
                  }
                  return (
                    <div key={s.key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border/60 bg-card">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {icon}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{s.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{s.detail}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold flex-shrink-0 ${pillClass}`}>{pillLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
