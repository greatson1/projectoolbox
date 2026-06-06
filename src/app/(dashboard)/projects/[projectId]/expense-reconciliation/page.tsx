"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, AlertCircle, Sparkles, TrendingUp, TrendingDown } from "lucide-react";

/**
 * Travel Expense Reconciliation.
 *
 * Renders the post-trip reconciliation as a table of categories with
 * planned vs. actual columns and a variance % per row. A summary card
 * at the top shows the trip-level totals.
 *
 * Currency-agnostic: if rows carry a "Currency" or "Ccy" column we
 * display it next to each value but don't attempt FX conversion —
 * that's the user's job (or the artefact's, if it normalises).
 */
export default function ExpenseReconciliationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return (
        a.status === "APPROVED" &&
        (n.includes("expense reconciliation") || n.includes("expense report") || n.includes("expense tracker"))
      );
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const rows = useMemo(() => {
    if (!artefact?.content) return null;
    const parsed = parseArtefactRows(artefact.content);
    if (parsed.length === 0) return null;
    return parsed.map((row) => {
      const planned = parseFloat(pick(row, "Planned", "Budget", "Estimate").replace(/[^0-9.\-]/g, "")) || 0;
      const actual = parseFloat(pick(row, "Actual", "Spent", "Paid").replace(/[^0-9.\-]/g, "")) || 0;
      const variance = planned - actual; // positive = under budget
      const variancePct = planned > 0 ? Math.round((variance / planned) * 100) : null;
      return {
        category: pick(row, "Category", "Type", "Section") || "Other",
        description: pick(row, "Description", "Item", "Detail"),
        currency: pick(row, "Currency", "Ccy") || "",
        planned,
        actual,
        variance,
        variancePct,
        notes: pick(row, "Notes", "Comment"),
      };
    });
  }, [artefact?.content]);

  const totals = useMemo(() => {
    if (!rows) return null;
    const planned = rows.reduce((s, r) => s + r.planned, 0);
    const actual = rows.reduce((s, r) => s + r.actual, 0);
    return { planned, actual, variance: planned - actual, currency: rows[0]?.currency || "" };
  }, [rows]);

  const fmt = (n: number, currency: string) =>
    `${currency ? currency + " " : ""}${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1200px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt className="w-6 h-6 text-primary" />
            Expense Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Planned vs. actual spend for <span className="font-medium text-foreground">{project?.name}</span>.
          </p>
        </div>
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Expense Reconciliation artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Generate the <strong>Expense Reconciliation</strong> artefact during the Wrap-up phase
              once final receipts are in.
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

      {artefact && !rows && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Expense Reconciliation artefact contains no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {rows && totals && (
        <>
          <Card>
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Planned</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{fmt(totals.planned, totals.currency)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Actual</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{fmt(totals.actual, totals.currency)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Variance</p>
                <p
                  className={`text-2xl font-bold tabular-nums mt-1 flex items-center gap-1 ${totals.variance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                >
                  {totals.variance >= 0 ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                  {fmt(Math.abs(totals.variance), totals.currency)}
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    {totals.variance >= 0 ? "under" : "over"}
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">Category</th>
                      <th className="text-left px-3 py-2">Description</th>
                      <th className="text-right px-3 py-2">Planned</th>
                      <th className="text-right px-3 py-2">Actual</th>
                      <th className="text-right px-3 py-2">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          {r.description || <span className="text-muted-foreground">—</span>}
                          {r.notes && (
                            <p className="text-[10px] text-muted-foreground/80 mt-0.5">{r.notes}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.planned, r.currency)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.actual, r.currency)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.variance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {fmt(Math.abs(r.variance), r.currency)}
                          {r.variancePct !== null && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              ({r.variancePct >= 0 ? "+" : ""}{r.variancePct}%)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
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
