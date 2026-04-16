"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Zap,
  Plus,
  ArrowRight,
  Trash2,
  Pencil,
  X,
  Bot,
  ToggleLeft,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Static option lists                                                */
/* ------------------------------------------------------------------ */

const TRIGGERS = [
  { value: "risk_high", label: "Risk reaches HIGH severity" },
  { value: "task_overdue", label: "Task becomes overdue" },
  { value: "phase_gate_approved", label: "Phase gate approved" },
  { value: "budget_threshold", label: "Budget exceeds threshold" },
  { value: "sprint_completed", label: "Sprint completed" },
  { value: "artefact_generated", label: "Artefact generated" },
  { value: "agent_needs_input", label: "Agent needs user input" },
  { value: "approval_pending", label: "New approval pending" },
] as const;

const ACTIONS = [
  { value: "send_slack", label: "Send Slack message" },
  { value: "send_teams", label: "Send Teams message" },
  { value: "send_email", label: "Send email notification" },
  { value: "create_jira_ticket", label: "Create Jira ticket" },
  { value: "create_calendar_event", label: "Create calendar event" },
  { value: "call_webhook", label: "Call webhook" },
  { value: "send_discord", label: "Send Discord message" },
] as const;

type TriggerValue = (typeof TRIGGERS)[number]["value"];
type ActionValue = (typeof ACTIONS)[number]["value"];

/** Map action → which integration types can fulfil it */
const ACTION_INTEGRATION_TYPE: Record<ActionValue, string> = {
  send_slack: "slack",
  send_teams: "teams",
  send_email: "email",
  create_jira_ticket: "jira",
  create_calendar_event: "calendar",
  call_webhook: "webhook",
  send_discord: "discord",
};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AutomationRule {
  id: string;
  name: string;
  trigger: TriggerValue;
  action: ActionValue;
  integrationId: string | null;
  config: Record<string, string>;
  isActive: boolean;
  fireCount: number;
  lastFiredAt: string | null;
  createdAt: string;
}

interface Integration {
  id: string;
  name: string;
  type: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function triggerLabel(v: string) {
  return TRIGGERS.find((t) => t.value === v)?.label ?? v;
}
function actionLabel(v: string) {
  return ACTIONS.find((a) => a.value === v)?.label ?? v;
}
function relativeTime(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function configLabel(action: ActionValue) {
  if (action === "send_email") return "Recipients";
  if (action === "call_webhook") return "URL";
  return "Channel / Destination";
}
function configKey(action: ActionValue) {
  if (action === "send_email") return "recipients";
  if (action === "call_webhook") return "url";
  return "channel";
}
function configPlaceholder(action: ActionValue) {
  if (action === "send_email") return "alice@co.com, bob@co.com";
  if (action === "call_webhook") return "https://hooks.example.com/abc";
  return "#general";
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  /* form state */
  const [formName, setFormName] = useState("");
  const [formTrigger, setFormTrigger] = useState<TriggerValue>("risk_high");
  const [formAction, setFormAction] = useState<ActionValue>("send_slack");
  const [formIntegrationId, setFormIntegrationId] = useState("");
  const [formConfig, setFormConfig] = useState("");
  const [formProject, setFormProject] = useState("all");
  const [submitting, setSubmitting] = useState(false);

  /* ---- fetch ---- */

  async function fetchRules() {
    try {
      const res = await fetch("/api/automations");
      if (res.ok) {
        const data = await res.json();
        setRules(Array.isArray(data) ? data : data.rules ?? []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  async function fetchIntegrations() {
    try {
      const res = await fetch("/api/integrations");
      if (res.ok) {
        const data = await res.json();
        setIntegrations(
          Array.isArray(data) ? data : data.integrations ?? []
        );
      }
    } catch {
      /* silent */
    }
  }

  useEffect(() => {
    fetchRules();
    fetchIntegrations();
  }, []);

  /* ---- actions ---- */

  async function createRule() {
    if (!formName.trim()) {
      toast.error("Rule name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          trigger: formTrigger,
          action: formAction,
          integrationId: formIntegrationId || null,
          config: { [configKey(formAction)]: formConfig },
        }),
      });
      if (!res.ok) throw new Error("Failed to create rule");
      toast.success("Automation rule created");
      setShowModal(false);
      resetForm();
      fetchRules();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create rule"
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleRule(rule: AutomationRule) {
    try {
      const res = await fetch("/api/automations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, isActive: !rule.isActive }),
      });
      if (!res.ok) throw new Error();
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, isActive: !r.isActive } : r
        )
      );
    } catch {
      toast.error("Failed to toggle rule");
    }
  }

  async function deleteRule(id: string) {
    try {
      const res = await fetch(`/api/automations?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success("Rule deleted");
    } catch {
      toast.error("Failed to delete rule");
    }
  }

  function resetForm() {
    setFormName("");
    setFormTrigger("risk_high");
    setFormAction("send_slack");
    setFormIntegrationId("");
    setFormConfig("");
    setFormProject("all");
  }

  function openModal() {
    resetForm();
    setShowModal(true);
  }

  /* filtered integrations for current action */
  const filteredIntegrations = integrations.filter(
    (i) => i.type === ACTION_INTEGRATION_TYPE[formAction]
  );

  /* ---- render ---- */

  return (
    <div className="max-w-[1100px] space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Automations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define rules to automate notifications and actions
          </p>
        </div>
        <Button size="sm" onClick={openModal}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Rule
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <p className="text-sm text-muted-foreground animate-pulse">
          Loading rules...
        </p>
      )}

      {/* Empty state */}
      {!loading && rules.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">
              No automation rules yet
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Create your first rule to automatically trigger notifications
              and actions when events occur in your projects.
            </p>
            <Button size="sm" className="mt-4" onClick={openModal}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Rule
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Rule cards */}
      {!loading && rules.length > 0 && (
        <div className="grid gap-3">
          {rules.map((rule) => (
            <Card
              key={rule.id}
              className={`transition-colors ${
                rule.isActive
                  ? "border-border"
                  : "border-border/50 opacity-60"
              }`}
            >
              <CardContent className="flex items-center gap-4 py-4 px-5">
                {/* Name */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {rule.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="truncate">
                      {triggerLabel(rule.trigger)}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {actionLabel(rule.action)}
                    </span>
                  </div>
                </div>

                {/* Integration badge */}
                {rule.integrationId && (
                  <Badge variant="secondary" className="text-[11px] shrink-0">
                    {integrations.find(
                      (i) => i.id === rule.integrationId
                    )?.name ?? "Integration"}
                  </Badge>
                )}

                {/* Stats */}
                <div className="hidden sm:flex flex-col items-end text-[11px] text-muted-foreground shrink-0">
                  <span>Fired {rule.fireCount ?? 0}x</span>
                  <span>{relativeTime(rule.lastFiredAt)}</span>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => toggleRule(rule)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    rule.isActive ? "bg-primary" : "bg-muted"
                  }`}
                  aria-label="Toggle rule"
                >
                  <span
                    className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
                      rule.isActive ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toast.info("Edit coming soon")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteRule(rule.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ---- Add Rule Modal ---- */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          {/* panel */}
          <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl mx-4">
            {/* header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">New Automation Rule</h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-md p-1 hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Rule name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Notify PM on high risk"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Trigger */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  When this happens (trigger)
                </label>
                <select
                  value={formTrigger}
                  onChange={(e) =>
                    setFormTrigger(e.target.value as TriggerValue)
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {TRIGGERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Action */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Do this (action)
                </label>
                <select
                  value={formAction}
                  onChange={(e) => {
                    setFormAction(e.target.value as ActionValue);
                    setFormIntegrationId("");
                    setFormConfig("");
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Integration picker */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Integration
                </label>
                <select
                  value={formIntegrationId}
                  onChange={(e) => setFormIntegrationId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">
                    {filteredIntegrations.length === 0
                      ? "No matching integrations connected"
                      : "Select integration..."}
                  </option>
                  {filteredIntegrations.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Config */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  {configLabel(formAction)}
                </label>
                <input
                  type="text"
                  value={formConfig}
                  onChange={(e) => setFormConfig(e.target.value)}
                  placeholder={configPlaceholder(formAction)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Project filter */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Project scope
                </label>
                <select
                  value={formProject}
                  onChange={(e) => setFormProject(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="all">All Projects</option>
                </select>
              </div>
            </div>

            {/* footer */}
            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={submitting} onClick={createRule}>
                {submitting ? "Creating..." : "Create Rule"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
