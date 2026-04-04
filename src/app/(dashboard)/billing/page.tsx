"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useBilling } from "@/hooks/use-api";
import { cn, PLAN_LIMITS } from "@/lib/utils";
import { toast } from "sonner";
import {
  CreditCard, Download, ChevronLeft, ChevronRight, Zap,
  Crown, Mail, Bell, FileText, Shield, Receipt,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// PLAN & PRICE DATA
// ═══════════════════════════════════════════════════════════════════

const PLAN_PRICES: Record<string, number> = {
  FREE: 0, STARTER: 29, PROFESSIONAL: 79, BUSINESS: 199, ENTERPRISE: 499,
};

const ALL_PLANS = [
  {
    id: "FREE", name: "Free", price: 0, credits: 50,
    features: [
      { label: "Monthly Credits", value: "50" },
      { label: "Projects", value: "1" },
      { label: "Agents", value: "1" },
      { label: "Autonomy Levels", value: "L1 only" },
      { label: "Document Export", value: "PDF only" },
      { label: "Support", value: "Community" },
      { label: "SSO / SAML", value: "--" },
    ],
  },
  {
    id: "STARTER", name: "Starter", price: 29, credits: 500,
    features: [
      { label: "Monthly Credits", value: "500" },
      { label: "Projects", value: "3" },
      { label: "Agents", value: "2" },
      { label: "Autonomy Levels", value: "L1--L3" },
      { label: "Document Export", value: "PDF only" },
      { label: "Support", value: "Email" },
      { label: "SSO / SAML", value: "--" },
    ],
  },
  {
    id: "PROFESSIONAL", name: "Professional", price: 79, credits: 2000, popular: true,
    features: [
      { label: "Monthly Credits", value: "2,000" },
      { label: "Projects", value: "10" },
      { label: "Agents", value: "5" },
      { label: "Autonomy Levels", value: "L1--L4" },
      { label: "Document Export", value: "PDF, Word, Excel, PPT" },
      { label: "Support", value: "Priority email" },
      { label: "SSO / SAML", value: "--" },
    ],
  },
  {
    id: "BUSINESS", name: "Business", price: 199, credits: 10000,
    features: [
      { label: "Monthly Credits", value: "10,000" },
      { label: "Projects", value: "50" },
      { label: "Agents", value: "15" },
      { label: "Autonomy Levels", value: "L1--L5" },
      { label: "Document Export", value: "All formats + API" },
      { label: "Support", value: "Dedicated CSM + SLA" },
      { label: "SSO / SAML", value: "Included" },
    ],
  },
  {
    id: "ENTERPRISE", name: "Enterprise", price: 499, credits: 999999,
    features: [
      { label: "Monthly Credits", value: "Unlimited" },
      { label: "Projects", value: "Unlimited" },
      { label: "Agents", value: "Unlimited" },
      { label: "Autonomy Levels", value: "L1--L5" },
      { label: "Document Export", value: "All formats + API" },
      { label: "Support", value: "Dedicated CSM + SLA" },
      { label: "SSO / SAML", value: "Included" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// TOP-UP BUNDLES
// ═══════════════════════════════════════════════════════════════════

const TOPUP_BUNDLES = [
  { credits: 500, price: 10, label: "", perCredit: "2.0c" },
  { credits: 2000, price: 35, label: "Popular", perCredit: "1.8c" },
  { credits: 5000, price: 75, label: "Best Value", perCredit: "1.5c" },
  { credits: 10000, price: 120, label: "", perCredit: "1.2c" },
];

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA (invoices, charts)
// ═══════════════════════════════════════════════════════════════════

const MOCK_INVOICES = [
  { id: "INV-2026-06", date: "01 Apr 2026", desc: "Professional Plan -- April", amount: 79.0, vat: 15.8, total: 94.8, status: "upcoming" as const },
  { id: "INV-2026-05", date: "01 Mar 2026", desc: "Professional Plan -- March", amount: 79.0, vat: 15.8, total: 94.8, status: "paid" as const },
  { id: "INV-2026-05T", date: "12 Mar 2026", desc: "Credit Top-up -- 2,000 credits", amount: 35.0, vat: 7.0, total: 42.0, status: "paid" as const },
  { id: "INV-2026-04", date: "01 Feb 2026", desc: "Professional Plan -- February", amount: 79.0, vat: 15.8, total: 94.8, status: "paid" as const },
  { id: "INV-2026-03", date: "01 Jan 2026", desc: "Professional Plan -- January", amount: 79.0, vat: 15.8, total: 94.8, status: "paid" as const },
  { id: "INV-2026-02", date: "01 Dec 2025", desc: "Professional Plan -- December", amount: 79.0, vat: 15.8, total: 94.8, status: "paid" as const },
  { id: "INV-2026-01", date: "15 Nov 2025", desc: "Starter Plan -- November (upgrade mid-month)", amount: 29.0, vat: 5.8, total: 34.8, status: "paid" as const },
];

const SPEND_MONTHLY = [
  { month: "Nov", spend: 34.8 },
  { month: "Dec", spend: 94.8 },
  { month: "Jan", spend: 94.8 },
  { month: "Feb", spend: 94.8 },
  { month: "Mar", spend: 136.8 },
  { month: "Apr", spend: 94.8 },
];

const CREDIT_USAGE = [
  { month: "Nov", purchased: 500, consumed: 320 },
  { month: "Dec", purchased: 2000, consumed: 1650 },
  { month: "Jan", purchased: 2000, consumed: 1820 },
  { month: "Feb", purchased: 2000, consumed: 1940 },
  { month: "Mar", purchased: 2500, consumed: 2180 },
  { month: "Apr", purchased: 2000, consumed: 1247 },
];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg text-center bg-muted/40">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function BillingPage() {
  const { data, isLoading } = useBilling();
  const [topupCustom, setTopupCustom] = useState(500);
  const [autoTopup, setAutoTopup] = useState(false);
  const [autoTopupThreshold, setAutoTopupThreshold] = useState(200);
  const [alertCreditThreshold, setAlertCreditThreshold] = useState(true);
  const [alertSpendThreshold, setAlertSpendThreshold] = useState(true);
  const [alertWeeklySummary, setAlertWeeklySummary] = useState(false);
  const [alertChannel, setAlertChannel] = useState<"email" | "slack" | "both">("email");
  const [invoicePage, setInvoicePage] = useState(0);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1200px]">
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const plan = data?.plan || "FREE";
  const balance = data?.creditBalance || 0;
  const limits = data?.limits || PLAN_LIMITS[plan];
  const usage = data?.usage || { agents: 0, projects: 0 };
  const invoicesFromAPI = data?.invoices || [];
  const price = PLAN_PRICES[plan] || 0;
  const totalCredits = limits?.credits || 50;
  const usedPct = totalCredits > 0 ? Math.round(((totalCredits - balance) / totalCredits) * 100) : 0;
  const remaining = balance;
  const customPrice = Math.round(topupCustom * 0.018);

  // Use real invoices if available, fall back to mock
  const invoices = invoicesFromAPI.length > 0 ? invoicesFromAPI : [];

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* ═══ 1. CURRENT PLAN CARD WITH GRADIENT BANNER ═══ */}
      <div className="rounded-2xl p-5 relative overflow-hidden border border-primary/25 bg-gradient-to-br from-primary/10 via-purple-500/5 to-transparent">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                <Crown className="w-3 h-3 mr-1" /> Current Plan
              </Badge>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            </div>
            <h2 className="text-2xl font-bold text-foreground">{plan}</h2>
            <p className="text-muted-foreground mt-0.5">
              <span className="text-3xl font-bold text-primary">
                {price === 0 ? "Free" : `$${price}`}
              </span>
              {price > 0 && <span className="text-sm">/month</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">Resource Usage</p>
            <p className="text-xs text-foreground">
              Agents: {usage.agents}/{limits?.agents || 1}
            </p>
            <p className="text-xs text-foreground">
              Projects: {usage.projects}/{limits?.projects || 1}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">Credits Used</span>
            <span className={cn("text-sm font-bold", usedPct > 80 ? "text-amber-500" : "text-primary")}>
              {(totalCredits - balance).toLocaleString()} / {totalCredits.toLocaleString()}
            </span>
          </div>
          <Progress value={usedPct} className="h-2.5" />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">{usedPct}% used</span>
            <span className={cn("text-[10px] font-semibold", remaining < 200 ? "text-destructive" : "text-muted-foreground")}>
              {remaining.toLocaleString()} remaining
            </span>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Link href="/billing"><Button onClick={() => toast.info("Coming soon")}>Upgrade Plan</Button></Link>
          <Link href="/billing"><Button variant="ghost" onClick={() => toast.info("Coming soon")}>Manage Subscription</Button></Link>
          <Link href="/billing/credits">
            <Button variant="outline"><Zap className="w-4 h-4 mr-1" /> Credit Centre</Button>
          </Link>
        </div>
      </div>

      {/* ═══ 2. PLAN COMPARISON ═══ */}
      <div>
        <h3 className="text-lg font-bold mb-3 text-foreground">Compare Plans</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {ALL_PLANS.map(p => {
            const isCurrent = p.id === plan;
            return (
              <Card key={p.id} className={cn(
                "overflow-hidden transition-all hover:-translate-y-0.5",
                isCurrent && "border-2 border-primary shadow-lg shadow-primary/10"
              )}>
                {isCurrent && (
                  <div className="text-center py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground bg-gradient-to-r from-primary to-purple-500">
                    Your Current Plan
                  </div>
                )}
                <CardContent className="pt-4">
                  <h4 className="text-lg font-bold text-foreground">{p.name}</h4>
                  <div className="mb-4">
                    <span className="text-2xl font-bold text-primary">
                      {p.id === "ENTERPRISE" ? "From " : ""}{p.price === 0 ? "Free" : `$${p.price}`}
                    </span>
                    {p.price > 0 && <span className="text-xs text-muted-foreground">/month</span>}
                  </div>
                  <div className="space-y-2 mb-5">
                    {p.features.map(f => (
                      <div key={f.label} className="flex items-center justify-between py-1 border-b border-border/10">
                        <span className="text-[11px] text-muted-foreground">{f.label}</span>
                        <span className={cn("text-[11px] font-semibold", f.value === "--" ? "text-muted-foreground/50" : "text-foreground")}>
                          {f.value}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant={isCurrent ? "outline" : p.id === "ENTERPRISE" ? "default" : "default"}
                    size="sm"
                    className="w-full"
                    disabled={isCurrent}
                  >
                    {isCurrent ? "Current Plan" : p.price > price ? "Upgrade" : p.price === 0 ? "Downgrade" : "Select"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ═══ 3. CREDIT TOP-UP ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> Credit Top-Up
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">Credits never expire and roll over to the next month.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Bundles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {TOPUP_BUNDLES.map(b => (
              <div
                key={b.credits}
                className="rounded-xl p-4 text-center cursor-pointer transition-all hover:-translate-y-0.5 relative border border-border/30 bg-muted/20"
              >
                {b.label && (
                  <span className={cn(
                    "absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-2 py-0.5 rounded-full text-white",
                    b.label === "Best Value" ? "bg-green-500" : "bg-primary"
                  )}>
                    {b.label}
                  </span>
                )}
                <p className="text-2xl font-bold mt-1 text-foreground">{b.credits.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground">credits</p>
                <p className="text-lg font-bold mt-2 text-primary">${b.price}</p>
                <p className="text-[10px] text-muted-foreground">{b.perCredit}/credit</p>
                <Button size="sm" className="w-full mt-3" onClick={() => toast.info("Coming soon")}>Buy</Button>
              </div>
            ))}
          </div>

          {/* Custom slider */}
          <div className="p-4 rounded-xl border border-border/30 bg-muted/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-foreground">Custom Amount</span>
              <span className="text-sm font-bold text-primary">
                {topupCustom.toLocaleString()} credits -- ${customPrice}
              </span>
            </div>
            <Slider
              min={100}
              max={10000}
              step={100}
              value={[topupCustom]}
              onValueChange={(v: any) => setTopupCustom(Array.isArray(v) ? v[0] : v)}
              className="mb-2"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
              <span>100</span><span>2,500</span><span>5,000</span><span>10,000</span>
            </div>
            <Button size="sm" className="mt-3" onClick={() => toast.info("Coming soon")}>
              Purchase {topupCustom.toLocaleString()} Credits -- ${customPrice}
            </Button>
          </div>

          {/* Auto top-up */}
          <div className={cn(
            "flex items-center justify-between p-3 rounded-xl border",
            autoTopup ? "bg-primary/5 border-primary/20" : "border-border/20"
          )}>
            <div>
              <p className="text-xs font-semibold text-foreground">Auto Top-Up</p>
              <p className="text-[10px] text-muted-foreground">
                Automatically purchase 2,000 credits ($35) when balance drops below {autoTopupThreshold}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {autoTopup && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Threshold:</span>
                  <select
                    className="px-2 py-1 rounded-md text-[11px] bg-card text-foreground border border-border"
                    value={autoTopupThreshold}
                    onChange={e => setAutoTopupThreshold(Number(e.target.value))}
                  >
                    <option value={100}>100 credits</option>
                    <option value={200}>200 credits</option>
                    <option value={500}>500 credits</option>
                  </select>
                </div>
              )}
              <Switch checked={autoTopup} onCheckedChange={setAutoTopup} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ 4. PAYMENT METHOD ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> Payment Method
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Current card */}
            <div className="p-4 rounded-xl flex items-center gap-4 border border-border/30 bg-muted/10">
              <div className="w-12 h-8 rounded flex items-center justify-center text-[11px] font-bold bg-gradient-to-br from-[#1A1F71] to-[#2557D6] text-white">
                VISA
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">.... .... .... 4242</p>
                <p className="text-[11px] text-muted-foreground">Expires 12/2028</p>
              </div>
              <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">Default</Badge>
            </div>
            {/* Billing details */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-muted-foreground">
                Billing Email
              </p>
              <p className="text-sm text-foreground">billing@atlascorp.com</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-muted-foreground">
                Billing Address
              </p>
              <p className="text-sm text-foreground">Atlas Corp Ltd, 42 Innovation Way, London EC2A 1NT</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ 5. INVOICE HISTORY ═══ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="w-4 h-4" /> Invoice History
            </CardTitle>
            <select className="px-2 py-1 rounded-md text-[11px] bg-card text-muted-foreground border border-border">
              <option>All months</option>
              <option>April 2026</option>
              <option>March 2026</option>
              <option>February 2026</option>
              <option>January 2026</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="p-8 text-center">
              <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No invoices yet. Invoices appear after your first payment.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {["Invoice", "Date", "Description", "Amount", "VAT", "Total", "Status", ""].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.slice(invoicePage * 5, (invoicePage + 1) * 5).map((inv: any) => (
                      <tr key={inv.id} className="border-b border-border/10 hover:bg-muted/20 transition-opacity">
                        <td className="py-2.5 px-3 font-semibold text-primary">{inv.id}</td>
                        <td className="py-2.5 px-3 text-muted-foreground">{inv.date || new Date(inv.createdAt).toLocaleDateString()}</td>
                        <td className="py-2.5 px-3 text-foreground">{inv.desc || inv.description || "Payment"}</td>
                        <td className="py-2.5 px-3 font-semibold text-foreground">${(inv.amount || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-muted-foreground">${(inv.vat || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3 font-bold text-foreground">${(inv.total || inv.amount || 0).toFixed(2)}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant={inv.status === "paid" ? "default" : "secondary"}>
                            {inv.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3">
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {invoices.length > 5 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/20">
                  <span className="text-[11px] text-muted-foreground">
                    Showing {invoicePage * 5 + 1}--{Math.min((invoicePage + 1) * 5, invoices.length)} of {invoices.length}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={invoicePage === 0} onClick={() => setInvoicePage(p => p - 1)}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" disabled={(invoicePage + 1) * 5 >= invoices.length} onClick={() => setInvoicePage(p => p + 1)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══ 6. SPENDING ANALYTICS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={[] as any[]}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [`$${v.toFixed(2)}`, "Spend"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="spend"
                    stroke="var(--primary)"
                    fill="var(--primary)"
                    fillOpacity={0.15}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "var(--primary)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <MiniStat label="Avg Monthly" value="$91.80" />
              <MiniStat label="Projected Next" value="$94.80" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Credit Purchase vs Consumption</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[] as any[]} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="purchased" fill="var(--primary)" fillOpacity={0.3} radius={[3, 3, 0, 0]} name="Purchased" />
                  <Bar dataKey="consumed" fill="var(--primary)" radius={[3, 3, 0, 0]} name="Consumed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 rounded-sm bg-primary/30" /> Purchased
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 rounded-sm bg-primary" /> Consumed
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ 7. USAGE ALERTS ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" /> Usage Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {/* Credit threshold */}
              <div className="flex items-start justify-between gap-3 py-2 border-b border-border/10">
                <div>
                  <p className="text-xs font-semibold text-foreground">Credit threshold alert</p>
                  <p className="text-[10px] text-muted-foreground">Notify when credits drop below 200</p>
                </div>
                <Switch checked={alertCreditThreshold} onCheckedChange={setAlertCreditThreshold} />
              </div>
              {/* Spend threshold */}
              <div className="flex items-start justify-between gap-3 py-2 border-b border-border/10">
                <div>
                  <p className="text-xs font-semibold text-foreground">Spend threshold alert</p>
                  <p className="text-[10px] text-muted-foreground">Notify when monthly spend exceeds $200</p>
                </div>
                <Switch checked={alertSpendThreshold} onCheckedChange={setAlertSpendThreshold} />
              </div>
              {/* Weekly summary */}
              <div className="flex items-start justify-between gap-3 py-2 border-b border-border/10">
                <div>
                  <p className="text-xs font-semibold text-foreground">Weekly spending summary</p>
                  <p className="text-[10px] text-muted-foreground">Receive a weekly email with credit and spend breakdown</p>
                </div>
                <Switch checked={alertWeeklySummary} onCheckedChange={setAlertWeeklySummary} />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 text-muted-foreground">
                Notification Channel
              </p>
              <div className="flex gap-2">
                {(["email", "slack", "both"] as const).map(ch => (
                  <button
                    key={ch}
                    className={cn(
                      "px-3 py-2 rounded-lg text-xs font-semibold capitalize transition-all flex-1 border",
                      alertChannel === ch
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-transparent text-muted-foreground border-border/30"
                    )}
                    onClick={() => setAlertChannel(ch)}
                  >
                    {ch === "email" ? (
                      <><Mail className="w-3 h-3 inline mr-1" /> Email</>
                    ) : ch === "slack" ? (
                      "Slack"
                    ) : (
                      "Both"
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ 8. TAX & COMPLIANCE ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" /> Tax & Compliance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-muted-foreground">VAT Number</p>
                <p className="text-sm font-semibold text-foreground">GB 123 4567 89</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-muted-foreground">Tax Region</p>
                <p className="text-sm text-foreground">United Kingdom</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  All prices are subject to 20% VAT. VAT is calculated and added to each invoice automatically.
                </p>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 text-muted-foreground">
                Tax Documents
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20">
                  <div>
                    <p className="text-xs font-medium text-foreground">Annual Tax Summary 2025</p>
                    <p className="text-[10px] text-muted-foreground">Jan 2025 -- Dec 2025</p>
                  </div>
                  <Button variant="ghost" size="sm">
                    <FileText className="w-3 h-3 mr-1" /> Download PDF
                  </Button>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20">
                  <div>
                    <p className="text-xs font-medium text-foreground">VAT Certificate</p>
                    <p className="text-[10px] text-muted-foreground">Current registration</p>
                  </div>
                  <Button variant="ghost" size="sm">
                    <FileText className="w-3 h-3 mr-1" /> Download PDF
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
