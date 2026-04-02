"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useBilling } from "@/hooks/use-api";
import { CreditCard, Download, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { PLAN_LIMITS } from "@/lib/utils";

const PLAN_PRICES: Record<string, number> = { FREE: 0, STARTER: 29, PROFESSIONAL: 79, BUSINESS: 199, ENTERPRISE: 499 };

const ALL_PLANS = [
  { id: "FREE", name: "Free", price: 0, credits: 50, features: ["1 project", "1 agent", "L1 only", "Community support"] },
  { id: "STARTER", name: "Starter", price: 29, credits: 500, features: ["3 projects", "2 agents", "L1–L3", "Email support"] },
  { id: "PROFESSIONAL", name: "Professional", price: 79, credits: 2000, features: ["10 projects", "5 agents", "L1–L4", "Priority support", "All exports"], popular: true },
  { id: "BUSINESS", name: "Business", price: 199, credits: 10000, features: ["50 projects", "15 agents", "L1–L5", "SSO + SLA", "Dedicated CSM"] },
  { id: "ENTERPRISE", name: "Enterprise", price: 499, credits: 999999, features: ["Unlimited", "All levels", "Custom integrations", "On-premise option"] },
];

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function BillingPage() {
  const { data, isLoading } = useBilling();
  const [invoicePage, setInvoicePage] = useState(0);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1200px]">
        <Skeleton className="h-32 rounded-2xl" />
        <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      </div>
    );
  }

  const plan = data?.plan || "FREE";
  const balance = data?.creditBalance || 0;
  const limits = data?.limits || PLAN_LIMITS[plan];
  const usage = data?.usage || { agents: 0, projects: 0 };
  const invoices = data?.invoices || [];
  const price = PLAN_PRICES[plan] || 0;
  const totalCredits = limits?.credits || 50;
  const usedPct = totalCredits > 0 ? Math.round(((totalCredits - balance) / totalCredits) * 100) : 0;

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Current Plan */}
      <div className="rounded-2xl p-5 border border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-transparent">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">Current Plan</Badge>
            </div>
            <h2 className="text-2xl font-bold">{plan}</h2>
            <p className="text-muted-foreground mt-0.5">
              <span className="text-3xl font-bold text-primary">{price === 0 ? "Free" : `$${price}`}</span>
              {price > 0 && <span className="text-sm">/month</span>}
            </p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>Agents: {usage.agents}/{limits?.agents || 1}</p>
            <p>Projects: {usage.projects}/{limits?.projects || 1}</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">Credits</span>
            <span className={`text-sm font-bold ${usedPct > 80 ? "text-amber-500" : "text-primary"}`}>
              {balance.toLocaleString()} / {totalCredits.toLocaleString()}
            </span>
          </div>
          <Progress value={usedPct} className="h-2.5" />
        </div>
        <div className="flex gap-2 mt-4">
          <Button>Upgrade Plan</Button>
          <Link href="/billing/credits"><Button variant="outline"><Zap className="w-4 h-4 mr-1" /> Credit Centre</Button></Link>
        </div>
      </div>

      {/* Plan Comparison */}
      <div>
        <h3 className="text-lg font-bold mb-3">Compare Plans</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {ALL_PLANS.map(p => (
            <Card key={p.id} className={`${p.id === plan ? "border-2 border-primary shadow-lg shadow-primary/10" : ""}`}>
              {p.id === plan && (
                <div className="text-center py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground bg-gradient-to-r from-primary to-purple-500">Current</div>
              )}
              <CardContent className="pt-4">
                <h4 className="text-base font-bold">{p.name}</h4>
                <div className="mb-3">
                  <span className="text-2xl font-extrabold">{p.price === 0 ? "Free" : `$${p.price}`}</span>
                  {p.price > 0 && <span className="text-xs text-muted-foreground">/mo</span>}
                </div>
                <p className="text-[10px] text-primary font-semibold mb-3">{p.credits === 999999 ? "Unlimited" : `${p.credits.toLocaleString()} credits`}</p>
                <ul className="space-y-1.5 mb-4">
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-1.5 text-xs">
                      <span className="text-green-500 mt-0.5">✓</span>
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
                <Button variant={p.id === plan ? "outline" : "default"} size="sm" className="w-full" disabled={p.id === plan}>
                  {p.id === plan ? "Current" : p.price > price ? "Upgrade" : "Downgrade"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Invoices */}
      <Card>
        <CardHeader><CardTitle className="text-base">Invoice History</CardTitle></CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="p-8 text-center">
              <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No invoices yet. Invoices appear after your first payment.</p>
            </div>
          ) : (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Date", "Description", "Amount", "Status"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(invoicePage * 5, (invoicePage + 1) * 5).map((inv: any) => (
                    <tr key={inv.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2.5 px-4 text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</td>
                      <td className="py-2.5 px-4">{inv.description || `${inv.currency?.toUpperCase()} payment`}</td>
                      <td className="py-2.5 px-4 font-bold">${inv.amount?.toFixed(2)}</td>
                      <td className="py-2.5 px-4">
                        <Badge variant={inv.status === "paid" ? "default" : "secondary"}>{inv.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {invoices.length > 5 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/30">
                  <span className="text-xs text-muted-foreground">{invoicePage * 5 + 1}–{Math.min((invoicePage + 1) * 5, invoices.length)} of {invoices.length}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={invoicePage === 0} onClick={() => setInvoicePage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" disabled={(invoicePage + 1) * 5 >= invoices.length} onClick={() => setInvoicePage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
