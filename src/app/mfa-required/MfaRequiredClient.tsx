"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { MfaCard } from "@/components/settings/MfaCard";

/**
 * Locked enrollment screen — reuses the MfaCard component from the settings
 * page but presented with a "you cannot continue without this" framing.
 *
 * The MfaCard handles the full enrol → verify flow itself. Once verification
 * succeeds, the user clicks "Continue to dashboard" which triggers a hard
 * refresh — the dashboard server layout re-reads the User row, sees
 * mfaEnabled=true, and lets them through.
 */
export function MfaRequiredClient({ orgName, userEmail }: { orgName: string; userEmail: string }) {
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[560px]">
        <div className="flex items-center justify-center gap-2 mb-6">
          <img src="/pt-logo.png" alt="Projectoolbox" className="w-8 h-8 object-contain" />
          <span className="text-lg font-bold">Projectoolbox</span>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-medium text-foreground">Two-factor authentication is required</p>
                <p className="text-muted-foreground mt-0.5">
                  <strong>{orgName}</strong> requires every member to enrol a TOTP authenticator before
                  using the workspace. Set it up now to continue as <strong>{userEmail}</strong>.
                </p>
              </div>
            </div>

            <MfaCard />

            <div className="flex items-center justify-between pt-3 border-t border-border">
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Sign out
              </button>
              <Button
                size="sm"
                onClick={() => router.refresh()}
              >
                Continue to dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
