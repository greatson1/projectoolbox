"use client";
// @ts-nocheck

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  Users,
  SquareKanban,
  CheckSquare,
  LayoutGrid,
  Calendar,
  MessageCircle,
  Mail,
  Globe,
  Workflow,
  Plug,
  Loader2,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// TYPES & DATA
// ═══════════════════════════════════════════════════════════════════

const ICONS: Record<string, React.ElementType> = {
  MessageSquare,
  Users,
  SquareKanban,
  CheckSquare,
  LayoutGrid,
  Calendar,
  MessageCircle,
  Mail,
  Globe,
  Workflow,
};

const INTEGRATION_TYPES = [
  { type: "slack", name: "Slack", description: "Send alerts and updates to Slack channels", icon: "MessageSquare", color: "#E01E5A" },
  { type: "teams", name: "Microsoft Teams", description: "Post notifications to Teams channels", icon: "Users", color: "#6264A7" },
  { type: "jira", name: "Jira", description: "Create issues and sync task status", icon: "SquareKanban", color: "#0052CC" },
  { type: "asana", name: "Asana", description: "Sync tasks and project milestones", icon: "CheckSquare", color: "#F06A6A" },
  { type: "monday", name: "Monday.com", description: "Push updates to Monday boards", icon: "LayoutGrid", color: "#FF3D57" },
  { type: "google_calendar", name: "Google Calendar", description: "Create events for meetings and milestones", icon: "Calendar", color: "#4285F4" },
  { type: "discord", name: "Discord", description: "Send alerts to Discord channels", icon: "MessageCircle", color: "#5865F2" },
  { type: "email", name: "Email (SMTP)", description: "Custom email notifications via SMTP", icon: "Mail", color: "#EA4335" },
  { type: "webhook", name: "Custom Webhook", description: "Send JSON payloads to any URL", icon: "Globe", color: "#10B981" },
  { type: "n8n", name: "N8N", description: "Connect to N8N workflows for advanced automations", icon: "Workflow", color: "#FF6D5A" },
] as const;

type IntegrationType = (typeof INTEGRATION_TYPES)[number]["type"];

interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  config: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════
// CONNECT FORM FIELDS PER TYPE
// ═══════════════════════════════════════════════════════════════════

function getFieldsForType(type: IntegrationType) {
  switch (type) {
    case "slack":
    case "discord":
    case "teams":
    case "webhook":
      return [{ key: "webhookUrl", label: "Webhook URL", type: "url", placeholder: "https://..." }];
    case "n8n":
      return [
        { key: "apiKey", label: "API Key (optional)", type: "password", placeholder: "n8n API key for auth header" },
        { key: "callbackSecret", label: "Callback Secret (optional)", type: "password", placeholder: "Secret for n8n to authenticate callbacks" },
        { key: "workflows.inbound_email", label: "Inbound Email Webhook", type: "url", placeholder: "https://your-n8n.com/webhook/inbound-email" },
        { key: "workflows.approval_escalation", label: "Approval Escalation Webhook", type: "url", placeholder: "https://your-n8n.com/webhook/approvals" },
        { key: "workflows.meeting_transcript", label: "Meeting Transcript Webhook", type: "url", placeholder: "https://your-n8n.com/webhook/transcript" },
        { key: "workflows.feasibility_research", label: "Feasibility Research Webhook", type: "url", placeholder: "https://your-n8n.com/webhook/research" },
        { key: "workflows.stripe_event", label: "Stripe Events Webhook", type: "url", placeholder: "https://your-n8n.com/webhook/stripe" },
        { key: "workflows.report_schedule", label: "Report Schedule Webhook", type: "url", placeholder: "https://your-n8n.com/webhook/reports" },
      ];
    case "jira":
    case "asana":
    case "monday":
      return [
        { key: "apiKey", label: "API Key", type: "password", placeholder: "Enter API key" },
        { key: "domain", label: "Domain / Workspace URL", type: "url", placeholder: "https://your-workspace.atlassian.net" },
      ];
    case "google_calendar":
      return []; // placeholder OAuth flow
    case "email":
      return [
        { key: "smtpHost", label: "SMTP Host", type: "text", placeholder: "smtp.example.com" },
        { key: "port", label: "Port", type: "text", placeholder: "587" },
        { key: "username", label: "Username", type: "text", placeholder: "user@example.com" },
        { key: "password", label: "Password", type: "password", placeholder: "Enter password" },
      ];
    default:
      return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectType, setConnectType] = useState<IntegrationType | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // ── Fetch existing integrations ──
  const fetchIntegrations = async () => {
    try {
      const res = await fetch("/api/integrations");
      if (res.ok) {
        const data = await res.json();
        setIntegrations(Array.isArray(data) ? data : data.integrations ?? []);
      }
    } catch {
      // silent — cards will show "Not Connected"
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, []);

  // ── Connect ──
  const openConnectModal = (type: IntegrationType) => {
    setConnectType(type);
    setFormValues({});
    setConnectModalOpen(true);
  };

  const handleConnect = async () => {
    if (!connectType) return;
    setSaving(true);
    try {
      const meta = INTEGRATION_TYPES.find((t) => t.type === connectType)!;

      // Build config — expand dotted keys into nested objects (e.g. "workflows.inbound_email" → { workflows: { inbound_email: "..." } })
      const config: Record<string, any> = {};
      for (const [key, value] of Object.entries(formValues)) {
        if (!value) continue;
        const parts = key.split(".");
        if (parts.length === 2) {
          if (!config[parts[0]]) config[parts[0]] = {};
          config[parts[0]][parts[1]] = value;
        } else {
          config[key] = value;
        }
      }

      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: connectType, name: meta.name, config }),
      });
      if (!res.ok) throw new Error("Failed to connect");
      toast.success(`${meta.name} connected`);
      setConnectModalOpen(false);
      await fetchIntegrations();
    } catch {
      toast.error("Failed to connect integration");
    } finally {
      setSaving(false);
    }
  };

  // ── Disconnect ──
  const handleDisconnect = async (integration: Integration) => {
    setDisconnecting(integration.id);
    try {
      const res = await fetch(`/api/integrations?id=${integration.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to disconnect");
      toast.success(`${integration.name} disconnected`);
      await fetchIntegrations();
    } catch {
      toast.error("Failed to disconnect integration");
    } finally {
      setDisconnecting(null);
    }
  };

  // ── Helpers ──
  const connectedMap = new Map(integrations.map((i) => [i.type, i]));
  const connectedCount = connectedMap.size;
  const availableCount = INTEGRATION_TYPES.length;

  const currentMeta = connectType ? INTEGRATION_TYPES.find((t) => t.type === connectType) : null;
  const currentFields = connectType ? getFieldsForType(connectType) : [];

  // ── Render ──
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">Integrations</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your tools to automate workflows
        </p>
      </div>

      {/* AI Services Health */}
      <PerplexityHealthCard />

      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{connectedCount}</span> connected
        </span>
        <span className="text-border">|</span>
        <span>
          <span className="font-medium text-foreground">{availableCount}</span> available
        </span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATION_TYPES.map((meta) => {
            const Icon = ICONS[meta.icon];
            const connected = connectedMap.get(meta.type);
            return (
              <Card
                key={meta.type}
                className="group relative overflow-hidden border-border bg-card transition-colors hover:border-foreground/20"
              >
                <CardContent className="flex flex-col gap-3 p-4">
                  {/* Icon + badge row */}
                  <div className="flex items-start justify-between">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-lg"
                      style={{ backgroundColor: meta.color + "18" }}
                    >
                      {Icon && <Icon className="h-4 w-4" style={{ color: meta.color }} />}
                    </div>
                    {connected ? (
                      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs">
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Not Connected
                      </Badge>
                    )}
                  </div>

                  {/* Name & description */}
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{meta.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {meta.description}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    {connected ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => openConnectModal(meta.type)}
                        >
                          Configure
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={disconnecting === connected.id}
                          onClick={() => handleDisconnect(connected)}
                        >
                          {disconnecting === connected.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : null}
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => openConnectModal(meta.type)}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Connect / Configure Modal ── */}
      <Dialog open={connectModalOpen} onOpenChange={setConnectModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {connectedMap.has(connectType!) ? "Configure" : "Connect"} {currentMeta?.name}
            </DialogTitle>
            <DialogDescription>{currentMeta?.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {connectType === "google_calendar" ? (
              <Button className="w-full" onClick={handleConnect}>
                Connect with Google
              </Button>
            ) : currentFields.length > 0 ? (
              currentFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label className="text-xs">{field.label}</Label>
                  <Input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={formValues[field.key] ?? ""}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </div>
              ))
            ) : null}
          </div>

          {connectType !== "google_calendar" && currentFields.length > 0 && (
            <DialogFooter>
              <Button
                onClick={handleConnect}
                disabled={saving || currentFields.some((f) => !formValues[f.key]?.trim())}
              >
                {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {connectedMap.has(connectType!) ? "Save" : "Connect"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AI Services Health Check (Perplexity diagnostic)
// ═══════════════════════════════════════════════════════════════════

function PerplexityHealthCard() {
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [result, setResult] = useState<any>(null);

  const test = async () => {
    setStatus("checking");
    setResult(null);
    try {
      const res = await fetch("/api/debug/perplexity");
      const data = await res.json();
      setResult(data);
      setStatus(data.status === "working" ? "ok" : "error");
    } catch (e: any) {
      setResult({ message: e.message });
      setStatus("error");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold mb-0.5">Perplexity AI (Research)</h3>
          <p className="text-xs text-muted-foreground">
            Used for phase-specific research. Required for agents to gather real-world context.
          </p>
        </div>
        <button
          onClick={test}
          disabled={status === "checking"}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {status === "checking" ? "Testing..." : "Test Connection"}
        </button>
      </div>
      {result && (
        <div className={`mt-3 p-3 rounded-lg text-xs ${
          status === "ok" ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
          : "bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400"
        }`}>
          <p className="font-semibold mb-1">{result.message}</p>
          {result.keyPrefix && (
            <p className="text-[11px] opacity-80">Key prefix: {result.keyPrefix}</p>
          )}
          {result.latencyMs && (
            <p className="text-[11px] opacity-80">Latency: {result.latencyMs}ms</p>
          )}
          {result.testReply && (
            <p className="text-[11px] opacity-80 mt-1">Test reply: "{result.testReply}"</p>
          )}
        </div>
      )}
    </div>
  );
}
