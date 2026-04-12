"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calculator,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  PoundSterling,
  Pencil,
  Check,
  X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

interface CostEntry {
  id: string;
  description: string | null;
  category: string;
  amount: number;
  unitQty: number | null;
  unitRate: number | null;
  vendorName: string | null;
}

interface CategoryGroup {
  category: string;
  items: CostEntry[];
  subtotal: number;
}

interface EstimateData {
  categories: CategoryGroup[];
  grandTotal: number;
  entries: CostEntry[];
}

// ── Category config ────────────────────────────────────────────────────────

interface CategoryConfig {
  label: string;
  category: string;
  qtyLabel: string;
  rateLabel: string;
  isLumpSum: boolean;
}

const CATEGORIES: CategoryConfig[] = [
  { label: "Labour",           category: "LABOUR",   qtyLabel: "Days",     rateLabel: "Day Rate (£)", isLumpSum: false },
  { label: "Materials",        category: "MATERIALS",qtyLabel: "Quantity",  rateLabel: "Unit Cost (£)",isLumpSum: false },
  { label: "Services",         category: "SERVICES", qtyLabel: "Qty",      rateLabel: "Rate (£)",     isLumpSum: false },
  { label: "Travel",           category: "TRAVEL",   qtyLabel: "Qty",      rateLabel: "Rate (£)",     isLumpSum: false },
  { label: "Other",            category: "OTHER",    qtyLabel: "Qty",      rateLabel: "Rate (£)",     isLumpSum: false },
];

// ── Currency formatter ─────────────────────────────────────────────────────

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}£${(abs / 1_000).toFixed(0)}k`;
  return `${sign}£${abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Inline add-row form ────────────────────────────────────────────────────

interface AddRowFormProps {
  config: CategoryConfig;
  projectId: string;
  onAdded: () => void;
  onCancel: () => void;
}

function AddRowForm({ config, projectId, onAdded, onCancel }: AddRowFormProps) {
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const total =
    parseFloat(qty) > 0 && parseFloat(rate) > 0
      ? parseFloat(qty) * parseFloat(rate)
      : null;

  async function handleAdd() {
    if (!description.trim()) { setError("Description is required"); return; }

    const unitQty = parseFloat(qty);
    const unitRate = parseFloat(rate);

    if (isNaN(unitQty) || unitQty <= 0) { setError("Quantity must be a positive number"); return; }
    if (isNaN(unitRate) || unitRate <= 0) { setError("Rate must be a positive number"); return; }

    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/projects/${projectId}/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          category: config.category,
          unitQty,
          unitRate,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setError(json.error ?? "Failed to add entry");
        return;
      }

      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="bg-muted/20 border-b border-border/30">
      <td className="py-2 px-3">
        <Input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-7 text-xs"
        />
      </td>
      <td className="py-2 px-3">
        <Input
          type="number"
          placeholder="0"
          min="0"
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="h-7 text-xs w-24"
        />
      </td>
      <td className="py-2 px-3">
        <Input
          type="number"
          placeholder="0.00"
          min="0"
          step="any"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="h-7 text-xs w-28"
        />
      </td>
      <td className="py-2 px-3 text-xs font-mono text-muted-foreground">
        {total !== null ? fmt(total) : "—"}
      </td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1">
          <Button size="sm" className="h-6 text-[11px] px-2" onClick={handleAdd} disabled={saving}>
            {saving ? "Adding…" : "Add"}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
      </td>
    </tr>
  );
}

// ── Inline edit-row form ───────────────────────────────────────────────────

interface EditRowFormProps {
  item: CostEntry;
  config: CategoryConfig;
  projectId: string;
  onSaved: () => void;
  onCancel: () => void;
}

function EditRowForm({ item, config, projectId, onSaved, onCancel }: EditRowFormProps) {
  const [description, setDescription] = useState(item.description ?? "");
  const [qty, setQty] = useState(item.unitQty != null ? String(item.unitQty) : "");
  const [rate, setRate] = useState(item.unitRate != null ? String(item.unitRate) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsedQty = parseFloat(qty);
  const parsedRate = parseFloat(rate);
  const total = parsedQty > 0 && parsedRate > 0 ? parsedQty * parsedRate : null;

  async function handleSave() {
    if (!description.trim()) { setError("Description is required"); return; }
    const unitQty = parseFloat(qty);
    const unitRate = parseFloat(rate);
    if (isNaN(unitQty) || unitQty <= 0) { setError("Quantity must be a positive number"); return; }
    if (isNaN(unitRate) || unitRate <= 0) { setError("Rate must be a positive number"); return; }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/estimate?entryId=${item.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: description.trim(), unitQty, unitRate }),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setError(json.error ?? "Failed to save");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="bg-indigo-500/5 border-b border-indigo-500/20">
      <td className="py-2 px-3">
        <Input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-7 text-xs"
          autoFocus
        />
        {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
      </td>
      <td className="py-2 px-3">
        <Input
          type="number"
          placeholder="0"
          min="0"
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="h-7 text-xs w-24"
        />
      </td>
      <td className="py-2 px-3">
        <Input
          type="number"
          placeholder="0.00"
          min="0"
          step="any"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="h-7 text-xs w-28"
        />
      </td>
      <td className="py-2 px-3 text-xs font-mono text-muted-foreground">
        {total !== null ? fmt(total) : "—"}
      </td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-emerald-500 hover:text-emerald-400"
            onClick={handleSave}
            disabled={saving}
            title="Save"
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={onCancel}
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ── Category section ───────────────────────────────────────────────────────

interface CategorySectionProps {
  config: CategoryConfig;
  group: CategoryGroup | undefined;
  projectId: string;
  onRefresh: () => void;
}

function CategorySection({ config, group, projectId, onRefresh }: CategorySectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const items = group?.items ?? [];
  const subtotal = group?.subtotal ?? 0;

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await fetch(`/api/projects/${projectId}/estimate?entryId=${id}`, { method: "DELETE" });
      onRefresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-0 pt-4 px-4">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <CardTitle className="text-sm font-semibold">{config.label}</CardTitle>
            {items.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                {items.length} {items.length === 1 ? "item" : "items"}
              </Badge>
            )}
          </div>
          {subtotal > 0 && (
            <span className="text-sm font-semibold font-mono">{fmt(subtotal)}</span>
          )}
        </button>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-3 pb-2 px-4">
          {items.length === 0 && !showAddForm ? (
            <p className="text-xs text-muted-foreground py-2">
              No {config.label.toLowerCase()} entries yet.
            </p>
          ) : (
            <table className="w-full text-xs mb-2">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-left py-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Description
                  </th>
                  <th className="text-left py-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {config.qtyLabel}
                  </th>
                  <th className="text-left py-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {config.rateLabel}
                  </th>
                  <th className="text-left py-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Total
                  </th>
                  <th className="py-1.5 px-3" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) =>
                  editingId === item.id ? (
                    <EditRowForm
                      key={item.id}
                      item={item}
                      config={config}
                      projectId={projectId}
                      onSaved={() => { setEditingId(null); onRefresh(); }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <tr key={item.id} className="border-b border-border/10 hover:bg-muted/10 group">
                      <td className="py-2 px-3">
                        <span>{item.description || "—"}</span>
                        {item.vendorName && (
                          <span className="text-muted-foreground ml-1">· {item.vendorName}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {item.unitQty !== null ? item.unitQty.toLocaleString("en-GB") : "—"}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {item.unitRate !== null ? fmt(item.unitRate) : "—"}
                      </td>
                      <td className="py-2 px-3 font-mono font-medium">{fmt(item.amount)}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-indigo-400"
                            onClick={() => { setShowAddForm(false); setEditingId(item.id); }}
                            title="Edit entry"
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                            onClick={() => handleDelete(item.id)}
                            disabled={deleting === item.id}
                            title="Remove entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
                {showAddForm && (
                  <AddRowForm
                    config={config}
                    projectId={projectId}
                    onAdded={() => { setShowAddForm(false); onRefresh(); }}
                    onCancel={() => setShowAddForm(false)}
                  />
                )}
              </tbody>
            </table>
          )}

          {!showAddForm && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 text-muted-foreground hover:text-foreground"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add row
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function EstimatePage() {
  usePageTitle("Cost Estimator");
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading: projectLoading } = useProject(projectId);

  const [data, setData] = useState<EstimateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingBudget, setSettingBudget] = useState(false);
  const [contingencyPct, setContingencyPct] = useState<number>(0);
  const [applyingContingency, setApplyingContingency] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/estimate`);
      const json = await res.json() as { data?: EstimateData };
      if (json.data) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Derived totals ───────────────────────────────────────────────────────

  const nonContingencyTotal = data
    ? data.entries
        .filter((e) => e.category !== "CONTINGENCY")
        .reduce((sum, e) => sum + e.amount, 0)
    : 0;

  const contingencyAmount = Math.round(nonContingencyTotal * (contingencyPct / 100) * 100) / 100;
  const grandTotal = nonContingencyTotal + contingencyAmount;

  const budget: number = (project as { budget?: number | null } | undefined)?.budget ?? 0;
  const budgetPct = budget > 0 && grandTotal > 0 ? Math.round((grandTotal / budget) * 100) : null;

  // Find existing contingency entry
  const existingContingency = data?.entries.find((e) => e.category === "CONTINGENCY");

  // Initialise contingency % from existing entry if present
  useEffect(() => {
    if (data && existingContingency && nonContingencyTotal > 0) {
      const derived = Math.round((existingContingency.amount / nonContingencyTotal) * 100);
      setContingencyPct(derived);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleSetBudget() {
    setSettingBudget(true);
    try {
      await fetch(`/api/projects/${projectId}/estimate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-budget", total: grandTotal }),
      });
      // Refresh project data (the useProject hook will re-query on next cycle)
      await loadData();
    } finally {
      setSettingBudget(false);
    }
  }

  async function handleApplyContingency() {
    if (contingencyAmount <= 0 && !existingContingency) return;

    setApplyingContingency(true);
    try {
      // Delete existing contingency entries first
      for (const entry of data?.entries.filter((e) => e.category === "CONTINGENCY") ?? []) {
        await fetch(`/api/projects/${projectId}/estimate?entryId=${entry.id}`, { method: "DELETE" });
      }
      // Add new contingency entry if amount > 0
      if (contingencyAmount > 0) {
        await fetch(`/api/projects/${projectId}/estimate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: `Contingency (${contingencyPct}%)`,
            category: "CONTINGENCY",
            amount: contingencyAmount,
          }),
        });
      }
      await loadData();
    } finally {
      setApplyingContingency(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (projectLoading || loading) {
    return (
      <div className="space-y-6 max-w-[1200px]">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const groupFor = (category: string): CategoryGroup | undefined =>
    data?.categories.find((c) => c.category === category);

  return (
    <div className="space-y-6 max-w-[1200px] animate-page-enter">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Calculator className="w-5 h-5 text-indigo-400" />
            <h1 className="text-2xl font-bold">Cost Estimator</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Build your project budget from the ground up
          </p>
        </div>
        {budget > 0 && (
          <Badge variant="secondary" className="text-sm px-3 py-1 mt-1">
            Budget: {fmt(budget)}
          </Badge>
        )}
      </div>

      {/* ── Empty state ── */}
      {!budget && grandTotal === 0 && (
        <Card className="border-dashed border-indigo-500/30 bg-indigo-500/5">
          <CardContent className="pt-6 pb-6 text-center">
            <PoundSterling className="w-10 h-10 text-indigo-400/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground mb-1">No budget set yet</p>
            <p className="text-xs text-muted-foreground">
              Add line items below, then click &quot;Set as Project Budget&quot; to lock in your estimate.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

        {/* ── Left: category sections ── */}
        <div className="lg:col-span-2 space-y-4">
          {CATEGORIES.map((config) => (
            <CategorySection
              key={config.category}
              config={config}
              group={groupFor(config.category)}
              projectId={projectId}
              onRefresh={loadData}
            />
          ))}

          {/* ── Contingency ── */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Contingency</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 flex-1">
                  <label className="text-xs text-muted-foreground w-20 shrink-0">
                    Percentage
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={1}
                    value={contingencyPct}
                    onChange={(e) => setContingencyPct(Number(e.target.value))}
                    className="flex-1 accent-indigo-500"
                  />
                  <div className="flex items-center gap-1 w-20">
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      step={1}
                      value={contingencyPct}
                      onChange={(e) => setContingencyPct(Math.min(50, Math.max(0, Number(e.target.value))))}
                      className="h-7 text-xs w-16 text-right"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </div>
                <div className="text-right min-w-[80px]">
                  <p className="text-sm font-semibold font-mono">{fmt(contingencyAmount)}</p>
                  <p className="text-[10px] text-muted-foreground">of {fmt(nonContingencyTotal)}</p>
                </div>
              </div>

              {existingContingency && (
                <p className="text-[11px] text-muted-foreground">
                  Current contingency: {fmt(existingContingency.amount)} ({existingContingency.description})
                </p>
              )}

              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                onClick={handleApplyContingency}
                disabled={applyingContingency || nonContingencyTotal === 0}
              >
                {applyingContingency ? "Applying…" : "Apply Contingency"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: summary card ── */}
        <div className="sticky top-4 space-y-4">
          <Card className="border-indigo-500/20">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calculator className="w-4 h-4 text-indigo-400" />
                Estimate Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">

              {/* Per-category breakdown */}
              {data && data.categories.filter((c) => c.category !== "CONTINGENCY").map((cat) => {
                const config = CATEGORIES.find((c) => c.category === cat.category);
                return (
                  <div key={cat.category} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{config?.label ?? cat.category}</span>
                    <span className="font-mono font-medium">{fmt(cat.subtotal)}</span>
                  </div>
                );
              })}

              {data && data.categories.filter((c) => c.category !== "CONTINGENCY").length > 0 && (
                <div className="border-t border-border/40 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Subtotal (ex. contingency)</span>
                    <span className="font-mono font-medium">{fmt(nonContingencyTotal)}</span>
                  </div>
                </div>
              )}

              {contingencyAmount > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Contingency ({contingencyPct}%)</span>
                  <span className="font-mono font-medium">{fmt(contingencyAmount)}</span>
                </div>
              )}

              {/* Grand total */}
              <div className="border-t border-border pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Grand Total</span>
                  <span className="text-xl font-bold font-mono text-indigo-400">{fmt(grandTotal)}</span>
                </div>
                {budgetPct !== null && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {budgetPct}% of approved budget ({fmt(budget)})
                  </p>
                )}
              </div>

              {grandTotal > 0 && (
                <Button
                  className="w-full mt-2"
                  size="sm"
                  onClick={handleSetBudget}
                  disabled={settingBudget}
                >
                  {settingBudget ? "Updating…" : "Set as Project Budget"}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
