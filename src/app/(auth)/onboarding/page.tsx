// @ts-nocheck
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Rocket } from "lucide-react";

const INDUSTRIES = [
  "Technology / Software", "Consulting / Professional Services", "Construction / Engineering",
  "Financial Services", "Healthcare", "Government / Public Sector", "Education",
  "Manufacturing", "Retail / E-commerce", "Media / Entertainment", "Other",
];

export default function OnboardingPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    if (!orgName.trim()) return;
    setLoading(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: { orgName: orgName.trim(), industry, role },
        }),
      });
    } catch {}
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-[480px]">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-sm font-bold">PT</div>
          <span className="text-lg font-bold">Projectoolbox</span>
        </div>

        <Card>
          <CardContent className="p-8">
            <div className="text-center mb-6">
              <h1 className="text-xl font-bold">Welcome to Projectoolbox</h1>
              <p className="text-sm text-muted-foreground mt-1">Set up your workspace to get started</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Organisation Name</label>
                <Input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="e.g. Acme Corp" className="mt-1" />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Industry</label>
                <select value={industry} onChange={e => setIndustry(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none">
                  <option value="">Select industry</option>
                  {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Your Role</label>
                <Input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Project Manager, PMO Director" className="mt-1" />
              </div>

              <Button className="w-full" onClick={handleComplete} disabled={loading || !orgName.trim()}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Setting up...</> : <><Rocket className="w-4 h-4 mr-2" />Launch Workspace</>}
              </Button>

              <button onClick={() => router.push("/dashboard")} className="w-full text-xs text-muted-foreground hover:text-foreground text-center">
                Skip for now
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
