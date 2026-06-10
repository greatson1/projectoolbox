"use client";

import { useState } from "react";
import { Lock, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { PaywallStatus } from "@/lib/paywall";

/**
 * Hard paywall — renders instead of the dashboard children when the org's
 * trial has expired or they have no org. Two CTAs:
 *
 *   1. Upgrade now → POST /api/billing/checkout → Stripe Checkout
 *      → on success, webhook flips org.plan and the next request renders
 *      the real dashboard.
 *   2. Manage subscription → opens Stripe Customer Portal in case the
 *      user already paid but the webhook hasn't landed yet (rare).
 *
 * Deliberately not dismissable — every product link routes back to this
 * page until the plan is paid. Bypass paths (/billing, /admin) still
 * work because the layout's isBypassed() short-circuits before
 * rendering this.
 */
export function PaywallScreen({ status }: { status: PaywallStatus }) {
  const [busy, setBusy] = useState<null | "checkout" | "portal">(null);

  async function startCheckout(planId: "STARTER" | "PROFESSIONAL" | "BUSINESS") {
    setBusy("checkout");
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "subscription", planId }),
      });
      const data = await r.json();
      if (data.data?.checkoutUrl) {
        window.location.href = data.data.checkoutUrl;
      } else {
        toast.error(data.error || "Couldn't start checkout");
        setBusy(null);
      }
    } catch (e: any) {
      toast.error(e?.message || "Checkout failed");
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    try {
      const r = await fetch("/api/billing/portal", { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await r.json();
      if (data.data?.portalUrl) {
        window.location.href = data.data.portalUrl;
      } else {
        toast.error(data.error || "Couldn't open portal");
        setBusy(null);
      }
    } catch (e: any) {
      toast.error(e?.message || "Portal unavailable");
      setBusy(null);
    }
  }

  const heading = status.kind === "no_org"
    ? "Set up your organisation"
    : "Your trial has ended";
  const subheading = status.kind === "no_org"
    ? "Complete onboarding to pick a plan and start your first project."
    : `Your free trial finished on ${("trialEndedAt" in status ? status.trialEndedAt : new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Pick a plan to keep going — your projects, agents, and history are preserved.`;

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16 bg-gradient-to-b from-background to-muted/40">
      <div className="max-w-4xl w-full">
        <div className="flex items-center justify-center mb-6">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="w-7 h-7 text-primary" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-center mb-2">{heading}</h1>
        <p className="text-center text-muted-foreground max-w-xl mx-auto mb-10">{subheading}</p>

        {status.kind !== "no_org" && (
          <div className="grid md:grid-cols-3 gap-4 mb-8">
            <PlanCard
              name="Starter"
              price="£29"
              tagline="Solo PM running one or two live projects."
              features={[
                "2 projects · 2 agents",
                "500 credits / month",
                "Autonomy L1-L2",
                "Whisper + custom meeting bot",
                "Email support",
              ]}
              cta="Choose Starter"
              onClick={() => startCheckout("STARTER")}
              disabled={busy !== null}
            />
            <PlanCard
              name="Professional"
              price="£79"
              tagline="Small PMO running multiple projects with the agent fleet."
              features={[
                "5 projects · 5 agents",
                "2,000 credits / month",
                "Autonomy L1-L3 + autonomous cycle",
                "Recall.ai live meeting bot",
                "REST API + webhooks",
              ]}
              cta="Choose Professional"
              recommended
              onClick={() => startCheckout("PROFESSIONAL")}
              disabled={busy !== null}
            />
            <PlanCard
              name="Business"
              price="£199"
              tagline="Programme-level governance with SSO and audit log."
              features={[
                "15 projects · 15 agents",
                "10,000 credits / month",
                "Everything in Professional",
                "SSO / SAML · audit log · IP allowlist",
                "Dedicated CSM + SLA",
              ]}
              cta="Choose Business"
              onClick={() => startCheckout("BUSINESS")}
              disabled={busy !== null}
            />
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          {status.kind === "no_org" ? (
            <Button size="lg" onClick={() => { window.location.href = "/onboarding"; }}>
              Go to onboarding <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={openPortal} disabled={busy !== null}>
              {busy === "portal" ? "Opening…" : "Already paid? Open Stripe portal"}
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            Questions? Reply to any Projectoolbox email and we'll get back to you.
          </p>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  name, price, tagline, features, cta, onClick, recommended, disabled,
}: {
  name: string;
  price: string;
  tagline: string;
  features: string[];
  cta: string;
  onClick: () => void;
  recommended?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-6 border ${recommended ? "border-primary bg-primary/[0.03] shadow-lg" : "border-border bg-card"}`}>
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-lg font-bold">{name}</h3>
        {recommended && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            <Sparkles className="w-3 h-3" /> Recommended
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3 leading-snug">{tagline}</p>
      <p className="text-3xl font-extrabold mb-1">{price}<span className="text-xs font-normal text-muted-foreground"> /month</span></p>
      <ul className="text-xs space-y-1.5 my-4">
        {features.map(f => (
          <li key={f} className="flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-[1px] flex-shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Button onClick={onClick} disabled={disabled} className="w-full" variant={recommended ? "default" : "outline"}>
        {cta}
      </Button>
    </div>
  );
}
