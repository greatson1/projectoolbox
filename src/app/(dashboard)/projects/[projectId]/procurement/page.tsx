"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useOrgCurrency } from "@/hooks/use-currency";
import { formatMoney } from "@/lib/currency";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Package, Plus, Building2, FileText, ShoppingCart, Receipt, TrendingUp } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  AWARDED: "default",
  TENDERING: "secondary",
  DRAFT: "outline",
  CANCELLED: "destructive",
  ACTIVE: "default",
  EXPIRED: "destructive",
  PENDING: "outline",
  APPROVED: "default",
  REJECTED: "destructive",
  PAID: "default",
  OVERDUE: "destructive",
  SENT: "secondary",
};

interface ProcurementPackage {
  id: string; name: string; vendor: string; value: number; status: string; dueDate: string;
}
interface Vendor {
  id: string; name: string; category: string; rating: number; activeContracts: number; totalSpend: number; status: string;
}
interface Contract {
  id: string; contractId: string; vendor: string; value: number; start: string; end: string; status: string;
}
interface PurchaseOrder {
  id: string; poNumber: string; vendor: string; amount: number; date: string; status: string;
}
interface Invoice {
  id: string; invoiceNumber: string; vendor: string; amount: number; dueDate: string; status: string;
}

const demoPackages: ProcurementPackage[] = [];
const demoVendors: Vendor[] = [];
const demoContracts: Contract[] = [];
const demoPOs: PurchaseOrder[] = [];
const demoInvoices: Invoice[] = [];

export default function ProcurementPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const currency = useOrgCurrency();
  const fmt = (n: number) => formatMoney(n, currency);
  const [isLoading, setIsLoading] = useState(false);
  const [packages] = useState<ProcurementPackage[]>(demoPackages);
  const [vendors] = useState<Vendor[]>(demoVendors);
  const [contracts] = useState<Contract[]>(demoContracts);
  const [purchaseOrders] = useState<PurchaseOrder[]>(demoPOs);
  const [invoices] = useState<Invoice[]>(demoInvoices);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-56" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const totalValue = purchaseOrders.reduce((s, po) => s + po.amount, 0);
  const pendingApprovals = purchaseOrders.filter(po => po.status === "PENDING").length + invoices.filter(inv => inv.status === "PENDING").length;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Procurement Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {packages.length} packages · {vendors.length} vendors · {contracts.length} contracts
          </p>
        </div>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Vendor</Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Packages</p>
              <p className="text-2xl font-bold">{packages.length}</p>
            </div>
            <Package className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Active Vendors</p>
              <p className="text-2xl font-bold">{vendors.filter(v => v.status === "ACTIVE").length}</p>
            </div>
            <Building2 className="w-5 h-5 text-blue-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">PO Value</p>
              <p className="text-2xl font-bold">{fmt(totalValue)}</p>
            </div>
            <TrendingUp className="w-5 h-5 text-green-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending Approvals</p>
              <p className="text-2xl font-bold text-amber-500">{pendingApprovals}</p>
            </div>
            <FileText className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="text-[13px] font-semibold">Overview</TabsTrigger>
          <TabsTrigger value="vendors" className="text-[13px] font-semibold">Vendors</TabsTrigger>
          <TabsTrigger value="contracts" className="text-[13px] font-semibold">Contracts</TabsTrigger>
          <TabsTrigger value="purchase-orders" className="text-[13px] font-semibold">Purchase Orders</TabsTrigger>
          <TabsTrigger value="invoices" className="text-[13px] font-semibold">Invoices</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {packages.length === 0 ? (
            <div className="text-center py-20">
              <Package className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No procurement packages yet</h2>
              <p className="text-sm text-muted-foreground mb-4">Your AI agent will manage procurement automatically, tracking packages from requisition to delivery.</p>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add First Package</Button>
            </div>
          ) : (
            <Card className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Package", "Vendor", "Value", "Status", "Due Date"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {packages.map(pkg => (
                    <tr key={pkg.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer">
                      <td className="py-2.5 px-4 font-medium max-w-[250px] truncate">{pkg.name}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{pkg.vendor}</td>
                      <td className="py-2.5 px-4">{fmt(pkg.value)}</td>
                      <td className="py-2.5 px-4"><Badge variant={STATUS_VARIANT[pkg.status] || "outline"}>{pkg.status}</Badge></td>
                      <td className="py-2.5 px-4 text-muted-foreground">{pkg.dueDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        {/* Vendors Tab */}
        <TabsContent value="vendors" className="space-y-4">
          {vendors.length === 0 ? (
            <div className="text-center py-20">
              <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No vendors registered</h2>
              <p className="text-sm text-muted-foreground mb-4">Your AI agent will manage procurement automatically, evaluating and onboarding vendors as needed.</p>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Vendor</Button>
            </div>
          ) : (
            <Card className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Vendor", "Category", "Rating", "Active Contracts", "Total Spend", "Status"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(v => (
                    <tr key={v.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer">
                      <td className="py-2.5 px-4 font-medium">{v.name}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{v.category}</td>
                      <td className="py-2.5 px-4">
                        <span className="font-semibold">{v.rating}</span>
                        <span className="text-muted-foreground">/5</span>
                      </td>
                      <td className="py-2.5 px-4">{v.activeContracts}</td>
                      <td className="py-2.5 px-4">{fmt(v.totalSpend)}</td>
                      <td className="py-2.5 px-4"><Badge variant={STATUS_VARIANT[v.status] || "outline"}>{v.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        {/* Contracts Tab */}
        <TabsContent value="contracts" className="space-y-4">
          {contracts.length === 0 ? (
            <div className="text-center py-20">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No contracts created</h2>
              <p className="text-sm text-muted-foreground mb-4">Your AI agent will manage procurement automatically, drafting and tracking contracts with vendors.</p>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Contract</Button>
            </div>
          ) : (
            <Card className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Contract ID", "Vendor", "Value", "Start", "End", "Status"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <tr key={c.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer">
                      <td className="py-2.5 px-4 font-mono font-medium">{c.contractId}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{c.vendor}</td>
                      <td className="py-2.5 px-4">{fmt(c.value)}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{c.start}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{c.end}</td>
                      <td className="py-2.5 px-4"><Badge variant={STATUS_VARIANT[c.status] || "outline"}>{c.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        {/* Purchase Orders Tab */}
        <TabsContent value="purchase-orders" className="space-y-4">
          {purchaseOrders.length === 0 ? (
            <div className="text-center py-20">
              <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No purchase orders</h2>
              <p className="text-sm text-muted-foreground mb-4">Your AI agent will manage procurement automatically, generating purchase orders from approved requisitions.</p>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create PO</Button>
            </div>
          ) : (
            <Card className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["PO Number", "Vendor", "Amount", "Date", "Status"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrders.map(po => (
                    <tr key={po.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer">
                      <td className="py-2.5 px-4 font-mono font-medium">{po.poNumber}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{po.vendor}</td>
                      <td className="py-2.5 px-4">{fmt(po.amount)}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{po.date}</td>
                      <td className="py-2.5 px-4"><Badge variant={STATUS_VARIANT[po.status] || "outline"}>{po.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices" className="space-y-4">
          {invoices.length === 0 ? (
            <div className="text-center py-20">
              <Receipt className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No invoices recorded</h2>
              <p className="text-sm text-muted-foreground mb-4">Your AI agent will manage procurement automatically, matching invoices to purchase orders and flagging discrepancies.</p>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Invoice</Button>
            </div>
          ) : (
            <Card className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Invoice #", "Vendor", "Amount", "Due Date", "Status"].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer">
                      <td className="py-2.5 px-4 font-mono font-medium">{inv.invoiceNumber}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{inv.vendor}</td>
                      <td className="py-2.5 px-4">{fmt(inv.amount)}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{inv.dueDate}</td>
                      <td className="py-2.5 px-4"><Badge variant={STATUS_VARIANT[inv.status] || "outline"}>{inv.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
