"use client";

/**
 * IP allowlist editor (BUSINESS+).
 *
 * UX:
 *   - Lists current entries with a delete-X button per row.
 *   - Plain text input to add a new entry; accepts "203.0.113.42" or
 *     "203.0.113.0/24". Client-side regex sanity-check before POST so
 *     malformed input doesn't even hit the API.
 *   - Save persists. Empty list = no restriction.
 *   - Owner-only on the server (the canEdit prop just disables the UI
 *     for non-owners; the PATCH is rejected too).
 *
 * Hidden / read-only state when the org's plan doesn't unlock the
 * feature. The card still renders so users see the upgrade hint
 * rather than the toggle silently disappearing.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShieldCheck, X, Plus, Lock } from "lucide-react";
import { toast } from "sonner";

const IPV4_OR_CIDR = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:[0-9]|[12][0-9]|3[0-2]))?$/;

interface Props {
  /** Owner role only — non-owners see a read-only card. */
  canEdit: boolean;
  /** Plan-gated. Pass true when org.plan unlocks ipAllowlist
   *  (BUSINESS+). When false the card shows a clear upgrade hint
   *  instead of the editor. */
  planUnlocked: boolean;
}

export function IpAllowlistCard({ canEdit, planUnlocked }: Props) {
  const [entries, setEntries] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/org/policy")
      .then(r => r.json())
      .then(j => {
        setEntries(Array.isArray(j?.data?.ipAllowlist) ? j.data.ipAllowlist : []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save(next: string[]) {
    setBusy(true);
    try {
      const res = await fetch("/api/org/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipAllowlist: next }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j?.error || "Could not save IP allowlist");
        return;
      }
      setEntries(j?.data?.ipAllowlist ?? next);
      toast.success(next.length === 0 ? "IP allowlist cleared" : "IP allowlist updated");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function addEntry() {
    const candidate = draft.trim();
    if (!candidate) return;
    if (!IPV4_OR_CIDR.test(candidate)) {
      toast.error("Use a valid IPv4 or CIDR — e.g. 203.0.113.42 or 203.0.113.0/24");
      return;
    }
    if (entries.includes(candidate)) {
      toast.message("That entry is already on the list");
      setDraft("");
      return;
    }
    setDraft("");
    save([...entries, candidate]);
  }

  function removeEntry(i: number) {
    save(entries.filter((_, idx) => idx !== i));
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">IP allowlist</CardTitle>
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
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          When non-empty, dashboard + API access is restricted to the IPs / CIDRs below.
          {" "}Edge middleware refuses every other request with a clear 403 page. Empty list = no restriction.
        </p>

        {!planUnlocked && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <p className="font-semibold mb-1">Upgrade to Business to enforce IP allowlists.</p>
            <p className="text-muted-foreground">Your current plan can still store entries here, but middleware won't honour them until you upgrade. <a href="/billing" className="text-primary font-semibold hover:underline">View plans →</a></p>
          </div>
        )}

        <div className="space-y-1.5">
          {!loaded && <p className="text-xs text-muted-foreground italic">Loading…</p>}
          {loaded && entries.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No entries — IP allowlist is off.</p>
          )}
          {entries.map((entry, i) => (
            <div key={`${entry}-${i}`} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-muted/40 text-sm font-mono">
              <span>{entry}</span>
              <Button
                size="sm" variant="ghost"
                onClick={() => removeEntry(i)}
                disabled={!canEdit || busy}
                title={canEdit ? "Remove" : "Owner only"}
                className="h-6 w-6 p-0"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEntry()}
            placeholder="203.0.113.42 or 203.0.113.0/24"
            disabled={!canEdit || busy}
            className="font-mono text-sm"
          />
          <Button onClick={addEntry} disabled={!canEdit || busy || !draft.trim()} size="sm">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>

        {!canEdit && (
          <p className="text-[11px] text-muted-foreground italic">
            Read-only — only the organisation Owner can change the allowlist.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
