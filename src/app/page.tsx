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
  { icon: Bot, title: "Deploy AI Project Managers", desc: "Autonomous PM agents that plan, track, and manage projects end-to-end — 24/7." },
  { icon: Shield, title: "Human-in-the-Loop Governance", desc: "Configurable approval queues, phase gates, and budget thresholds. AI decides, you approve." },
  { icon: Mic, title: "Meeting Intelligence", desc: "Agents join calls, transcribe, extract actions, log decisions, and update the plan automatically." },
  { icon: Brain, title: "Knowledge Base", desc: "Obsidian-inspired bidirectional linking. Every risk, decision, and artefact is connected." },
  { icon: TrendingUp, title: "Earned Value & Schedule Tracking", desc: "Real-time EVM with SPI, CPI, forecasts. Your agent spots variances before they become problems." },
  { icon: Zap, title: "Any Methodology, One Platform", desc: "Scrum, PRINCE2, Waterfall, SAFe, Kanban, or Hybrid — your agent adapts its governance." },
];

const STEPS = [
  { step: "01", title: "Create Your Project", desc: "Define scope, budget, timeline. Our wizard makes it effortless.", icon: "📋" },
  { step: "02", title: "Configure Your Agent", desc: "Name your AI PM, set autonomy level, communication style.", icon: "⚙️" },
  { step: "03", title: "Let AI Manage", desc: "Your agent generates artefacts, tracks risks, attends meetings — autonomously.", icon: "🚀" },
];

const PLANS = [
  { name: "Free", price: 0, credits: 50, features: ["1 project", "1 agent", "L1 only", "Community support"], cta: "Get Started", popular: false },
  { name: "Starter", price: 29, credits: 500, features: ["3 projects", "2 agents", "L1–L3", "Email support", "PDF export"], cta: "Start Free Trial", popular: false },
  { name: "Professional", price: 79, credits: 2000, features: ["10 projects", "5 agents", "L1–L4", "Priority support", "All exports", "Recall.ai bots"], cta: "Start Free Trial", popular: true },
  { name: "Business", price: 199, credits: 10000, features: ["50 projects", "15 agents", "L1–L5", "SSO + SLA", "Audit log", "Dedicated CSM"], cta: "Start Free Trial", popular: false },
];

const TESTIMONIALS = [
  { quote: "We deployed three agents and saved 40 hours a week on status reporting. The HITL governance means our board trusts the outputs.", name: "Sarah Mitchell", role: "Programme Director", company: "Meridian Consulting" },
  { quote: "The meeting intelligence is a game-changer. Our agent joins every sprint ceremony, logs decisions, and updates Jira before the call ends.", name: "James Park", role: "Head of Delivery", company: "NovaTech Solutions" },
  { quote: "Moving from spreadsheets to Projectoolbox was like upgrading from a bicycle to a Tesla. Our PRINCE2 governance is now automated.", name: "Dr. Amara Osei", role: "PMO Lead", company: "Helix Infrastructure" },
];

const FAQS = [
  { q: "How does the AI agent actually manage a project?", a: "Your agent uses Claude AI to generate artefacts, process meeting transcripts, track tasks, monitor budgets, and communicate with stakeholders. It follows your chosen methodology and escalates to you when human judgement is needed." },
  { q: "What does 'autonomy level' mean?", a: "Levels 1-5 control how independently the agent operates. L1 only suggests. L3 handles routine tasks and escalates decisions. L5 runs projects end-to-end with minimal oversight." },
  { q: "Is my project data secure?", a: "All data is encrypted at rest and in transit. We're SOC 2 compliant, GDPR-ready, and offer single-tenant deployment for Enterprise customers. Your data is never used to train AI models." },
  { q: "What happens when credits run out?", a: "Credits roll over monthly on paid plans. You can purchase top-ups instantly or enable auto top-up. We alert you at configurable thresholds." },
  { q: "Can agents join my actual meetings?", a: "Yes. Using Recall.ai, your agent joins Google Meet, Zoom, or Teams as a participant. It transcribes, extracts actions, logs decisions, and updates your project plan." },
  { q: "Do I need to change my existing tools?", a: "No. Projectoolbox integrates with Jira, GitHub, Slack, Teams, Confluence, and more. Your agent works alongside your existing stack." },
];

const LOGOS = ["Accenture", "Deloitte", "AECOM", "Mott MacDonald", "BAE Systems", "Capgemini"];

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function LandingPage() {
  const { theme, setTheme } = useTheme();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

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
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm bg-gradient-to-br from-primary to-purple-500">PT</div>
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
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <Link href="/login"><Button variant="ghost" size="sm">Log In</Button></Link>
            <Link href="/signup"><Button size="sm">Start Free Trial</Button></Link>
            <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setMobileMenu(!mobileMenu)}>
              {mobileMenu ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full opacity-20 blur-[120px] bg-gradient-to-br from-primary via-purple-500 to-cyan-400" />
        <div className="max-w-[1200px] mx-auto relative z-10 text-center">
          <div className="max-w-[720px] mx-auto">
            <Badge variant="outline" className="mb-6 bg-primary/5 border-primary/20 text-primary gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Now in Public Beta — 500+ teams onboard
            </Badge>

            <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.05] mb-6">
              Your Projects,{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-500 to-cyan-400">
                Managed by AI
              </span>
            </h1>

            <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-[560px] mx-auto">
              Deploy autonomous AI project managers that plan, track, and deliver —
              while you focus on decisions that matter. Built for PMOs that demand governance.
            </p>

            <div className="flex items-center justify-center gap-4">
              <Link href="/signup">
                <Button size="lg" className="px-8 text-base shadow-lg shadow-primary/25">
                  Start Free Trial →
                </Button>
              </Link>
              <Button variant="outline" size="lg" className="px-6 text-base gap-2">
                <span className="w-8 h-8 rounded-full flex items-center justify-center bg-primary/10">▶</span>
                Watch Demo
              </Button>
            </div>
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
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white bg-gradient-to-br from-primary to-purple-500">A</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-muted-foreground">Agent Alpha</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        <Badge variant="outline" className="text-[8px] bg-green-500/10 text-green-500 border-green-500/20">Active</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Generating Risk Register v3 for Project Atlas</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[{ l: "Projects", v: "8", c: "text-primary" }, { l: "Completed", v: "342", c: "text-green-500" }, { l: "Approvals", v: "5", c: "text-amber-500" }, { l: "Credits", v: "847", c: "text-cyan-400" }].map(s => (
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

      {/* ═══ SOCIAL PROOF ═══ */}
      <section className="py-12 px-6 border-y border-border/30">
        <div className="max-w-[1200px] mx-auto text-center">
          <p className="text-sm text-muted-foreground mb-6">
            Trusted by <strong className="text-foreground">500+</strong> project managers at leading organisations
          </p>
          <div className="flex items-center justify-center gap-10 flex-wrap opacity-30">
            {LOGOS.map(l => <span key={l} className="text-base font-bold tracking-wide text-muted-foreground">{l}</span>)}
          </div>
          <div className="flex items-center justify-center gap-1 mt-4">
            {[1, 2, 3, 4, 5].map(i => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
            <span className="text-sm font-semibold text-muted-foreground ml-2">4.9/5 from 200+ reviews</span>
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Features</p>
            <h2 className="text-4xl font-bold mt-2">Everything a PMO needs, powered by AI</h2>
            <p className="text-base text-muted-foreground mt-3 max-w-[500px] mx-auto">Six capabilities that transform how projects are delivered.</p>
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
      <section id="how-it-works" className="py-20 px-6 bg-muted/30">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">How It Works</p>
            <h2 className="text-4xl font-bold mt-2">Up and running in 5 minutes</h2>
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

      {/* ═══ PRICING ═══ */}
      <section id="pricing" className="py-20 px-6">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Pricing</p>
            <h2 className="text-4xl font-bold mt-2">Simple, credit-based pricing</h2>
            <p className="text-base text-muted-foreground mt-3">Start free. Scale as you grow. No hidden fees.</p>
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
                  <p className="text-xs text-primary font-semibold mb-4">{plan.credits.toLocaleString()} credits/month</p>
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
            Need unlimited? <Link href="#" className="text-primary font-semibold">Contact us for Enterprise pricing</Link>
          </p>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section className="py-20 px-6 bg-muted/30">
        <div className="max-w-[1200px] mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Testimonials</p>
            <h2 className="text-4xl font-bold mt-2">Loved by project professionals</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map(t => (
              <Card key={t.name}>
                <CardContent className="pt-5">
                  <div className="flex gap-0.5 mb-4">
                    {[1, 2, 3, 4, 5].map(i => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-6 italic">&ldquo;{t.quote}&rdquo;</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-sm font-bold text-white">
                      {t.name.split(" ").map(w => w[0]).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.role}, {t.company}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-20 px-6">
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
          <h2 className="text-3xl font-bold mb-4">Ready to let AI manage your projects?</h2>
          <p className="text-base text-muted-foreground mb-8">Start your free 14-day trial. No credit card required. Deploy your first agent in under 5 minutes.</p>
          <Link href="/signup">
            <Button size="lg" className="px-10 text-base shadow-lg shadow-primary/25">Start Free Trial →</Button>
          </Link>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-12 px-6 bg-muted/30 border-t border-border">
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs bg-gradient-to-br from-primary to-purple-500">PT</div>
                <span className="text-base font-bold">Projectoolbox</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">AI-powered project management for teams that demand governance.</p>
            </div>
            {[
              { title: "Product", links: ["Features", "Pricing", "Integrations", "Changelog"] },
              { title: "Company", links: ["About", "Blog", "Careers", "Contact"] },
              { title: "Resources", links: ["Docs", "API Reference", "Community", "Webinars"] },
              { title: "Legal", links: ["Privacy", "Terms", "GDPR", "Security"] },
            ].map(col => (
              <div key={col.title}>
                <p className="text-xs font-bold uppercase tracking-wider mb-3">{col.title}</p>
                <ul className="space-y-2">
                  {col.links.map(link => <li key={link}><a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{link}</a></li>)}
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
