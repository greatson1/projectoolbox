"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Lock, ShieldCheck, ScrollText } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useOrgPlan } from "@/hooks/use-org-plan";

interface AuditEntry {
  id: string;
  action: string;
  target: string | null;
  userId: string | null;
  createdAt: string;
  metadata: any;
}

/**
 * Audit log viewer (BUSINESS+).
 *
 * Reads /api/admin/audit-log which is gated server-side by
 * requirePlanFeature(session, "auditLog"). On below-BUSINESS plans
 * the page still renders so users see the upgrade hint rather than
 * 404 — the API just returns the 403 from insufficientPlanResponse.
 *
 * Audit rows are STILL written on every tier (every PATCH that goes
 * through requirePlanFeature, every SSO/MFA toggle, every artefact
 * approval). Upgrading later restores access to the full historical
 * trail rather than starting fresh.
 */
export default function AuditLogPage() {
  const { plan, can, isLoading: planLoading } = useOrgPlan();
  const planUnlocked = can("auditLog");

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  async function load() {
    setLoading(true);
    setForbidden(false);
    try {
      const res = await fetch("/api/admin/audit-log?limit=200");
      if (res.status === 403) {
        setForbidden(true);
        setEntries([]);
        return;
      }
      const j = await res.json();
      if (!res.ok) {
        toast.error(j?.error || "Could not load audit log");
        return;
      }
      setEntries(j?.data ?? []);
    } catch (e: any) {
      toast.error(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!planLoading && planUnlocked) load();
  }, [planLoading, planUnlocked]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ScrollText className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">Audit log</h1>
            {planUnlocked ? (
              <Badge variant="outline" className="text-[10px] gap-1">
                <ShieldCheck className="w-3 h-3" /> Business+
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] gap-1 text-amber-500 border-amber-500/30">
                <Lock className="w-3 h-3" /> Business plan
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Immutable trail of every governance action on your organisation. Always written; readable on Business+.
          </p>
        </div>
        {planUnlocked && (
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        )}
      </div>

      {!planUnlocked && (
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/10">
              <Lock className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold mb-1">Audit log access is a Business feature</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Your <strong>{plan}</strong> plan still writes audit entries — every governance action is recorded.
                Upgrade to Business to read the history (plus SSO/SAML, org-wide MFA enforcement, and IP allowlists).
              </p>
            </div>
            <Link href="/billing">
              <Button>View plans</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {planUnlocked && !forbidden && (
        <div className="space-y-1">
          {entries.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground italic py-8 text-center">No audit entries yet.</p>
          )}
          {entries.map((e) => (
            <Card key={e.id} className="overflow-hidden">
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{e.action}</p>
                    {e.target && (
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{e.target}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    {e.userId && (
                      <p className="text-[10px] text-muted-foreground font-mono">{e.userId.slice(-6)}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
