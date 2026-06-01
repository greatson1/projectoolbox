"use client";

/**
 * Tiny handoff page that bridges the WorkOS callback into a NextAuth
 * session. The WorkOS callback redirects here with a signed `token` query
 * param; we immediately call `signIn("workos-handoff", { token })` which
 * posts to NextAuth's Credentials endpoint. The "workos-handoff" provider
 * (in lib/auth.ts) verifies the token signature, loads the User row, and
 * returns it — NextAuth then writes the session cookie and the browser
 * lands on `returnTo`.
 *
 * The page itself shows a spinner during the ~200ms NextAuth handshake.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";

function SsoComplete() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const returnTo = params.get("returnTo") || "/dashboard";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Missing handoff token.");
      return;
    }
    signIn("workos-handoff", { token, callbackUrl: returnTo, redirect: true }).catch((e) => {
      setError(e.message || "Failed to complete sign-in.");
    });
  }, [token, returnTo]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center space-y-4">
        {!error ? (
          <>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Completing single sign-on…</p>
          </>
        ) : (
          <>
            <p className="text-sm text-destructive font-medium">{error}</p>
            <a href="/login" className="text-xs text-primary hover:underline">Return to login</a>
          </>
        )}
      </div>
    </div>
  );
}

export default function SsoCompletePage() {
  return (
    <Suspense fallback={null}>
      <SsoComplete />
    </Suspense>
  );
}
