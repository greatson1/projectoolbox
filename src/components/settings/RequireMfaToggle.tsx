"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff, AlertTriangle } from "lucide-react";

/**
 * OWNER-only toggle for `org.requireMfa`. Reads current state on mount,
 * confirms enable-vs-disable with the operator before posting (turning it
 * ON could lock other members out, so we surface the affected-member count
 * the server returns).
 *
 * Non-OWNERs get a 403 from the API, which we surface as a soft "you don't
 * have permission" badge rather than hiding the row entirely — that way
 * Admins can see the policy state without acting on it.
 */
export function RequireMfaToggle({ canEdit }: { canEdit: boolean }) {
  const [requireMfa, setRequireMfa] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/org/policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.data) setRequireMfa(!!j.data.requireMfa); })
      .catch(() => {});
  }, []);

  const toggle = async () => {
    if (!canEdit) return;
    const next = !requireMfa;
    if (next && !window.confirm("Turn on require-MFA for the whole organisation? Members without TOTP will be redirected to the enrollment screen on their next request — they cannot use the app until they enrol.")) {
      return;
    }
    if (!next && !window.confirm("Turn off require-MFA for the whole organisation? Members will still keep MFA on their own accounts, but new members will not be forced to enrol.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/org/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireMfa: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Update failed");
      setRequireMfa(next);
      if (next && j.data?.affectedMembers > 0) {
        toast.success(`Require-MFA on. ${j.data.affectedMembers} member(s) will be prompted to enrol next time they sign in.`);
      } else {
        toast.success(next ? "Require-MFA on." : "Require-MFA off.");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between py-3 border-t border-border">
      <div>
        <p className="text-sm font-medium flex items-center gap-2">
          Require two-factor for all members
          {requireMfa === null
            ? null
            : requireMfa
              ? <Badge variant="secondary" className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> On</Badge>
              : <Badge variant="outline" className="text-[10px] gap-1"><ShieldOff className="w-3 h-3" /> Off</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          When on, every member must enrol a TOTP authenticator before they can use the workspace. Owners and Admins are NOT exempt.
        </p>
        {!canEdit && (
          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Only the organisation Owner can change this.
          </p>
        )}
      </div>
      <Button
        variant={requireMfa ? "outline" : "default"}
        size="sm"
        onClick={toggle}
        disabled={!canEdit || busy || requireMfa === null}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (requireMfa ? "Turn off" : "Turn on")}
      </Button>
    </div>
  );
}