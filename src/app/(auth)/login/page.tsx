"use client";

// /login uses useSearchParams (?reason=session_reset for the post-session-
// reset banner). Next.js refuses to prerender a client component that
// reads searchParams unless it's inside a <Suspense> boundary; without
// the boundary the build aborts with "Error occurred prerendering page
// /login". force-dynamic alone doesn't help — that's a route-segment
// flag and doesn't apply to client-component prerender behaviour. So we
// extract the actual form into LoginForm and wrap it in <Suspense> at
// the default export. Commit 8548c92 introduced the searchParams read;
// without this split every deploy errored from then on.

import { Suspense, useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by /auth/error when it nukes stale NextAuth cookies after a
  // Configuration error. Tells the user why their old session is gone
  // and avoids the silent "I clicked sign in and now I'm back at the
  // login page" experience.
  const sessionReset = searchParams?.get("reason") === "session_reset";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // MFA challenge state — flipped on by the credentials provider throwing
  // MFA_REQUIRED. We keep the email + password in state so the second submit
  // posts both factors together; NextAuth's Credentials authorize runs once
  // per signIn call and needs all three at the same time.
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  // SSO discovery state. When the user types an email whose domain is
  // configured for SAML SSO, we replace the password field with a "Continue
  // with SSO" CTA and start the WorkOS flow on click.
  const [ssoOption, setSsoOption] = useState<{ workosOrgId: string; ssoRequired: boolean; orgName?: string } | null>(null);

  // Debounced SSO discovery — once the user has typed something that looks
  // like a complete email, hit /api/auth/sso-discover. Repeats the request
  // when the email changes, but no faster than every 400ms.
  useEffect(() => {
    if (!email || !email.includes("@") || email.indexOf("@") === email.length - 1) {
      setSsoOption(null);
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/auth/sso-discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j?.sso && j.workosOrgId) {
            setSsoOption({ workosOrgId: j.workosOrgId, ssoRequired: !!j.ssoRequired, orgName: j.orgName });
          } else {
            setSsoOption(null);
          }
        })
        .catch(() => setSsoOption(null));
    }, 400);
    return () => clearTimeout(t);
  }, [email]);

  const startSso = () => {
    if (!ssoOption) return;
    window.location.href = `/api/auth/workos/login?workosOrgId=${encodeURIComponent(ssoOption.workosOrgId)}&returnTo=${encodeURIComponent("/dashboard")}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // If SSO is REQUIRED for this email's org, refuse the password attempt
    // and route through WorkOS — the IdP is the sole authority.
    if (ssoOption?.ssoRequired) {
      startSso();
      return;
    }

    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      mfaCode: mfaRequired ? mfaCode : undefined,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      // NextAuth surfaces the error message via `result.error`. Match the
      // sentinels thrown from authorize() in lib/auth.ts. Anything else is
      // treated as "invalid credentials" — we deliberately do NOT reveal
      // whether email or password was wrong.
      if (result.error.includes("MFA_REQUIRED")) {
        setMfaRequired(true);
        setError("");
      } else if (result.error.includes("MFA_INVALID")) {
        setError("That code is invalid or expired — codes rotate every 30 seconds.");
      } else {
        setError("Invalid email or password");
      }
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <img src="/pt-logo.png" alt="Projectoolbox" className="w-10 h-10 object-contain" />
          <span className="text-xl font-bold">Projectoolbox</span>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="text-center">
              <h1 className="text-xl font-bold">
                {mfaRequired ? "Two-factor verification" : "Welcome back"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {mfaRequired ? "Enter the 6-digit code from your authenticator app" : "Sign in to your account"}
              </p>
            </div>

            {sessionReset && !mfaRequired && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
                Your previous session was reset (sign-in config changed). Please sign in again — no data was lost.
              </div>
            )}

            {!mfaRequired && (
              <>
                {/* Social login */}
                <div>
                  <Button variant="outline" onClick={() => signIn("google", { callbackUrl: "/dashboard" })} className="text-xs w-full">
                    <span className="w-4 h-4 rounded-sm bg-blue-500 text-white text-[8px] font-bold flex items-center justify-center mr-2">G</span>
                    Continue with Google
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {!mfaRequired && (
                <>
                  <div>
                    <Label htmlFor="email" className="text-xs">Email</Label>
                    <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com" className="mt-1" required />
                  </div>

                  {/* SSO discovery banner — appears once the domain is recognised */}
                  {ssoOption && (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                        <span>
                          {ssoOption.orgName ? <strong>{ssoOption.orgName}</strong> : "Your organisation"} signs in with SSO
                          {ssoOption.ssoRequired && <span className="text-muted-foreground"> · required</span>}
                        </span>
                      </div>
                      <Button type="button" size="sm" className="w-full" onClick={startSso}>
                        Continue with SSO
                      </Button>
                    </div>
                  )}

                  {/* Password — hidden when SSO is REQUIRED for this email's org */}
                  {!ssoOption?.ssoRequired && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label htmlFor="password" className="text-xs">Password</Label>
                        <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
                      </div>
                      <div className="relative">
                        <Input id="password" type={showPwd ? "text" : "password"} value={password}
                          onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="pr-10" required={!ssoOption?.ssoRequired} />
                        <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          onClick={() => setShowPwd(!showPwd)}>
                          {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {mfaRequired && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-lg bg-muted/40 border border-border">
                    <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>Signed in as <strong>{email}</strong></span>
                  </div>
                  <div>
                    <Label htmlFor="mfa-code" className="text-xs">Verification code</Label>
                    <Input
                      id="mfa-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123 456"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      className="mt-1 text-center tracking-widest text-lg"
                      maxLength={9}
                      autoFocus
                      required
                    />
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{mfaRequired ? "Verifying..." : "Signing in..."}</> : (mfaRequired ? "Verify & sign in" : "Sign In")}
              </Button>

              {mfaRequired && (
                <button
                  type="button"
                  onClick={() => { setMfaRequired(false); setMfaCode(""); setError(""); }}
                  className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
                >
                  Use a different account
                </button>
              )}
            </form>

            {!mfaRequired && (
              <p className="text-center text-xs text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="font-semibold text-primary hover:underline">Sign up</Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}