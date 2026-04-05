"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle, Mail, Zap, Building2 } from "lucide-react";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "", type: "general" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to send message");
      setSent(true);
    } catch {
      // Fallback: open mailto directly so the message is never lost
      const subject = encodeURIComponent(`[Projectoolbox] ${form.type === "enterprise" ? "Enterprise Enquiry" : "Contact"} — ${form.company || form.name}`);
      const body = encodeURIComponent(`Name: ${form.name}\nEmail: ${form.email}\nCompany: ${form.company}\n\n${form.message}`);
      window.location.href = `mailto:contact@projectoolbox.com?subject=${subject}&body=${body}`;
      setSent(true);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1100px] mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-10 transition-colors">
          ← Back to Projectoolbox
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-14">
          {/* Left column */}
          <div>
            <h1 className="text-4xl font-bold mb-4">Get in touch</h1>
            <p className="text-base text-muted-foreground leading-relaxed mb-10">
              Whether you&apos;re exploring Enterprise pricing, need help with your account, or have a general question
              — we&apos;d love to hear from you.
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Enterprise Sales</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Custom pricing, SSO, dedicated CSM, SLA guarantees, and single-tenant deployment.
                    We&apos;ll put together a tailored quote for your team.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Support</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Having trouble with the platform? Our team typically responds within 24 hours
                    on weekdays. Priority support is available on Professional and Business plans.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Email us directly</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    <a href="mailto:contact@projectoolbox.com" className="text-primary hover:underline">
                      contact@projectoolbox.com
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right column — form */}
          <div>
            {sent ? (
              <Card>
                <CardContent className="pt-8 pb-8 text-center space-y-4">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                  <h2 className="text-xl font-bold">Message sent!</h2>
                  <p className="text-sm text-muted-foreground">
                    Thanks for reaching out. We&apos;ll get back to you within one business day.
                  </p>
                  <Link href="/">
                    <Button variant="outline" className="mt-2">Back to Home</Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <Label className="text-xs">Enquiry type</Label>
                      <select
                        value={form.type}
                        onChange={set("type")}
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="general">General question</option>
                        <option value="enterprise">Enterprise pricing</option>
                        <option value="support">Account / technical support</option>
                        <option value="partnership">Partnership</option>
                        <option value="press">Press / media</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Full Name</Label>
                        <Input value={form.name} onChange={set("name")} placeholder="Sarah Chen" className="mt-1" required />
                      </div>
                      <div>
                        <Label className="text-xs">Work Email</Label>
                        <Input type="email" value={form.email} onChange={set("email")} placeholder="sarah@company.com" className="mt-1" required />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">Company / Organisation <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input value={form.company} onChange={set("company")} placeholder="Atlas Corp" className="mt-1" />
                    </div>

                    <div>
                      <Label className="text-xs">Message</Label>
                      <textarea
                        value={form.message}
                        onChange={set("message")}
                        placeholder="Tell us how we can help…"
                        rows={5}
                        required
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                      />
                    </div>

                    {error && <p className="text-xs text-destructive">{error}</p>}

                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : "Send Message"}
                    </Button>

                    <p className="text-[11px] text-muted-foreground text-center">
                      By submitting, you agree to our{" "}
                      <Link href="/legal/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
                    </p>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
