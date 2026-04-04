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

const STEPS = ["Account", "Workspace", "Plan", "First Agent"];

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
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — Account
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
    if (step === 3) return agentName.length > 0;
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

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      // 1. Save workspace config + create agent
      const onboardRes = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: { orgName, industry, role },
          plan,
          agent: { name: agentName, gradient: GRADIENTS[agentGradient].color, autonomyLevel: autonomy },
        }),
      });

      // 2. Create a default project
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${orgName || "My"} Project`,
          methodology: "HYBRID",
          description: `First project for ${orgName || "the organisation"}`,
        }),
      });

      if (projRes.ok) {
        const projData = await projRes.json();
        const projectId = projData.data?.id;

        // 3. Find the agent that was just created and deploy it
        if (projectId) {
          const agentsRes = await fetch("/api/agents");
          if (agentsRes.ok) {
            const agentsData = await agentsRes.json();
            const agent = agentsData.data?.agents?.[0];
            if (agent) {
              await fetch(`/api/agents/${agent.id}/deploy`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId }),
              });
            }
          }
        }
      }
    } catch {
      // Non-blocking — continue to dashboard even if deploy fails
    }
    setTimeout(() => { setDeploying(false); setDeployed(true); }, 3000);
  };

  const g = GRADIENTS[agentGradient];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-[480px]">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-base bg-gradient-to-br from-primary to-purple-500">PT</div>
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
                <span className="text-xs text-muted-foreground">I agree to the <a href="#" className="text-primary">Terms</a> and <a href="#" className="text-primary">Privacy Policy</a></span>
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
              <Button className="w-full" onClick={() => setStep(3)}>
                {plan === "free" ? "Get Started" : "Start Free Trial"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Agent */}
        {step === 3 && !deploying && !deployed && (
          <Card>
            <CardContent className="pt-6 space-y-5">
              <div className="text-center mb-2">
                <h1 className="text-xl font-bold">Meet your AI PM</h1>
                <p className="text-sm text-muted-foreground">Configure and deploy your first agent</p>
              </div>

              {/* Preview */}
              <div className="flex items-center gap-4 p-4 rounded-xl border border-primary/20 bg-primary/5">
                <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${g.bg} flex items-center justify-center text-xl font-bold text-white shadow-lg`}
                  style={{ boxShadow: `0 0 20px ${g.color}33` }}>
                  {agentName.charAt(0)}
                </div>
                <div>
                  <p className="text-lg font-bold">Agent {agentName}</p>
                  <p className="text-xs text-muted-foreground">Ready to deploy</p>
                </div>
              </div>

              {/* Name */}
              <div>
                <Label className="text-xs">Agent Name</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={agentName} onChange={e => setAgentName(e.target.value)} />
                  <Button variant="outline" size="sm" onClick={() => setAgentName(AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)])}><Dice1 className="w-4 h-4" /></Button>
                </div>
              </div>

              {/* Gradient */}
              <div>
                <Label className="text-xs">Avatar Colour</Label>
                <div className="flex gap-3 mt-2">
                  {GRADIENTS.map((gp, i) => (
                    <button key={i} className={`w-9 h-9 rounded-full bg-gradient-to-br ${gp.bg} transition-all ${agentGradient === i ? "scale-110 ring-2 ring-offset-2 ring-primary" : ""}`}
                      onClick={() => setAgentGradient(i)} />
                  ))}
                </div>
              </div>

              {/* Autonomy */}
              <div>
                <Label className="text-xs">Autonomy Level</Label>
                <div className="space-y-2 mt-2">
                  {AUTONOMY.map(al => (
                    <button key={al.level} className={`w-full text-left p-3 rounded-xl border transition-all ${autonomy === al.level ? "border-primary shadow-sm" : "border-border/30"}`}
                      onClick={() => setAutonomy(al.level)} style={autonomy === al.level ? { background: `${g.color}10` } : undefined}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{al.icon}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold">{al.name}</span>
                            {al.rec && <Badge variant="default" className="text-[8px]">Recommended</Badge>}
                          </div>
                          <p className="text-[11px] text-muted-foreground">{al.desc}</p>
                        </div>
                        {autonomy === al.level && <Check className="w-4 h-4 text-primary" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <Button className="w-full gap-2" onClick={handleDeploy}>
                <Rocket className="w-4 h-4" /> Deploy Agent {agentName}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Deploying */}
        {deploying && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <div className={`w-20 h-20 rounded-full bg-gradient-to-br ${g.bg} flex items-center justify-center text-3xl font-bold text-white mx-auto mb-6 animate-pulse`}
                style={{ boxShadow: `0 0 40px ${g.color}44` }}>
                {agentName.charAt(0)}
              </div>
              <p className="text-sm font-semibold text-primary mb-3">Deploying Agent {agentName}...</p>
              <div className="h-1.5 w-48 mx-auto rounded-full bg-border overflow-hidden">
                <div className="h-full bg-primary rounded-full animate-[progress_3s_ease-in-out_forwards]" style={{ width: "0%", animation: "progress 3s ease-in-out forwards" }} />
              </div>
              <style>{`@keyframes progress { 0% { width: 0% } 40% { width: 45% } 70% { width: 75% } 100% { width: 100% } }`}</style>
              <p className="text-xs text-muted-foreground mt-3">Building methodology framework...</p>
            </CardContent>
          </Card>
        )}

        {/* Deployed! */}
        {deployed && (
          <div className="text-center">
            <div className={`w-24 h-24 rounded-full bg-gradient-to-br ${g.bg} flex items-center justify-center text-4xl font-bold text-white mx-auto mb-6`}
              style={{ boxShadow: `0 0 48px ${g.color}55` }}>
              {agentName.charAt(0)}
            </div>
            <h2 className="text-2xl font-bold mb-2">You&apos;re all set! 🎉</h2>
            <p className="text-sm text-muted-foreground mb-6">Agent {agentName} is live and ready to work.</p>

            <Card className="text-left mb-6">
              <CardContent className="pt-4">
                <p className="text-sm italic text-muted-foreground">
                  &ldquo;Hi {name.split(" ")[0] || "there"}! I&apos;m Agent {agentName}, your AI Project Manager.
                  I&apos;m already analysing your workspace and building initial templates.
                  You&apos;ll have your first artefact drafts within the hour. Let&apos;s do this! 💪&rdquo;
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Link href="/dashboard"><Button className="w-full" size="lg">Go to Dashboard →</Button></Link>
              <div className="flex gap-3">
                <Link href="/agents/chat" className="flex-1"><Button variant="outline" className="w-full">💬 Chat with {agentName}</Button></Link>
                <Link href="/agents" className="flex-1"><Button variant="outline" className="w-full">View Fleet</Button></Link>
              </div>
            </div>
          </div>
        )}

        {/* Back button */}
        {step > 0 && !deploying && !deployed && (
          <button className="flex items-center gap-1 text-xs text-muted-foreground mt-4 hover:text-foreground" onClick={() => setStep(step - 1)}>
            <ChevronLeft className="w-3 h-3" /> Back
          </button>
        )}
      </div>
    </div>
  );
}
