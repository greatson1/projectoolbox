"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Receipt, Download, ChevronLeft, RefreshCw, Filter, X,
  ExternalLink, ArrowDownToLine,
} from "lucide-react";
import { toast } from "sonner";
import { useOrgCurrency } from "@/hooks/use-currency";
import { formatMoney } from "@/lib/currency";
import { usePageTitle } from "@/hooks/use-page-title";

interface Invoice {
  id: string;
  stripeId: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  pdfUrl: string | null;
  createdAt: string;
}

/**
 * Full invoice history. The main /billing page shows the most recent 20;
 * this page lets the user scroll back through every payment and download
 * a CSV scoped to a date range — the receipts the UK finance team
 * actually wants for VAT reconciliation.
 *
 * "Manage in Stripe" → Stripe Customer Portal. The portal still owns
 * card / address / VAT-ID changes; we just give a cleaner UI on top of
 * the same invoice data plus a CSV export the portal doesn't offer.
 */
export default function BillingHistoryPage() {
  usePageTitle("Billing history");
  const currency = useOrgCurrency();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [portalBusy, setPortalBusy] = useState(false);

  const load = useCallback(async (opts?: { append?: boolean; resetFilter?: boolean }) => {
    const isAppend = !!opts?.append;
    if (isAppend) setLoadingMore(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (isAppend && nextCursor) params.set("cursor", nextCursor);
      if (!opts?.resetFilter) {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      const res = await fetch(`/api/billing/invoices?${params}`);
      const j = await res.json();
      if (!res.ok) {
        toast.error(j?.error || "Could not load invoices");
        return;
      }
      setInvoices(isAppend ? [...invoices, ...(j.data || [])] : (j.data || []));
      setNextCursor(j.nextCursor ?? null);
    } catch (e: any) {
      toast.error(e?.message || "Load failed");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [invoices, nextCursor, from, to]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilter() {
    load({ resetFilter: false });
  }
  function clearFilter() {
    setFrom("");
    setTo("");
    setTimeout(() => load({ resetFilter: true }), 0);
  }

  async function downloadCsv() {
    const params = new URLSearchParams({ format: "csv" });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    window.location.href = `/api/billing/invoices?${params}`;
  }

  async function openStripePortal() {
    setPortalBusy(true);
    try {
      const r = await fetch("/api/billing/portal", { method: "POST" });
      const j = await r.json();
      if (j?.data?.portalUrl) window.location.href = j.data.portalUrl;
      else toast.error(j?.error || "Couldn't open Stripe portal");
    } catch (e: any) {
      toast.error(e?.message || "Portal unavailable");
    } finally {
      setPortalBusy(false);
    }
  }

  const totalAmount = invoices.reduce((s, inv) => s + (inv.amount ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/billing">
              <Button variant="ghost" size="sm" className="h-7 px-2">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            </Link>
            <Receipt className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">Billing history</h1>
          </div>
          <p className="text-sm text-muted-foreground ml-9">
            Every invoice on file. Download PDFs, export a CSV for finance, or jump to Stripe.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={loading || invoices.length === 0}>
            <ArrowDownToLine className="w-4 h-4 mr-2" />
            CSV
          </Button>
          <Button size="sm" onClick={openStripePortal} disabled={portalBusy}>
            <ExternalLink className="w-4 h-4 mr-2" />
            {portalBusy ? "Opening…" : "Manage in Stripe"}
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="py-4 px-5">
          <div className="flex items-end gap-3 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground mb-2.5" />
            <div className="flex-1 min-w-[140px]">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-sm" />
            </div>
            <Button size="sm" onClick={applyFilter} disabled={loading}>Apply</Button>
            {(from || to) && (
              <Button variant="ghost" size="sm" onClick={clearFilter} disabled={loading}>
                <X className="w-3.5 h-3.5 mr-1" /> Clear
              </Button>
            )}
            <div className="ml-auto text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total ({invoices.length} {invoices.length === 1 ? "invoice" : "invoices"})</p>
              <p className="text-sm font-bold tabular-nums">{formatMoney(totalAmount, currency, { decimals: 2 })}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {invoices.length === 0 && !loading && (
            <div className="py-16 text-center">
              <Receipt className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No invoices in this range yet.</p>
            </div>
          )}
          {invoices.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Date", "Invoice ID", "Stripe ID", "Amount", "Status", ""].map((h, i) => (
                    <th key={h} className={`text-left py-3 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${i === 5 ? "w-12" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 text-muted-foreground tabular-nums">
                      {new Date(inv.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-foreground">{inv.id.slice(-12)}</td>
                    <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground">{inv.stripeId ? inv.stripeId.slice(-14) : "—"}</td>
                    <td className="py-3 px-4 font-semibold tabular-nums">
                      {formatMoney(inv.amount ?? 0, (inv.currency ?? currency).toUpperCase(), { decimals: 2 })}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={inv.status === "paid" ? "default" : "secondary"} className="text-[10px] capitalize">
                        {inv.status ?? "—"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {inv.pdfUrl ? (
                        <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" title="Download PDF">
                          <Button variant="ghost" size="sm" className="h-7 px-2">
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        </a>
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {nextCursor && (
        <div className="text-center mt-4">
          <Button variant="outline" onClick={() => load({ append: true })} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load older invoices"}
          </Button>
        </div>
      )}
    </div>
  );
}
