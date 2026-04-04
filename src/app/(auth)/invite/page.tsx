// @ts-nocheck
"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

function InviteContent() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");

  const [invite, setInvite] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<"accepted" | "declined" | "error" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setError("No invitation token"); setLoading(false); return; }
    fetch(`/api/invitations/${token}`).then(r => r.json()).then(d => {
      if (d.data) setInvite(d.data);
      else setError(d.error || "Invalid invitation");
      setLoading(false);
    }).catch(() => { setError("Failed to load invitation"); setLoading(false); });
  }, [token]);

  const handleAction = async (action: "accept" | "decline") => {
    setActing(true);
    try {
      const r = await fetch(`/api/invitations/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (r.ok) {
        setResult(action === "accept" ? "accepted" : "declined");
        if (action === "accept") setTimeout(() => router.push("/dashboard"), 2000);
      } else if (d.signupRequired) {
        router.push(`/signup?invite=${token}&email=${encodeURIComponent(invite?.email || "")}`);
      } else {
        setError(d.error || "Failed");
      }
    } catch { setError("Network error"); }
    setActing(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (result) return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          {result === "accepted" ? (
            <>
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h1 className="text-xl font-bold mb-2">Welcome aboard!</h1>
              <p className="text-sm text-muted-foreground">You've joined {invite?.orgName}. Redirecting to dashboard...</p>
            </>
          ) : (
            <>
              <XCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h1 className="text-xl font-bold mb-2">Invitation declined</h1>
              <p className="text-sm text-muted-foreground">You can close this page.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Invalid Invitation</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push("/login")}>Go to Login</Button>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent flex items-end px-8 pb-4">
          {invite?.orgLogo ? (
            <img src={invite.orgLogo} alt="" className="w-12 h-12 rounded-xl" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-lg font-bold text-white">
              {invite?.orgName?.[0] || "P"}
            </div>
          )}
        </div>
        <CardContent className="p-8">
          <h1 className="text-xl font-bold mb-1">Join {invite?.orgName}</h1>
          <p className="text-sm text-muted-foreground mb-6">You've been invited as a <strong className="text-foreground">{invite?.role}</strong></p>

          {invite?.orgIndustry && (
            <p className="text-xs text-muted-foreground mb-4">{invite.orgIndustry}</p>
          )}

          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => handleAction("accept")} disabled={acting}>
              {acting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
              Accept
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => handleAction("decline")} disabled={acting}>
              Decline
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InvitePage() {
  return <Suspense fallback={null}><InviteContent /></Suspense>;
}
