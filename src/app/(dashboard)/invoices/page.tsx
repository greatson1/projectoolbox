"use client";

import { useState, useEffect } from "react";
import { useOrgCurrency } from "@/hooks/use-currency";
import { formatMoney } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Receipt,
  Plus,
  FileText,
  Clock,
  AlertTriangle,
  PoundSterling,
  ArrowUpDown,
} from "lucide-react";

type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "OVERDUE";

interface Invoice {
  id: string;
  number: string;
  project: string;
  vendor: string;
  amount: number;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
}

const STATUS_STYLES: Record<InvoiceStatus, { bg: string; text: string }> = {
  DRAFT: { bg: "bg-slate-500/10", text: "text-slate-500" },
  SENT: { bg: "bg-blue-500/10", text: "text-blue-500" },
  PAID: { bg: "bg-emerald-500/10", text: "text-emerald-500" },
  OVERDUE: { bg: "bg-red-500/10", text: "text-red-500" },
};

const DEMO_INVOICES: Invoice[] = [
  {
    id: "1",
    number: "INV-2026-001",
    project: "ERP Migration",
    vendor: "Acme Consulting Ltd",
    amount: 12500,
    issueDate: "2026-03-15",
    dueDate: "2026-04-14",
    status: "PAID",
  },
  {
    id: "2",
    number: "INV-2026-002",
    project: "Cloud Infrastructure",
    vendor: "CloudOps Solutions",
    amount: 34200,
    issueDate: "2026-03-22",
    dueDate: "2026-04-21",
    status: "SENT",
  },
  {
    id: "3",
    number: "INV-2026-003",
    project: "Office Relocation",
    vendor: "Swift Logistics",
    amount: 8750,
    issueDate: "2026-02-10",
    dueDate: "2026-03-12",
    status: "OVERDUE",
  },
  {
    id: "4",
    number: "INV-2026-004",
    project: "Website Redesign",
    vendor: "Pixel Perfect Agency",
    amount: 18900,
    issueDate: "2026-04-01",
    dueDate: "2026-05-01",
    status: "DRAFT",
  },
  {
    id: "5",
    number: "INV-2026-005",
    project: "ERP Migration",
    vendor: "DataSync Partners",
    amount: 6300,
    issueDate: "2026-03-28",
    dueDate: "2026-04-27",
    status: "SENT",
  },
  {
    id: "6",
    number: "INV-2026-006",
    project: "Cloud Infrastructure",
    vendor: "SecureNet Ltd",
    amount: 15400,
    issueDate: "2026-01-20",
    dueDate: "2026-02-19",
    status: "OVERDUE",
  },
  {
    id: "7",
    number: "INV-2026-007",
    project: "Training Programme",
    vendor: "SkillForge Academy",
    amount: 4200,
    issueDate: "2026-03-05",
    dueDate: "2026-04-04",
    status: "PAID",
  },
];

export default function InvoicesPage() {
  const orgCurrency = useOrgCurrency();
  const formatCurrency = (amount: number, c?: string | null) => formatMoney(amount, c || orgCurrency);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/invoices")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.data)) setInvoices(d.data); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);
  const [tab, setTab] = useState("all");
  const [sortField, setSortField] = useState<"amount" | "dueDate">("dueDate");
  const [sortAsc, setSortAsc] = useState(true);

  const totalValue = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const pendingCount = invoices.filter(
    (i) => i.status === "SENT" || i.status === "DRAFT"
  ).length;
  const overdueCount = invoices.filter((i) => i.status === "OVERDUE").length;

  const filtered = invoices.filter((inv) => {
    if (tab === "all") return true;
    if (tab === "pending") return inv.status === "SENT" || inv.status === "DRAFT";
    if (tab === "paid") return inv.status === "PAID";
    if (tab === "overdue") return inv.status === "OVERDUE";
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortField === "amount") return sortAsc ? a.amount - b.amount : b.amount - a.amount;
    return sortAsc
      ? a.dueDate.localeCompare(b.dueDate)
      : b.dueDate.localeCompare(a.dueDate);
  });

  const handleSort = (field: "amount" | "dueDate") => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-[1400px] space-y-6">
        <div className="h-9 w-40 rounded-lg bg-muted animate-pulse" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}
        </div>
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Invoice
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="rounded-lg bg-blue-500/10 p-3">
              <FileText className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Invoices</p>
              <p className="text-2xl font-bold">{invoices.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="rounded-lg bg-amber-500/10 p-3">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pending Payment</p>
              <p className="text-2xl font-bold">{pendingCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="rounded-lg bg-red-500/10 p-3">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Overdue</p>
              <p className="text-2xl font-bold">{overdueCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <PoundSterling className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Value</p>
              <p className="text-2xl font-bold">{formatCurrency(totalValue)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs + Table */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {sorted.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Receipt className="mb-4 h-12 w-12 text-muted-foreground/40" />
                <p className="text-lg font-medium text-muted-foreground">
                  No invoices yet
                </p>
                <p className="mt-1 text-sm text-muted-foreground/70">
                  Create your first invoice to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Invoice #</th>
                      <th className="px-4 py-3 font-medium">Project</th>
                      <th className="px-4 py-3 font-medium">Vendor</th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => handleSort("amount")}
                        >
                          Amount
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">Issue Date</th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => handleSort("dueDate")}
                        >
                          Due Date
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((inv) => (
                      <tr
                        key={inv.id}
                        className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium">{inv.number}</td>
                        <td className="px-4 py-3">{inv.project}</td>
                        <td className="px-4 py-3">{inv.vendor}</td>
                        <td className="px-4 py-3 font-mono">
                          {formatCurrency(inv.amount)}
                        </td>
                        <td className="px-4 py-3">{inv.issueDate}</td>
                        <td className="px-4 py-3">{inv.dueDate}</td>
                        <td className="px-4 py-3">
                          <Badge
                            className={`${STATUS_STYLES[inv.status].bg} ${STATUS_STYLES[inv.status].text} border-0`}
                          >
                            {inv.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
