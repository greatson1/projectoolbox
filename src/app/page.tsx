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
  { icon: Zap, title: "Any Methodology, One Platform", desc: "PRINCE2, Agile, Waterfall, SAFe, Kanban, or Hybrid — your agent adapts its governance to match how you work." },
];

const STEPS = [
  { step: "01", title: "Brief Your Agent", desc: "Tell it your project: sector, methodology, team size, and governance preferences. Takes 3 minutes.", icon: "📋" },
  { step: "02", title: "Agent Asks the Right Questions", desc: "Your PM agent clarifies scope, risks, and constraints before generating a single document — like a real PM would.", icon: "🤝" },
  { step: "03", title: "Artefacts, Plans, Reports — Handled", desc: "Risk registers, WBS, schedules, status reports. Your agent generates, tracks, and updates them. You approve.", icon: "🚀" },
];

const PLANS = [
  { name: "Free", price: 0, credits: 50, creditNote: "~5 documents/month", features: ["1 project", "1 agent", "Supervised mode (L1)", "Community support"], cta: "Get Started", popular: false },
  { name: "Starter", price: 29, credits: 500, creditNote: "~50 documents/month", features: ["3 projects", "2 agents", "Levels 1–3", "Email support", "PDF export"], cta: "Start Free Trial", popular: false },
  { name: "Professional", price: 79, credits: 2000, creditNote: "~200 documents/month", features: ["10 projects", "5 agents", "Levels 1–4", "Priority support", "All exports", "Meeting bots (Recall.ai)"], cta: "Start Free Trial", popular: true },
  { name: "Business", price: 199, credits: 10000, creditNote: "~1,000 documents/month", features: ["50 projects", "15 agents", "Levels 1–4", "SSO + SLA", "Audit log", "Dedicated CSM"], cta: "Start Free Trial", popular: false },
];

const AUTONOMY_LEVELS = [
  { level: "L1", label: "Supervised", desc: "Suggests only — you approve everything" },
  { level: "L2", label: "Assisted", desc: "Handles routine tasks, escalates decisions" },
  { level: "L3", label: "Managed", desc: "Runs phases independently with check-ins" },
  { level: "L4", label: "Autonomous", desc: "Manages end-to-end, alerts on exceptions" },
];

const FAQS = [
  { q: "How does the AI agent actually manage a project?", a: "Your agent uses Claude AI to generate artefacts, process meeting transcripts, track tasks, monitor budgets, and communicate with stakeholders. It follows your chosen methodology and escalates to you when human judgement is needed." },
  { q: "What's the difference between autonomy levels?", a: "Levels 1–4 control how independently the agent operates. L1 only suggests — you approve everything. L2 handles routine tasks and escalates decisions. L3 runs phases independently with check-ins. L4 manages end-to-end and alerts you on exceptions. You choose your level, and you can change it at any time." },
  { q: "What does 1 credit equal?", a: "Roughly 1 document or artefact generated (e.g. a risk register, status report, or WBS). Meeting transcriptions cost 1 credit per session. You can see your credit usage in real time on your dashboard." },
  { q: "Is my project data secure?", a: "All data is encrypted at rest and in transit. We're SOC 2 compliant, GDPR-ready, and offer single-tenant deployment for Enterprise customers. Your data is never used to train AI models." },
  { q: "Can agents join my actual meetings?", a: "Yes. Using Recall.ai (included from Professional), your agent joins Google Meet, Zoom, or Teams as a participant. It transcribes, extracts actions, logs decisions, and updates your project plan automatically." },
  { q: "Do I need to change my existing tools?", a: "No. Projectoolbox connects to Jira, GitHub, Slack, Teams, MS Project, and more. Your agent works alongside your existing stack — no migration, no disruption." },
  { q: "What sectors and methodologies are supported?", a: "Agents are tailored for construction, pharma, IT, defence, infrastructure, consulting, and finance. Supported methodologies include PRINCE2, PRINCE2 Agile, Scrum, SAFe, Waterfall, and Hybrid." },
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
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

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
            <Link href="/login"><Button variant="ghost" size="sm">Log In</Button></Link>
            <Link href="/signup"><Button size="sm">Start Free Trial</Button></Link>
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
              Your Projects. Delivered with AI.{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-500 to-cyan-400">
                You Stay in Control.
              </span>
            </h1>

            <p className="text-lg text-muted-foreground leading-relaxed mb-4 max-w-[620px] mx-auto">
              Projectoolbox deploys a sector-tailored AI project manager that plans, tracks, and delivers your projects —
              while you stay in control of every decision that matters.
              This is the new SaaS: <em className="text-foreground not-italic font-medium">software that does the service.</em>
            </p>
            <p className="text-sm text-muted-foreground mb-8 max-w-[500px] mx-auto">
              From the team behind the UK&apos;s leading <strong className="text-foreground">AI in Project Management</strong> training programme.
            </p>

            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link href="/signup">
                <Button size="lg" className="px-8 text-base shadow-lg shadow-primary/25">
                  Start Free Trial →
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button variant="outline" size="lg" className="px-6 text-base gap-2">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center bg-primary/10">▶</span>
                  See How It Works
                </Button>
              </a>
            </div>
            <p className="text-xs text-muted-foreground mt-4">Free plan available. No credit card required.</p>
          </div>

          {/* Dashboard preview */}
          <div className="mt-16 max-w-[900px] mx-auto rounded-2xl overflow-hidden border border-border shadow-2xl shadow-black/20 bg-card">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 h-6 rounded-md mx-12 bg-muted" />
              </div>
              <div className="flex gap-3" style={{ height: 280 }}>
                <div className="w-[180px] rounded-xl p-3 flex-shrink-0 space-y-2 bg-muted/50">
                  {["Dashboard", "Agent Chat", "Approvals", "Schedule", "Agent Fleet"].map((item, i) => (
                    <div key={item} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium ${i === 0 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                      <div className={`w-3 h-3 rounded ${i === 0 ? "bg-primary" : "bg-border"}`} />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="flex-1 space-y-3">
                  <div className="rounded-xl p-3 flex items-center gap-3 bg-primary/5 border border-primary/20">
                    <img src="/pt-logo.png" alt="Agent" className="w-10 h-10 object-contain" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-muted-foreground">Agent Alpha — PRINCE2 · Defence</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        <Badge variant="outline" className="text-[8px] bg-green-500/10 text-green-500 border-green-500/20">Active</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Generating Risk Register v3 for Project Atlas — 2 items need your approval</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[{ l: "Projects", v: "8", c: "text-primary" }, { l: "Artefacts", v: "342", c: "text-green-500" }, { l: "Pending", v: "5", c: "text-amber-500" }, { l: "Credits", v: "847", c: "text-cyan-400" }].map(s => (
                      <div key={s.l} className="rounded-lg p-2 bg-muted/50 border border-border/30">
                        <p className="text-[8px] uppercase tracking-wider text-muted-foreground">{s.l}</p>
                        <p className={`text-lg font-bold ${s.c}`}>{s.v}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl flex-1 flex items-end gap-1 px-4 pb-3 pt-2 bg-muted/50" style={{ minHeight: 100 }}>
                    {[35, 42, 38, 55, 48, 62, 58, 72, 65, 80, 74, 85].map((h, i) => (
                      <div key={i} className="flex-1 rounded-t-sm transition-all" style={{ height: `${h}%`, background: i >= 10 ? "var(--chart-3)" : `hsl(var(--primary) / ${0.4 + i * 0.05})` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="h-16 bg-gradient-to-t from-background to-transparent" />
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                  <Link href={`/signup?plan=${plan.name.toLowerCase()}`}>
                    <Button variant={plan.popular ? "default" : "outline"} className="w-full">{plan.cta}</Button>
                  </Link>
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
          <Link href="/signup">
            <Button size="lg" className="px-10 text-base shadow-lg shadow-primary/25">Start Free Trial →</Button>
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
            <div className="flex items-center gap-3">
              <input className="px-4 py-2 rounded-lg text-sm bg-background border border-input w-[220px] placeholder:text-muted-foreground" placeholder="Email for updates..." />
              <Button size="sm">Subscribe</Button>
            </div>
            <p className="text-xs text-muted-foreground">© 2026 Projectoolbox by PMGT Solutions Ltd.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
