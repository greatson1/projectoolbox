"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

const SECTORS = [
  "Construction", "Pharma & Life Sciences", "Defence", "Infrastructure",
  "Consulting", "Technology", "Finance", "Government", "Other",
];

export default function WaitlistPage() {
  const [email, setEmail]   = useState("");
  const [name, setName]     = useState("");
  const [sector, setSector] = useState("");
  const [state, setState]   = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError]   = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setError("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, sector }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong."); setState("error"); return; }
      setState("done");
    } catch {
      setError("Network error — please try again.");
      setState("error");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 py-20">
      {/* Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-15 blur-[100px] bg-gradient-to-br from-primary via-purple-500 to-cyan-400 pointer-events-none" />

      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mb-12 relative">
        <img src="/pt-logo.png" alt="Projectoolbox" className="w-8 h-8 object-contain" />
        <span className="text-lg font-bold">Projectoolbox</span>
      </Link>

      <div className="w-full max-w-[480px] relative">
        {state === "done" ? (
          /* ── Success state ── */
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mx-auto mb-6">
              <Check className="w-8 h-8 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold mb-3">You&apos;re on the list.</h1>
            <p className="text-muted-foreground mb-2">
              We&apos;ll email <strong className="text-foreground">{email}</strong> when your access is ready.
            </p>
            <p className="text-sm text-muted-foreground mb-8">
              Early access is rolling out by sector. You&apos;ll be among the first in yours.
            </p>
            <Link href="/">
              <Button variant="outline" size="sm">← Back to site</Button>
            </Link>
          </div>
        ) : (
          /* ── Form state ── */
          <>
            <div className="text-center mb-8">
              <span className="inline-block text-xs font-bold uppercase tracking-widest text-primary mb-3">Early Access</span>
              <h1 className="text-3xl font-extrabold mb-3">Join the waitlist</h1>
              <p className="text-muted-foreground text-base">
                Projectoolbox is rolling out by sector. Drop your details and we&apos;ll notify you when access opens for your industry.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Work email <span className="text-destructive">*</span></label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Your sector</label>
                <select
                  value={sector}
                  onChange={e => setSector(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Select your industry...</option>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {state === "error" && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={state === "loading"}>
                {state === "loading" ? "Joining..." : "Join the Waitlist →"}
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground mt-5">
              Already have access?{" "}
              <Link href="/login" className="text-primary font-semibold hover:underline">Log in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
