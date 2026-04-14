"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Wrap in Suspense for useSearchParams SSR compat
export default function SignupPageWrapper() {
  return <Suspense fallback={null}><SignupPageInner /></Suspense>;
}

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Eye, EyeOff, Check, ChevronLeft, Rocket, Dice1 } from "lucide-react";
import { signIn } from "next-auth/react";

const STEPS = ["Account", "Workspace", "Plan"];

const PLANS = [
  { id: "free", name: "Free", price: 0, credits: 50, highlight: "1 project, 1 agent" },
  { id: "starter", name: "Starter", price: 29, credits: 500, highlight: "3 projects, 2 agents" },
  { id: "professional", name: "Professional", price: 79, credits: 2000, highlight: "10 projects, 5 agents", popular: true },
  { id: "business", name: "Business", price: 199, credits: 10000, highlight: "50 projects, 15 agents" },
];

const INDUSTRIES = ["Technology", "Construction", "Finance", "Healthcare", "Government", "Consulting", "Manufacturing", "Education", "Other"];
const ROLES = ["Project Manager", "Programme Director", "PMO Lead", "Scrum Master", "CTO / VP Eng", "Consultant", "Other"];
const AGENT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Falcon", "Griffin", "Hawk"];
const GRADIENTS = [
  { bg: "from-indigo-500 to-purple-500", color: "#6366F1" },
  { bg: "from-cyan-400 to-blue-500", color: "#22D3EE" },
  { bg: "from-emerald-400 to-green-500", color: "#10B981" },
  { bg: "from-orange-400 to-amber-500", color: "#F97316" },
  { bg: "from-pink-400 to-rose-500", color: "#EC4899" },
  { bg: "from-violet-400 to-purple-500", color: "#8B5CF6" },
];

const AUTONOMY = [
  { level: 2, name: "Guided", icon: "🛡️", tag: "You approve everything", desc: "Agent drafts, you execute. Perfect for getting comfortable." },
  { level: 3, name: "Balanced", icon: "⚖️", tag: "Routine is automated", desc: "Handles status reports, risk scans auto. Escalates big decisions.", rec: true },
  { level: 4, name: "Autonomous", icon: "🚀", tag: "AI runs the project", desc: "Most decisions independent. You get weekly summaries." },
];

function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Invite gate ───────────────────────────────────────────────────────────
  // During waitlist phase, signup requires a valid invite token.
  // Set NEXT_PUBLIC_INVITE_ONLY=true in env to enable.
  const inviteOnly = process.env.NEXT_PUBLIC_INVITE_ONLY === "true";
  const inviteToken = searchParams.get("invite");
  const prefilledEmail = searchParams.get("email") || "";

  if (inviteOnly && !inviteToken) {
    // Redirect to waitlist — don't render the form at all
    router.replace("/waitlist");
    return null;
  }

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — Account
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [agreed, setAgreed] = useState(false);

  // Step 2 — Workspace
  const [orgName, setOrgName] = useState("");
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");

  // Step 3 — Plan
  const [plan, setPlan] = useState(searchParams.get("plan") || "professional");

  // Step 4 — Agent
  const [agentName, setAgentName] = useState(AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)]);
  const [agentGradient, setAgentGradient] = useState(0);
  const [autonomy, setAutonomy] = useState(3);

  // Deploy state
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);

  const pwdChecks = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)];
  const pwdStrength = pwdChecks.filter(Boolean).length;

  const canProceed = (() => {
    if (step === 0) return name.length > 1 && email.includes("@") && password.length >= 8 && agreed;
    if (step === 1) return orgName.length > 1;
    if (step === 2) return !!plan;
    return true;
  })();

  const handleSignup = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Sign in immediately after registration
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) throw new Error("Account created but sign-in failed. Please log in manually.");
      setStep(1);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleComplete = async () => {
    setDeploying(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: { orgName, industry, role },
          plan,
        }),
      });
    } catch {
      // Non-blocking — continue to dashboard
    }
    setDeploying(false);
    router.push("/dashboard");
  };

  const g = GRADIENTS[agentGradient];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-[480px]">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <img src="/pt-logo.png" alt="Projectoolbox" className="w-9 h-9 object-contain" />
          <span className="text-lg font-bold">Projectoolbox</span>
        </div>

        {/* Progress */}
        {!deployed && (
          <div className="flex items-center gap-1 mb-6">
            {STEPS.map((s, i) => (
              <div key={i} className="flex-1">
                <div className={`h-1 rounded-full transition-all ${i < step ? "bg-green-500" : i === step ? "bg-primary" : "bg-border"}`} />
                <p className={`text-[9px] font-semibold mt-1 text-center ${i === step ? "text-foreground" : "text-muted-foreground"}`}>{s}</p>
              </div>
            ))}
          </div>
        )}

        {/* Step 1: Account */}
        {step === 0 && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center mb-2">
                <h1 className="text-xl font-bold">Create your account</h1>
                <p className="text-sm text-muted-foreground">Start your 14-day free trial</p>
              </div>

              <div>
                <Button variant="outline" className="text-xs w-full" onClick={() => { import("next-auth/react").then(m => m.signIn("google", { callbackUrl: "/dashboard" })); }}>
                  <span className="w-4 h-4 rounded-sm bg-blue-500 text-white text-[8px] font-bold flex items-center justify-center mr-2">G</span>Continue with Google
                </Button>
              </div>

              <div className="flex items-center gap-3"><div className="flex-1 h-px bg-border" /><span className="text-xs text-muted-foreground">or</span><div className="flex-1 h-px bg-border" /></div>

              <div><Label className="text-xs">Full Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Sarah Chen" className="mt-1" /></div>
              <div><Label className="text-xs">Work Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="sarah@company.com" className="mt-1" /></div>
              <div className="relative">
                <Label className="text-xs">Password</Label>
                <Input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" className="mt-1 pr-10" />
                <button type="button" className="absolute right-3 top-[30px] text-muted-foreground" onClick={() => setShowPwd(!showPwd)}>
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password.length > 0 && (
                <div>
                  <div className="flex gap-1">{[0, 1, 2, 3].map(i => <div key={i} className={`flex-1 h-1 rounded-full ${i < pwdStrength ? (pwdStrength >= 3 ? "bg-green-500" : pwdStrength >= 2 ? "bg-primary" : "bg-amber-500") : "bg-border"}`} />)}</div>
                  <p className="text-[10px] mt-0.5" style={{ color: pwdStrength >= 3 ? "#10B981" : pwdStrength >= 2 ? "var(--primary)" : "#F59E0B" }}>
                    {["", "Weak", "Fair", "Good", "Strong"][pwdStrength]}
                  </p>
                </div>
              )}

              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-primary" />
                <span className="text-xs text-muted-foreground">I agree to the <Link href="/legal/terms" className="text-primary hover:underline" target="_blank" rel="noopener">Terms</Link> and <Link href="/legal/privacy" className="text-primary hover:underline" target="_blank" rel="noopener">Privacy Policy</Link></span>
              </label>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button className="w-full" disabled={!canProceed || loading} onClick={handleSignup}>
                {loading ? "Creating..." : "Create Account"}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Already have an account? <Link href="/login" className="font-semibold text-primary">Log in</Link>
              </p>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Workspace */}
        {step === 1 && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center mb-2">
                <h1 className="text-xl font-bold">Set up your workspace</h1>
                <p className="text-sm text-muted-foreground">Tell us about your organisation</p>
              </div>
              <div><Label className="text-xs">Organisation Name</Label><Input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Atlas Corp" className="mt-1" /></div>
              <div>
                <Label className="text-xs">Industry</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">{INDUSTRIES.map(ind => (
                  <button key={ind} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${industry === ind ? "border-primary bg-primary/10 text-primary" : "border-border/30 text-muted-foreground"}`}
                    onClick={() => setIndustry(ind)}>{ind}</button>
                ))}</div>
              </div>
              <div>
                <Label className="text-xs">Your Role</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">{ROLES.map(r => (
                  <button key={r} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${role === r ? "border-primary bg-primary/10 text-primary" : "border-border/30 text-muted-foreground"}`}
                    onClick={() => setRole(r)}>{r}</button>
                ))}</div>
              </div>
              <Button className="w-full" disabled={!canProceed} onClick={() => setStep(2)}>Continue</Button>
              <button className="w-full text-xs text-muted-foreground hover:text-foreground" onClick={() => setStep(2)}>Skip for now</button>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Plan */}
        {step === 2 && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center mb-2">
                <h1 className="text-xl font-bold">Choose your plan</h1>
                <p className="text-sm text-muted-foreground">14-day free trial. Cancel anytime.</p>
              </div>
              <div className="space-y-2">
                {PLANS.map(p => (
                  <button key={p.id} className={`w-full text-left p-3 rounded-xl border transition-all ${plan === p.id ? "border-primary shadow-md shadow-primary/10" : "border-border/30"}`}
                    onClick={() => setPlan(p.id)} style={plan === p.id ? { background: `${GRADIENTS[0].color}08` } : undefined}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{p.name}</span>
                          {p.popular && <Badge variant="default" className="text-[8px]">Most Popular</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{p.highlight}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-bold">{p.price === 0 ? "Free" : `$${p.price}`}</span>
                        {p.price > 0 && <span className="text-xs text-muted-foreground">/mo</span>}
                        <p className="text-[10px] text-primary">{p.credits} credits</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <Button className="w-full" onClick={handleComplete} disabled={deploying}>
                {deploying ? "Setting up..." : plan === "free" ? "Get Started →" : "Start Free Trial →"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Back button */}
        {step > 0 && !deploying && (
          <button className="flex items-center gap-1 text-xs text-muted-foreground mt-4 hover:text-foreground" onClick={() => setStep(step - 1)}>
            <ChevronLeft className="w-3 h-3" /> Back
          </button>
        )}
      </div>
    </div>
  );
}
