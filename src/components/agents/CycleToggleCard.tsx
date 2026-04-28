"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Cycle toggle — controls whether the autonomous cycle runs for this
 * agent's active deployment. Defaults to PAUSED for new deployments so
 * setup phases don't burn Claude credits on no-op cycles.
 *
 * Backed by AgentDeployment.cyclePaused. Reads current state from
 * /api/agents/[id]/next-action (which already returns deployment +
 * phaseStatus) — no extra fetch. Writes via /api/agents/[id]/cycle-toggle.
 */

interface Props {
  agentId: string;
  accentColor?: string;
}

export function CycleToggleCard({ agentId, accentColor = "#6366F1" }: Props) {
  const [paused, setPaused] = useState<boolean | null>(null);
  const [phaseStatus, setPhaseStatus] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load current state from the deployment row.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/cycle-toggle`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return;
        setPaused(!!j.data.paused);
        setPhaseStatus(j.data.phaseStatus || null);
        setCurrentPhase(j.data.currentPhase || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  async function toggle() {
    if (paused === null || submitting) return;
    const next = !paused;
    setSubmitting(true);
    // Optimistic flip
    setPaused(next);
    try {
      const res = await fetch(`/api/agents/${agentId}/cycle-toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `${res.status}`);
      }
      toast.success(
        next
          ? "Autonomous cycle paused — agent stops running monitoring loops."
          : "Autonomous cycle enabled — first cycle fires within 1 minute.",
      );
    } catch (e: any) {
      // Roll back
      setPaused(!next);
      toast.error(e?.message || "Could not save");
    } finally {
      setSubmitting(false);
    }
  }

  // Phase-aware copy: tell the user what the cadence will actually be.
  const SETUP_STATES = new Set([
    "researching",
    "awaiting_research_approval",
    "awaiting_clarification",
    "waiting_approval",
    "blocked_tasks_incomplete",
  ]);
  const isSetupPhase = phaseStatus ? SETUP_STATES.has(phaseStatus) : false;
  const effectiveCadence = isSetupPhase
    ? "24h (phase is in setup — interval auto-stretched to avoid no-op cycles)"
    : "every 10 minutes (configured cycleInterval)";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-foreground">Autonomous cycle</h3>
        {paused !== null && (
          <Badge
            variant="secondary"
            className={
              paused
                ? "bg-muted text-muted-foreground"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
            }
          >
            {paused ? "Paused" : "Running"}
          </Badge>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
        When enabled, the agent runs a monitoring + alert + Sonnet-driven analysis loop on the configured cadence — useful during execution when there&apos;s real work to track. When paused, the agent stays quiet and only acts on user-driven events (chat, approvals, deploys).
      </p>

      <div className="flex items-center justify-between py-1.5">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">
            {paused === null ? "Loading…" : paused ? "Cycle is paused" : "Cycle is running"}
          </p>
          {paused === false && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Cadence: {effectiveCadence}
              {currentPhase && ` · phase: ${currentPhase} (${phaseStatus || "active"})`}
            </p>
          )}
          {paused === true && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Toggle on when delivery starts. New deployments default to paused to avoid burning credits during setup.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={submitting || paused === null}
          aria-label={paused ? "Enable autonomous cycle" : "Pause autonomous cycle"}
          className="relative h-5 w-9 rounded-full transition-all flex-shrink-0 disabled:opacity-50"
          style={{
            background: paused === false ? accentColor : "var(--border)",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? (
            <Loader2 className="absolute top-0.5 left-2.5 size-4 animate-spin text-white" />
          ) : (
            <div
              className="absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all"
              style={{ left: paused === false ? 18 : 2 }}
            />
          )}
        </button>
      </div>
    </Card>
  );
}