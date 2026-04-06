"use client";
// @ts-nocheck

export const dynamic = "force-dynamic";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { User, Bell, Shield, Palette, Building2, Key, Moon, Sun, Check } from "lucide-react";
import Link from "next/link";
import { useAppStore, type AccentTheme } from "@/stores/app";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "organisation", label: "Organisation", icon: Building2 },
  { id: "api", label: "API Keys", icon: Key },
];

const ACCENT_THEMES: { id: AccentTheme; label: string; color: string; desc: string }[] = [
  { id: "indigo", label: "Indigo", color: "#6366F1", desc: "Default" },
  { id: "midnight", label: "Midnight Blue", color: "#2563EB", desc: "Corporate" },
  { id: "emerald", label: "Emerald", color: "#059669", desc: "Growth" },
];

export default function SettingsPage() {
  usePageTitle("Settings");
  const sessionResult = useSession();
  const [active, setActive] = useState("profile");
  const { theme, setTheme } = useTheme();
  const { accentTheme, setAccentTheme } = useAppStore();
  const user = (sessionResult as any)?.data?.user ?? {};

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

        </div>
      </div>
    </div>
  );
}
