"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plane, AlertCircle, Sparkles, CheckCircle2, Clock, XCircle } from "lucide-react";

type BookingStatus = "confirmed" | "pending" | "cancelled" | "unknown";

function classifyStatus(raw: string): BookingStatus {
  const r = raw.toLowerCase();
  if (!r) return "unknown";
  if (r.includes("confirm") || r.includes("booked") || r.includes("paid")) return "confirmed";
  if (r.includes("pending") || r.includes("hold") || r.includes("await")) return "pending";
  if (r.includes("cancel") || r.includes("refund")) return "cancelled";
  return "unknown";
}

const STATUS_STYLES: Record<BookingStatus, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
  confirmed: { color: "#10B981", bg: "bg-emerald-500/10", icon: CheckCircle2, label: "Confirmed" },
  pending: { color: "#F59E0B", bg: "bg-amber-500/10", icon: Clock, label: "Pending" },
  cancelled: { color: "#EF4444", bg: "bg-red-500/10", icon: XCircle, label: "Cancelled" },
  unknown: { color: "#64748B", bg: "bg-slate-500/10", icon: Clock, label: "Unknown" },
};

/**
 * Travel Booking Tracker.
 *
 * Lists every booking from the approved Booking Tracker artefact —
 * flights / hotels / transfers / activities — with status classification
 * so the user can see at a glance what's confirmed vs. on hold.
 *
 * Optional filter row lets the user narrow by type or by status.
 */
export default function BookingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">("all");

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return a.status === "APPROVED" && (n.includes("booking tracker") || n.includes("bookings") || n.includes("reservations"));
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const bookings = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;
    return rows.map((row) => {
      const rawStatus = pick(row, "Status", "State");
      return {
        type: pick(row, "Type", "Category") || "Other",
        item: pick(row, "Item", "Booking", "Description", "Name", "Vendor") || "(Untitled)",
        date: pick(row, "Date", "Travel Date", "Check-in"),
        confirmation: pick(row, "Confirmation", "Booking Ref", "Reference", "PNR"),
        vendor: pick(row, "Vendor", "Provider", "Airline", "Hotel"),
        cost: pick(row, "Cost", "Amount", "Price"),
        currency: pick(row, "Currency", "Ccy"),
        payment: pick(row, "Payment", "Paid"),
        status: classifyStatus(rawStatus),
        statusRaw: rawStatus,
        notes: pick(row, "Notes", "Detail"),
      };
    });
  }, [artefact?.content]);

  const types = useMemo(() => {
    if (!bookings) return [];
    return Array.from(new Set(bookings.map((b) => b.type))).sort();
  }, [bookings]);

  const filtered = useMemo(() => {
    if (!bookings) return null;
    return bookings.filter(
      (b) => (typeFilter === "all" || b.type === typeFilter) && (statusFilter === "all" || b.status === statusFilter),
    );
  }, [bookings, typeFilter, statusFilter]);

  const counts = useMemo(() => {
    if (!bookings) return { confirmed: 0, pending: 0, cancelled: 0, unknown: 0 };
    return bookings.reduce(
      (acc, b) => ({ ...acc, [b.status]: acc[b.status] + 1 }),
      { confirmed: 0, pending: 0, cancelled: 0, unknown: 0 },
    );
  }, [bookings]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1400px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plane className="w-6 h-6 text-primary" />
            Booking Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reservations for <span className="font-medium text-foreground">{project?.name}</span>.
          </p>
        </div>
        {bookings && (
          <div className="flex flex-wrap gap-2 justify-end">
            <Badge variant="outline" className="text-xs">{counts.confirmed} confirmed</Badge>
            <Badge variant="outline" className="text-xs">{counts.pending} pending</Badge>
            {counts.cancelled > 0 && <Badge variant="outline" className="text-xs">{counts.cancelled} cancelled</Badge>}
          </div>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Booking Tracker artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Generate the <strong>Booking Tracker</strong> artefact during the Book phase to populate this view.
            </p>
            <Link
              href={`/projects/${projectId}/artefacts`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Open Artefacts
            </Link>
          </CardContent>
        </Card>
      )}

      {artefact && !bookings && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Booking Tracker artefact contains no tabular data the page can parse.
            <Link href={`/projects/${projectId}/artefacts`} className="ml-1 text-primary hover:underline">
              Open it to inspect or regenerate
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {bookings && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Filter:</span>
            <button
              onClick={() => setTypeFilter("all")}
              className={`px-2 py-1 rounded-md border transition-colors ${typeFilter === "all" ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
            >
              All types
            </button>
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2 py-1 rounded-md border transition-colors ${typeFilter === t ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
              >
                {t}
              </button>
            ))}
            <span className="text-muted-foreground/40">·</span>
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-2 py-1 rounded-md border transition-colors ${statusFilter === "all" ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
            >
              Any status
            </button>
            {(["confirmed", "pending", "cancelled"] as BookingStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2 py-1 rounded-md border transition-colors ${statusFilter === s ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
              >
                {STATUS_STYLES[s].label}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">Type</th>
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="text-left px-3 py-2">Vendor</th>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">Ref</th>
                      <th className="text-right px-3 py-2">Cost</th>
                      <th className="text-left px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {filtered && filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-6 text-muted-foreground">
                          No bookings match the current filter.
                        </td>
                      </tr>
                    )}
                    {filtered?.map((b, i) => {
                      const s = STATUS_STYLES[b.status];
                      const Icon = s.icon;
                      return (
                        <tr key={i} className="hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[10px]">{b.type}</Badge>
                          </td>
                          <td className="px-3 py-2 font-medium">{b.item}</td>
                          <td className="px-3 py-2 text-muted-foreground">{b.vendor || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{b.date || "—"}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{b.confirmation || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {b.cost ? `${b.currency ? b.currency + " " : ""}${b.cost}` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg}`} style={{ color: s.color }}>
                              <Icon className="w-3 h-3" />
                              {s.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {artefact && (
        <p className="text-[10px] text-muted-foreground/70 text-right">
          Source:{" "}
          <Link href={`/projects/${projectId}/artefacts`} className="underline hover:text-foreground">
            {artefact.name}
          </Link>
          {" · "}
          updated {new Date(artefact.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      )}
    </div>
  );
}
