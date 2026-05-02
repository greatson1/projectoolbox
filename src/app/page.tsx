"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "next-themes";
import {
  Bot, Shield, Mic, Brain, TrendingUp, Zap,
  ChevronDown, Sun, Moon, Menu, X, Check, Star,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════

const FEATURES = [
  { icon: Bot, title: "Sector-Tailored AI Project Managers", desc: "Agents that speak your industry's language — construction, pharma, defence, IT, infrastructure. Not generic AI. Your PM." },
  { icon: Shield, title: "Governance You Can Trust", desc: "Configurable approval queues, phase gates, and budget thresholds. Your agent proposes. You decide. Always." },
  { icon: Mic, title: "Meeting Intelligence", desc: "Your agent joins calls, transcribes, extracts actions, logs decisions, and updates the plan before the call ends." },
  { icon: Brain, title: "Living Knowledge Base", desc: "Every risk, decision, artefact, and stakeholder is connected. Nothing falls through the cracks." },
  { icon: TrendingUp, title: "Earned Value & Schedule Control", desc: "Real-time EVM with SPI, CPI, and forecasts. Your agent spots cost and schedule variance before it becomes a problem." },
  { icon: Zap, title: "Any Methodology, One Platform", desc: "Traditional (PMI-Style), Scrum, Waterfall, SAFe, Kanban, or Hybrid — your agent adapts its governance to match how you work." },
];

const STEPS = [
  { step: "01", title: "Brief Your Agent", desc: "Tell it your project: sector, methodology, team size, and governance preferences. Takes 3 minutes.", icon: "📋" },
  { step: "02", title: "Agent Asks the Right Questions", desc: "Your PM agent clarifies scope, risks, and constraints before generating a single document — like a real PM would.", icon: "🤝" },
  { step: "03", title: "Artefacts, Plans, Reports — Handled", desc: "Risk registers, WBS, schedules, status reports. Your agent generates, tracks, and updates them. You approve.", icon: "🚀" },
];

const PLANS = [
  { name: "Free", price: 0, credits: 50, creditNote: "~5 documents/month", features: ["1 project", "1 agent", "Advisor mode (L1)", "Community support"], cta: "Join Waitlist", popular: false },
  { name: "Starter", price: 29, credits: 500, creditNote: "~50 documents/month", features: ["3 projects", "2 agents", "Levels 1–2", "Email support", "PDF export"], cta: "Join Waitlist", popular: false },
  { name: "Professional", price: 79, credits: 2000, creditNote: "~200 documents/month", features: ["10 projects", "5 agents", "Levels 1–3", "Priority support", "All exports", "Meeting bots (Recall.ai)"], cta: "Join Waitlist", popular: true },
  { name: "Business", price: 199, credits: 10000, creditNote: "~1,000 documents/month", features: ["50 projects", "15 agents", "Levels 1–3", "SSO + SLA", "Audit log", "Dedicated CSM"], cta: "Join Waitlist", popular: false },
];

const AUTONOMY_LEVELS = [
  { level: "L1", label: "Advisor", desc: "Suggests only — you approve everything" },
  { level: "L2", label: "Co-pilot", desc: "Handles routine tasks, escalates decisions" },
  { level: "L3", label: "Autonomous", desc: "Runs the project end-to-end, alerts on exceptions" },
];

const FAQS = [
  { q: "How does the AI agent actually manage a project?", a: "Your agent uses Claude AI to generate artefacts, process meeting transcripts, track tasks, monitor budgets, and communicate with stakeholders. It follows your chosen methodology and escalates to you when human judgement is needed." },
  { q: "What's the difference between autonomy levels?", a: "Levels 1–3 control how independently the agent operates. L1 (Advisor) only suggests — you approve everything. L2 (Co-pilot) handles routine tasks and escalates decisions. L3 (Autonomous) runs the project end-to-end and alerts you on exceptions. You choose your level, and you can change it at any time." },
  { q: "What does 1 credit equal?", a: "Roughly 1 document or artefact generated (e.g. a risk register, status report, or WBS). Meeting transcriptions cost 1 credit per session. You can see your credit usage in real time on your dashboard." },
  { q: "Is my project data secure?", a: "All data is encrypted at rest and in transit. We're SOC 2 compliant, GDPR-ready, and offer single-tenant deployment for Enterprise customers. Your data is never used to train AI models." },
  { q: "Can agents join my actual meetings?", a: "Yes. Using Recall.ai (included from Professional), your agent joins Google Meet, Zoom, or Teams as a participant. It transcribes, extracts actions, logs decisions, and updates your project plan automatically." },
  { q: "Do I need to change my existing tools?", a: "No. Projectoolbox connects to Jira, GitHub, Slack, Teams, MS Project, and more. Your agent works alongside your existing stack — no migration, no disruption." },
  { q: "What sectors and methodologies are supported?", a: "Agents are tailored for construction, pharma, IT, defence, infrastructure, consulting, and finance. Supported methodologies include Traditional (PMI-Style), Scrum, Kanban, SAFe, Waterfall, and Hybrid." },
];

const LOGOS = [
  { name: "Construction" }, { name: "Pharma & Life Sciences" }, { name: "Defence" },
  { name: "Infrastructure" }, { name: "Consulting" }, { name: "Technology" },
];

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function LandingPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterState, setNewsletterState] = useState<"idle" | "loading" | "done" | "error">("idle");
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  async function handleNewsletterSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newsletterEmail.trim()) return;
    setNewsletterState("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newsletterEmail.trim(), sector: "newsletter" }),
      });
      if (!res.ok) { setNewsletterState("error"); return; }
      setNewsletterState("done");
      setNewsletterEmail("");
    } catch {
      setNewsletterState("error");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ═══ NAV ═══ */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/90 backdrop-blur-md border-b border-border" : ""}`}>
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/pt-logo.png" alt="Projectoolbox" className="w-8 h-8 object-contain" />
            <span className="text-lg font-bold">Projectoolbox</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {!mounted || theme !== "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </Button>
            {/* Waitlist phase — homepage does NOT expose a direct login path.
                Both header CTAs route to /waitlist; existing-user sign-in is
                still reachable from the waitlist page itself for invited
                users. */}
            <Link href="/waitlist"><Button variant="ghost" size="sm">Get Early Access</Button></Link>
            <Link href="/waitlist"><Button size="sm">Join Waitlist</Button></Link>
            <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setMobileMenu(!mobileMenu)}>
              {mobileMenu ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        {/* Mobile Menu */}
        {mobileMenu && (
          <div className="md:hidden bg-background/95 backdrop-blur-md border-b border-border px-6 py-4 space-y-3">
            <a href="#features" className="block text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMobileMenu(false)}>Features</a>
            <a href="#how-it-works" className="block text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMobileMenu(false)}>How It Works</a>
            <a href="#pricing" className="block text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMobileMenu(false)}>Pricing</a>
            <a href="#faq" className="block text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMobileMenu(false)}>FAQ</a>
          </div>
        )}
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full opacity-20 blur-[120px] bg-gradient-to-br from-primary via-purple-500 to-cyan-400" />
        <div className="max-w-[1200px] mx-auto relative z-10 text-center">
          <div className="max-w-[760px] mx-auto">
            <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
              <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Early Access — Join 500+ PMs on the waitlist
              </Badge>
              <Badge variant="outline" className="bg-cyan-500/5 border-cyan-500/20 text-cyan-400 gap-1.5 text-[11px]">
                <span className="font-bold">SaaS 2.0</span>
                <span className="text-muted-foreground">· Service as Software</span>
              </Badge>
            </div>

            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground mb-3">
              AI Project Management Platform
            </p>

            <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.05] mb-6">
              Your Projects.{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-500 to-cyan-400">
                Delivered with AI.
              </span>
            </h1>

            <p className="text-lg text-muted-foreground leading-relaxed mb-4 max-w-[620px] mx-auto">
              Projectoolbox deploys a sector-tailored AI project manager that plans, tracks, and delivers —
              so you focus on the decisions that move things forward.
              This is the new SaaS: <em className="text-foreground not-italic font-medium">software that does the service.</em>
            </p>
            <p className="text-sm text-muted-foreground mb-8 max-w-[500px] mx-auto">
              From the team behind the <strong className="text-foreground">AI-Enabled Project Manager (AIPM)</strong>.
            </p>

            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link href="/waitlist">
                <Button size="lg" className="px-8 text-base shadow-lg shadow-primary/25">
                  Join the Waitlist →
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button variant="outline" size="lg" className="px-6 text-base gap-2">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center bg-primary/10">▶</span>
                  See How It Works
                </Button>
              </a>
            </div>
            <p className="text-xs text-muted-foreground mt-4">Free plan included. No credit card required when you get access.</p>
          </div>

          {/* Dashboard preview */}
          <div className="mt-16 max-w-[960px] mx-auto rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/40" style={{ background: "#0f1117" }}>
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10" style={{ background: "#0a0c10" }}>
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <div className="flex-1 mx-6 h-5 rounded-md text-[10px] flex items-center px-3 text-white/20" style={{ background: "#1a1d24" }}>
                app.projectoolbox.com/dashboard
              </div>
            </div>

            <div className="flex" style={{ height: 340 }}>
              {/* Sidebar */}
              <div className="flex-shrink-0 flex flex-col border-r border-white/10" style={{ width: 200, background: "#0a0c10" }}>
                {/* Logo */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
                  <img src="/pt-logo.png" alt="Projectoolbox" className="w-6 h-6 object-contain" />
                  <span className="text-[11px] font-bold text-white">Projectoolbox</span>
                </div>
                {/* Nav */}
                <div className="flex-1 overflow-hidden px-2 py-2 space-y-3">
                  {/* top */}
                  <div>
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: "rgba(99,102,241,0.15)" }}>
                      <div className="w-3 h-3 rounded-sm" style={{ background: "#6366f1" }} />
                      <span className="text-[10px] font-semibold text-indigo-400">Dashboard</span>
                    </div>
                  </div>
                  {/* AI AGENTS */}
                  <div>
                    <p className="text-[8px] font-bold tracking-widest px-2 mb-1" style={{ color: "#ffffff30" }}>AI AGENTS</p>
                    {[["Fleet Overview", "#6366f1"], ["Chat with Agent", "#8b5cf6"], ["Approvals", "#f59e0b"]].map(([label, color]) => (
                      <div key={label} className="flex items-center gap-2 px-2 py-1 rounded-md">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color + "60" }} />
                        <span className="text-[10px] font-medium" style={{ color: "#ffffff60" }}>{label}</span>
                      </div>
                    ))}
                  </div>
                  {/* WORKSPACE */}
                  <div>
                    <p className="text-[8px] font-bold tracking-widest px-2 mb-1" style={{ color: "#ffffff30" }}>WORKSPACE</p>
                    {[["Portfolio", "#10b981"], ["Projects", "#3b82f6"], ["Meetings", "#ec4899"]].map(([label, color]) => (
                      <div key={label} className="flex items-center gap-2 px-2 py-1 rounded-md">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color + "60" }} />
                        <span className="text-[10px] font-medium" style={{ color: "#ffffff60" }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Bottom credits */}
                <div className="px-3 py-2 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px]" style={{ color: "#ffffff40" }}>Credits</span>
                    <span className="text-[10px] font-bold text-cyan-400">847</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full" style={{ background: "#ffffff15" }}>
                    <div className="h-1 rounded-full" style={{ width: "68%", background: "linear-gradient(to right, #6366f1, #06b6d4)" }} />
                  </div>
                </div>
              </div>

              {/* Main content */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/10" style={{ background: "#0d0f16" }}>
                  <div>
                    <p className="text-[13px] font-bold text-white">Dashboard</p>
                    <p className="text-[9px]" style={{ color: "#ffffff50" }}>Tuesday, 14 April 2026</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10" style={{ background: "#1a1d24" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-[9px] text-green-400 font-medium">3 agents active</span>
                    </div>
                    <div className="w-6 h-6 rounded-full bg-indigo-500/30 flex items-center justify-center">
                      <span className="text-[9px] text-indigo-400 font-bold">PM</span>
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-2 px-4 pt-3">
                  {[
                    { l: "Projects", v: "8", sub: "2 at risk", c: "#6366f1" },
                    { l: "Pending Approvals", v: "5", sub: "action needed", c: "#f59e0b" },
                    { l: "Artefacts", v: "342", sub: "this month", c: "#10b981" },
                    { l: "Schedule Health", v: "87%", sub: "SPI 0.94", c: "#06b6d4" },
                  ].map(s => (
                    <div key={s.l} className="rounded-lg p-2.5 border border-white/10" style={{ background: "#1a1d24" }}>
                      <p className="text-[8px] uppercase tracking-wider mb-1" style={{ color: "#ffffff50" }}>{s.l}</p>
                      <p className="text-base font-bold" style={{ color: s.c }}>{s.v}</p>
                      <p className="text-[8px]" style={{ color: "#ffffff30" }}>{s.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Agent activity + project list */}
                <div className="flex gap-3 px-4 pt-3 flex-1 overflow-hidden">
                  {/* Agent card */}
                  <div className="flex-1 rounded-xl p-3 border border-indigo-500/20 flex flex-col gap-2" style={{ background: "rgba(99,102,241,0.06)" }}>
                    <div className="flex items-center gap-2">
                      <img src="/pt-logo.png" alt="Agent" className="w-7 h-7 object-contain" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-white">Agent Alpha</span>
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">Active</span>
                        </div>
                        <p className="text-[8px]" style={{ color: "#ffffff50" }}>Traditional · Defence</p>
                      </div>
                    </div>
                    {[
                      { text: "Risk Register v3 generated for Project Atlas", time: "2m ago", dot: "#10b981" },
                      { text: "2 approvals waiting — Scope Change CR-041", time: "8m ago", dot: "#f59e0b" },
                      { text: "Stakeholder report drafted — ready to send", time: "15m ago", dot: "#6366f1" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: item.dot }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] text-white/70 leading-tight">{item.text}</p>
                          <p className="text-[8px]" style={{ color: "#ffffff30" }}>{item.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Projects mini-table */}
                  <div className="w-[230px] rounded-xl border border-white/10 flex flex-col overflow-hidden" style={{ background: "#1a1d24" }}>
                    <div className="px-3 py-2 border-b border-white/10">
                      <p className="text-[10px] font-bold text-white">Active Projects</p>
                    </div>
                    {[
                      { name: "Project Atlas", phase: "Execution", status: "On Track", sc: "#10b981" },
                      { name: "Pharma Suite", phase: "Planning", status: "At Risk", sc: "#f59e0b" },
                      { name: "InfraX Build", phase: "Closure", status: "Delayed", sc: "#ef4444" },
                      { name: "GovDigital", phase: "Initiation", status: "On Track", sc: "#10b981" },
                    ].map((p) => (
                      <div key={p.name} className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                        <div>
                          <p className="text-[9px] font-semibold text-white/80">{p.name}</p>
                          <p className="text-[8px]" style={{ color: "#ffffff30" }}>{p.phase}</p>
                        </div>
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: p.sc + "20", color: p.sc }}>{p.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="h-12 bg-gradient-to-t from-background to-transparent" />
          </div>
        </div>
      </section>

      {/* ═══ SOCIAL PROOF BAR ═══ */}
      <section className="py-12 px-6 border-y border-border/30">
        <div className="max-w-[1200px] mx-auto text-center">
          <p className="text-sm text-muted-foreground mb-6">
            Sector-tailored agents for every industry
          </p>
          <div className="flex items-center justify-center gap-8 flex-wrap opacity-70">
            {LOGOS.map(l => (
              <span key={l.name} className="text-sm font-semibold tracking-wide text-muted-foreground border border-border/40 px-3 py-1 rounded-full">{l.name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section id="features" className="py-20 px-6 scroll-mt-20">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Features</p>
            <h2 className="text-4xl font-bold mt-2">Built for how real PMs work</h2>
            <p className="text-base text-muted-foreground mt-3 max-w-[500px] mx-auto">Not a chat interface bolted onto a spreadsheet. A genuine AI project manager with methodology, governance, and sector knowledge built in.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <Card key={f.title} className="hover:-translate-y-1 transition-all">
                <CardContent className="pt-6">
                  <f.icon className="w-8 h-8 text-primary mb-3" />
                  <h3 className="text-base font-bold mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section id="how-it-works" className="py-20 px-6 bg-muted/30 scroll-mt-20">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">How It Works</p>
            <h2 className="text-4xl font-bold mt-2">Your agent is live in under 5 minutes</h2>
            <p className="text-base text-muted-foreground mt-3 max-w-[500px] mx-auto">No migration. No training data. No setup fees. Just tell it about your project.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={s.step} className="text-center relative">
                {i < STEPS.length - 1 && <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px bg-border" />}
                <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl border-2 border-primary/30 bg-primary/10">{s.icon}</div>
                <p className="text-xs font-bold uppercase tracking-widest text-primary">Step {s.step}</p>
                <h3 className="text-lg font-bold mt-1 mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground max-w-[280px] mx-auto">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ INTEGRATIONS ═══ */}
      <section id="integrations" className="py-20 px-6 scroll-mt-20">
        <div className="max-w-[1200px] mx-auto text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Integrations</p>
          <h2 className="text-3xl font-bold mb-4">Connects to the tools your team already uses</h2>
          <p className="text-muted-foreground text-lg mb-12 max-w-xl mx-auto">
            Your PM agent plugs straight into Jira, MS Project, SAP and more — no manual data entry, no migration.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
            {[
              { name: "Jira", color: "#0052CC", abbr: "J" },
              { name: "MS Project", color: "#217346", abbr: "MSP" },
              { name: "Slack", color: "#4A154B", abbr: "Sl" },
              { name: "Teams", color: "#6264A7", abbr: "T" },
              { name: "SAP", color: "#0070F2", abbr: "SAP" },
              { name: "Azure DevOps", color: "#0078D4", abbr: "ADO" },
              { name: "Google Drive", color: "#34A853", abbr: "GD" },
              { name: "Zoom", color: "#2D8CFF", abbr: "Z" },
              { name: "Google Meet", color: "#00897B", abbr: "GM" },
              { name: "Salesforce", color: "#00A1E0", abbr: "SF" },
              { name: "GitHub", color: "#24292F", abbr: "GH" },
              { name: "Notion", color: "#000000", abbr: "N" },
            ].map(int => (
              <div key={int.name} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/30 hover:border-primary/40 hover:bg-muted/30 transition-all group">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ background: int.color }}>
                  {int.abbr}
                </div>
                <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">{int.name}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-8">
            + more via MCP — <Link href="/integrations" className="text-primary font-semibold hover:underline">see all integrations</Link>
          </p>
        </div>
      </section>

      {/* ═══ PRICING ═══ */}
      <section id="pricing" className="py-20 px-6 bg-muted/30 scroll-mt-20">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Pricing</p>
            <h2 className="text-4xl font-bold mt-2">Simple, credit-based pricing</h2>
            <p className="text-base text-muted-foreground mt-3">Start free. Scale as your portfolio grows. No hidden fees.</p>
          </div>

          {/* Autonomy level explainer */}
          <div className="max-w-[800px] mx-auto mb-10 rounded-xl border border-border/40 bg-card p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Autonomy Levels Explained</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {AUTONOMY_LEVELS.map(a => (
                <div key={a.level} className="text-center">
                  <div className="text-sm font-bold text-primary">{a.level}</div>
                  <div className="text-xs font-semibold mb-1">{a.label}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">{a.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-[1100px] mx-auto">
            {PLANS.map(plan => (
              <Card key={plan.name} className={`hover:-translate-y-1 transition-all ${plan.popular ? "border-2 border-primary shadow-lg shadow-primary/10" : ""}`}>
                {plan.popular && (
                  <div className="text-center py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground bg-gradient-to-r from-primary to-purple-500">Most Popular</div>
                )}
                <CardContent className="pt-5">
                  <h3 className="text-lg font-bold">{plan.name}</h3>
                  <div className="mb-1">
                    <span className="text-3xl font-extrabold">{plan.price === 0 ? "Free" : `$${plan.price}`}</span>
                    {plan.price > 0 && <span className="text-sm text-muted-foreground">/mo</span>}
                  </div>
                  <p className="text-xs text-primary font-semibold">{plan.credits.toLocaleString()} credits/month</p>
                  <p className="text-[10px] text-muted-foreground mb-4">{plan.creditNote}</p>
                  <ul className="space-y-2 mb-5">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-muted-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/waitlist"><Button variant={plan.popular ? "default" : "outline"} className="w-full">Join Waitlist</Button></Link>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-6">
            Need unlimited? <Link href="/contact" className="text-primary font-semibold">Contact us for Enterprise pricing</Link>
          </p>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-20 px-6 scroll-mt-20">
        <div className="max-w-[720px] mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">FAQ</p>
            <h2 className="text-4xl font-bold mt-2">Common questions</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <Card key={i} className={openFaq === i ? "border-primary/30" : ""}>
                <button className="w-full text-left px-5 py-4 flex items-center justify-between" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span className="text-sm font-semibold pr-4">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="py-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-gradient-to-br from-primary via-purple-500 to-cyan-400" />
        <div className="max-w-[600px] mx-auto text-center relative z-10">
          <h2 className="text-3xl font-bold mb-4">Your projects. Delivered with AI. On your terms.</h2>
          <p className="text-base text-muted-foreground mb-2">Start free — no credit card required. Your first agent is live in under 5 minutes.</p>
          <p className="text-sm text-muted-foreground mb-8">You choose the autonomy level. You approve what matters. You stay in control.</p>
          <Link href="/waitlist">
            <Button size="lg" className="px-10 text-base shadow-lg shadow-primary/25">Join the Waitlist →</Button>
          </Link>
          <p className="text-xs text-muted-foreground mt-4">
            Building a team? <Link href="/contact" className="text-primary font-semibold hover:underline">Talk to us about Enterprise</Link>
          </p>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-12 px-6 bg-muted/30 border-t border-border">
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <img src="/pt-logo.png" alt="Projectoolbox" className="w-7 h-7 object-contain" />
                <span className="text-base font-bold">Projectoolbox</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">AI project management for teams that demand governance. By PMGT Solutions Ltd.</p>
            </div>
            {[
              { title: "Product", links: [
                { label: "Features", href: "#features" },
                { label: "Pricing", href: "#pricing" },
                { label: "Integrations", href: "/integrations" },
                { label: "Changelog", href: "/changelog" },
              ]},
              { title: "Company", links: [
                { label: "About", href: "/about" },
                { label: "Blog", href: "/blog" },
                { label: "Careers", href: "/careers" },
                { label: "Contact", href: "/contact" },
              ]},
              { title: "Training", links: [
                { label: "AI in PM Course", href: "https://www.pmgts.co.uk", },
                { label: "Webinars", href: "/webinars" },
                { label: "Community", href: "/community" },
                { label: "Docs", href: "/docs" },
              ]},
              { title: "Legal", links: [
                { label: "Privacy", href: "/legal/privacy" },
                { label: "Terms", href: "/legal/terms" },
                { label: "GDPR", href: "/legal/gdpr" },
                { label: "Security", href: "/legal/security" },
              ]},
            ].map(col => (
              <div key={col.title}>
                <p className="text-xs font-bold uppercase tracking-wider mb-3">{col.title}</p>
                <ul className="space-y-2">
                  {col.links.map(link => <li key={link.label}><Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">{link.label}</Link></li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-8 border-t border-border flex-wrap gap-4">
            <form onSubmit={handleNewsletterSubmit} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <input
                  type="email"
                  value={newsletterEmail}
                  onChange={e => { setNewsletterEmail(e.target.value); setNewsletterState("idle"); }}
                  disabled={newsletterState === "loading" || newsletterState === "done"}
                  className="px-4 py-2 rounded-lg text-sm bg-background border border-input w-[220px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                  placeholder="Email for updates..."
                />
                <Button size="sm" type="submit" disabled={newsletterState === "loading" || newsletterState === "done"}>
                  {newsletterState === "loading" ? "..." : newsletterState === "done" ? "Subscribed ✓" : "Subscribe"}
                </Button>
              </div>
              {newsletterState === "error" && (
                <p className="text-xs text-destructive">Something went wrong — please try again.</p>
              )}
            </form>
            <p className="text-xs text-muted-foreground">© 2026 Projectoolbox by PMGT Solutions Ltd.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
