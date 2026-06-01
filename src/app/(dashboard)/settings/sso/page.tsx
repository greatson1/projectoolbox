"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ExternalLink, Copy } from "lucide-react";

type SsoStatus = {
  workosOrgId: string | null;
  emailDomains: string[];
  ssoRequired: boolean;
  name: string;
};

export default function SsoSettingsPage() {
  const [status, setStatus] = useState<SsoStatus | null>(null);
  const [domainsInput, setDomainsInput] = useState("");
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const refresh = async () => {
    const r = await fetch("/api/org/sso/setup");
    if (r.status === 403) { setDenied(true); return; }
    if (!r.ok) return;
    const j = await r.json();
    setStatus(j.data);
    if (j.data?.emailDomains?.length) setDomainsInput(j.data.emailDomains.join(", "));
  };

  useEffect(() => { refresh(); }, []);

  if (denied) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Single Sign-On</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Only the organisation Owner can configure SSO.</p>
        </CardContent>
      </Card>
    );
  }

  const save = async () => {
    const emailDomains = domainsInput
      .split(/[\s,]+/)
      .map((d) => d.trim())
      .filter(Boolean);
    if (emailDomains.length === 0) {
      toast.error("Add at least one email domain.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/org/sso/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailDomains }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Setup failed");
      setPortalUrl(j.data.portalUrl);
      toast.success("SSO connection ready. Share the Admin Portal link with your IT team.");
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleRequired = async (next: boolean) => {
    if (next && !window.confirm("Require SSO for all members? Password + Google + Microsoft login will be blocked for everyone in your organisation — they must come through your IdP.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/org/sso/setup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssoRequired: next }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Update failed");
      toast.success(next ? "SSO required." : "SSO no longer required.");
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Single Sign-On (SAML / OIDC)
            {status?.workosOrgId && <Badge variant="secondary" className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> Connected</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Let your staff sign in with your corporate identity provider (Okta, Microsoft Entra ID, Google Workspace, OneLogin, JumpCloud, Ping, ADFS, etc.). When SSO is configured, anyone with an email at the domains below will be redirected to your IdP at sign-in time.
          </p>

          <div>
            <Label className="text-xs">Email domains</Label>
            <Input
              value={domainsInput}
              onChange={(e) => setDomainsInput(e.target.value)}
              placeholder="acme.com, acme-corp.io"
              className="mt-1"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Comma- or space-separated. Only users with email at these domains are routed through SSO.</p>
          </div>

          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : status?.workosOrgId ? "Update domains" : "Create SSO connection"}
          </Button>

          {portalUrl && (
            <div className="mt-3 p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
              <p className="text-xs font-medium">Admin Portal link for your IT team</p>
              <p className="text-[11px] text-muted-foreground">
                Send this link to whoever administers your identity provider. They'll use it to configure SAML/OIDC — no further input from you required. The link expires after 5 minutes; regenerate if it lapses.
              </p>
              <div className="flex gap-2">
                <Input value={portalUrl} readOnly className="text-[11px] font-mono" />
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(portalUrl); toast.success("Copied"); }}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.open(portalUrl, "_blank")}>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {status?.workosOrgId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Require SSO</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              When required, password + Google + Microsoft logins are blocked for every member of your organisation. Only your IdP can mint a session. Recommended once you've tested the SSO flow end-to-end.
            </p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {status.ssoRequired
                  ? <Badge variant="secondary" className="text-[10px]">Required</Badge>
                  : <Badge variant="outline" className="text-[10px]">Optional</Badge>}
              </div>
              <Button
                size="sm"
                variant={status.ssoRequired ? "outline" : "default"}
                onClick={() => toggleRequired(!status.ssoRequired)}
                disabled={busy}
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : status.ssoRequired ? "Make optional" : "Require SSO"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
