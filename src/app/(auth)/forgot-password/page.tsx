"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, CheckCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send reset email");
      }
      setSent(true);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
            style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>PT</div>
          <span className="text-xl font-bold">Projectoolbox</span>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-5">
            {sent ? (
              <div className="text-center space-y-4 py-4">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                <h1 className="text-xl font-bold">Check your email</h1>
                <p className="text-sm text-muted-foreground">
                  We&apos;ve sent a password reset link to <strong>{email}</strong>.
                  Check your inbox and follow the instructions.
                </p>
                <Link href="/login">
                  <Button variant="outline" className="w-full mt-2">Back to Sign In</Button>
                </Link>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <h1 className="text-xl font-bold">Forgot your password?</h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Enter your email and we&apos;ll send you a reset link.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="email" className="text-xs">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="mt-1"
                      required
                    />
                  </div>

                  {error && <p className="text-xs text-destructive">{error}</p>}

                  <Button type="submit" className="w-full" disabled={loading || !email}>
                    {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : "Send Reset Link"}
                  </Button>
                </form>

                <Link href="/login" className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="w-3 h-3" /> Back to Sign In
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
