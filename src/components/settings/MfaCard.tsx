"use client";

/**
 * MFA / TOTP enrollment + disable widget for /settings → Security.
 *
 * States:
 *   idle (mfaEnabled=false, no enrollment in progress)
 *     → shows "Enable 2FA" button
 *   enrolling
 *     → calls POST /api/auth/mfa { action: "enroll" }, shows QR + secret
 *     → user scans QR with Authenticator app, enters first 6-digit code
 *     → posts to { action: "verify" } — success flips to enabled
 *   enabled (mfaEnabled=true)
 *     → shows "Disable 2FA" button — requires current TOTP to confirm
 *
 * Image rendered from the data: URL the server returns; we never expose the
 * raw secret in plain UI without the QR (so users with screen readers can
 * still enroll by typing the secret manually).
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Shield, ShieldCheck, ShieldOff } from "lucide-react";

type Status = { mfaEnabled: boolean; enrollmentInProgress: boolean };

export function MfaCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"idle" | "enrolling" | "disabling">("idle");
  const [enrollment, setEnrollment] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const res = await fetch("/api/auth/mfa", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setStatus(json.data);
    if (json.data.mfaEnabled) {
      setEnrollment(null);
      setMode("idle");
    }
  };

  useEffect(() => { refresh(); }, []);

  const enroll = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enroll" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Enrollment failed");
      setEnrollment({ secret: json.data.secret, qrDataUrl: json.data.qrDataUrl });
      setMode("enrolling");
      setCode("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Verification failed");
      toast.success("MFA enabled. You'll need a code next time you sign in.");
      setCode("");
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
      toast.error("Enter your current authenticator code to confirm");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Disable failed");
      toast.success("MFA disabled.");
      setCode("");
      setMode("idle");
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading MFA status…
      </div>
    );
  }

  return (
    <div className="py-3 border-b border-border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium flex items-center gap-2">
            Two-Factor Authentication
            {status.mfaEnabled
              ? <Badge variant="secondary" className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> Enabled</Badge>
              : <Badge variant="outline" className="text-[10px] gap-1"><ShieldOff className="w-3 h-3" /> Disabled</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {status.mfaEnabled
              ? "Your account requires a 6-digit code at sign in."
              : "Add a TOTP authenticator (1Password, Authy, Google Authenticator, etc.) for extra security."}
          </p>
        </div>
        {status.mfaEnabled && mode !== "disabling" && (
          <Button variant="outline" size="sm" onClick={() => setMode("disabling")}>Disable 2FA</Button>
        )}
        {!status.mfaEnabled && mode === "idle" && (
          <Button size="sm" onClick={enroll} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Shield className="w-3.5 h-3.5 mr-1.5" /> Enable 2FA</>}
          </Button>
        )}
      </div>

      {mode === "enrolling" && enrollment && (
        <div className="mt-4 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
          <div className="flex items-start gap-4">
            <img src={enrollment.qrDataUrl} alt="Scan this QR with your authenticator app" className="w-32 h-32 rounded-md bg-white p-1" />
            <div className="flex-1 space-y-2">
              <p className="text-xs font-medium">Scan with your authenticator</p>
              <p className="text-[11px] text-muted-foreground">Or enter this secret manually:</p>
              <code className="block text-[11px] font-mono break-all px-2 py-1 rounded bg-background border border-border">{enrollment.secret}</code>
              <p className="text-[11px] text-muted-foreground">Then enter the 6-digit code your app shows to finish.</p>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="mfa-verify-code" className="text-xs">Verification code</Label>
              <Input
                id="mfa-verify-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={9}
              />
            </div>
            <Button size="sm" onClick={verify} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Verify & enable"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setMode("idle"); setEnrollment(null); setCode(""); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "disabling" && (
        <div className="mt-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-3">
          <p className="text-xs">Enter your current 6-digit code to confirm. This protects you from someone with stolen session cookies turning MFA off.</p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="mfa-disable-code" className="text-xs">Current code</Label>
              <Input
                id="mfa-disable-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={9}
              />
            </div>
            <Button variant="destructive" size="sm" onClick={disable} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Disable"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setMode("idle"); setCode(""); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}