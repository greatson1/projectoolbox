"use client";

import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Save, Edit3, Eye, X, Check, Plus, Trash2, Table as TableIcon } from "lucide-react";
import { toast } from "sonner";

interface SpreadsheetViewerProps {
  reportId: string;
  title: string;
  content: string; // CSV content
  status: string;
  projectName?: string;
  onSave: (content: string, comment?: string) => Promise<void>;
  onApprove?: () => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  onClose: () => void;
}

// ── Parse CSV → 2D array, handles quoted fields ──
function parseCsv(csv: string): string[][] {
  if (!csv.trim()) return [["Column A", "Column B", "Column C"], ["", "", ""]];
  const lines = csv.split("\n").filter(l => l.trim());
  return lines.map(line => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; }
      else if (line[i] === "," && !inQuotes) { cells.push(current.trim()); current = ""; }
      else { current += line[i]; }
    }
    cells.push(current.trim());
    return cells;
  });
}

// ── Serialise 2D array → CSV ──
function toCsv(data: string[][]): string {
  return data.map(row =>
    row.map(cell => (cell.includes(",") || cell.includes('"') || cell.includes("\n"))
      ? `"${cell.replace(/"/g, '""')}"` : cell
    ).join(",")
  ).join("\n");
}

// ── Column letter A, B … Z, AA … ──
function colLetter(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) { s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// ── Context-aware cell styling ──
function cellStyle(val: string): string {
  const v = val.trim();
  if (!v) return "text-muted-foreground/30";
  if (/^[£$€][\d,]+(\.\d+)?$/.test(v)) return "text-right font-mono text-emerald-400 tabular-nums";
  if (/^\d[\d,]*(\.\d+)?$/.test(v)) return "text-right font-mono tabular-nums";
  if (/^\d+(\.\d+)?%$/.test(v)) return "text-right font-mono text-blue-400 tabular-nums";
  if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(v)) return "text-amber-300 font-mono text-xs";
  if (/^(HIGH|CRITICAL)$/i.test(v)) return "text-red-400 font-semibold";
  if (/^MEDIUM$/i.test(v)) return "text-amber-400 font-semibold";
  if (/^LOW$/i.test(v)) return "text-emerald-400 font-semibold";
  if (/^(COMPLETE|DONE|APPROVED|YES)$/i.test(v)) return "text-emerald-400 font-semibold";
  if (/^(IN PROGRESS|ACTIVE|ONGOING)$/i.test(v)) return "text-blue-400 font-semibold";
  if (/^(PENDING|NOT STARTED|TBD)$/i.test(v)) return "text-muted-foreground italic";
  if (/^(BLOCKED|OVERDUE|REJECTED|NO)$/i.test(v)) return "text-red-400 font-semibold";
  return "";
}

export function SpreadsheetViewer({
  reportId, title, content, status, projectName,
  onSave, onApprove, onReject, onClose,
}: SpreadsheetViewerProps) {
  const [data, setData] = useState<string[][]>(() => parseCsv(content));
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const headers = data[0] || [];
  const rows = data.slice(1);
  const maxCols = Math.max(...data.map(r => r.length), 1);

  const setCell = (ri: number, ci: number, val: string) => {
    setData(prev => {
      const next = prev.map(r => [...r]);
      while (!next[ri]) next[ri] = [];
      while (next[ri].length <= ci) next[ri].push("");
      next[ri][ci] = val;
      return next;
    });
  };

  const addRow = () => setData(prev => [...prev, new Array(maxCols).fill("")]);
  const addCol = () => setData(prev => prev.map((r, i) => [...r, i === 0 ? `Column ${colLetter(maxCols)}` : ""]));
  const deleteRow = (ri: number) => setData(prev => prev.filter((_, i) => i !== ri + 1));

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(toCsv(data)); setMode("view"); toast.success("Spreadsheet saved"); }
    catch { toast.error("Save failed"); }
    setSaving(false);
  };

  const downloadXlsx = () => {
    const a = document.createElement("a");
    a.href = `/api/agents/artefacts/${reportId}/export?format=xlsx`;
    a.download = `${title.replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_")}.xlsx`;
    a.click();
    toast.success("Downloading Excel file…");
  };

  const downloadCsv = () => {
    const blob = new Blob([toCsv(data)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
          <div>
            <div className="flex items-center gap-2">
              <TableIcon className="w-4 h-4 text-emerald-500" />
              <h1 className="text-sm font-bold">{title}</h1>
              <Badge variant={status === "APPROVED" ? "default" : "secondary"} className="text-[9px]">{status}</Badge>
              <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30">Spreadsheet</Badge>
            </div>
            {projectName && (
              <p className="text-[10px] text-muted-foreground ml-6">{projectName} · {rows.length} rows · {maxCols} columns</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button className={`px-3 py-1 text-xs font-semibold flex items-center gap-1 ${mode === "view" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              onClick={() => setMode("view")}><Eye className="w-3 h-3" /> View</button>
            <button className={`px-3 py-1 text-xs font-semibold flex items-center gap-1 ${mode === "edit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              onClick={() => setMode("edit")}><Edit3 className="w-3 h-3" /> Edit</button>
          </div>

          <Button variant="outline" size="sm" onClick={downloadXlsx} className="text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10">
            <Download className="w-3.5 h-3.5 mr-1" /> Excel (.xlsx)
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            <Download className="w-3.5 h-3.5 mr-1" /> CSV
          </Button>

          {mode === "edit" && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="w-3.5 h-3.5 mr-1" />{saving ? "Saving…" : "Save"}
            </Button>
          )}
          {status === "DRAFT" && onApprove && (
            <>
              <Button size="sm" onClick={onApprove}><Check className="w-3.5 h-3.5 mr-1" /> Approve</Button>
              <Button variant="destructive" size="sm" onClick={() => setShowRejectModal(true)}><X className="w-3.5 h-3.5 mr-1" /> Reject</Button>
            </>
          )}
        </div>
      </div>

      {/* Edit toolbar */}
      {mode === "edit" && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 flex-shrink-0">
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={addRow}><Plus className="w-3 h-3 mr-1" /> Row</Button>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={addCol}><Plus className="w-3 h-3 mr-1" /> Column</Button>
          <span className="text-[10px] text-muted-foreground ml-2">Click cell to edit · Tab to move right · Enter to move down</span>
        </div>
      )}

      {/* Spreadsheet grid */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-xs" style={{ minWidth: `${(maxCols + 1) * 140}px`, width: "100%" }}>
          <thead className="sticky top-0 z-10">
            {/* Column letters row */}
            <tr className="bg-muted/60">
              <th className="w-12 px-1 py-1 border border-border/20 text-[9px] text-muted-foreground/40 font-mono sticky left-0 z-20 bg-muted/60" />
              {Array.from({ length: maxCols }).map((_, ci) => (
                <th key={ci} className="px-2 py-1 border border-border/20 text-[9px] text-muted-foreground/40 font-mono font-normal text-center min-w-[140px]">
                  {colLetter(ci)}
                </th>
              ))}
            </tr>
            {/* Header row */}
            <tr className="bg-primary/15">
              <td className="w-12 px-1 py-1.5 border border-border/20 text-[9px] text-muted-foreground/40 text-center font-mono sticky left-0 z-20 bg-primary/15 select-none">1</td>
              {Array.from({ length: maxCols }).map((_, ci) => (
                <th key={ci} className="border border-border/20 text-left font-semibold text-foreground p-0">
                  {mode === "edit" ? (
                    <input className="w-full px-2 py-1.5 bg-transparent outline-none focus:bg-primary/10 font-semibold text-xs"
                      value={headers[ci] || ""} onChange={e => setCell(0, ci, e.target.value)} />
                  ) : (
                    <span className="block px-2 py-1.5 text-xs">{headers[ci] || ""}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={`group ${ri % 2 === 0 ? "bg-background" : "bg-muted/10"} hover:bg-primary/5 transition-colors`}>
                <td className="w-12 px-1 py-0 border border-border/20 text-[9px] text-muted-foreground/40 text-center font-mono sticky left-0 bg-inherit z-10 select-none">
                  <div className="flex items-center justify-between px-1">
                    <span>{ri + 2}</span>
                    {mode === "edit" && (
                      <button onClick={() => deleteRow(ri)} className="opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive transition-opacity">
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </td>
                {Array.from({ length: maxCols }).map((_, ci) => {
                  const val = row[ci] || "";
                  const isSelected = selected?.[0] === ri + 1 && selected?.[1] === ci;
                  return (
                    <td key={ci}
                      className={`border border-border/20 p-0 ${isSelected ? "ring-2 ring-inset ring-primary" : ""}`}
                      onClick={() => setSelected([ri + 1, ci])}>
                      {mode === "edit" ? (
                        <input
                          autoFocus={isSelected}
                          className={`w-full px-2 py-1.5 bg-transparent outline-none focus:bg-primary/5 ${cellStyle(val)}`}
                          value={val}
                          onChange={e => setCell(ri + 1, ci, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Tab") { e.preventDefault(); setSelected([ri + 1, ci + 1]); }
                            if (e.key === "Enter") { setSelected([ri + 2, ci]); }
                            if (e.key === "Escape") setSelected(null);
                            if (e.key === "ArrowRight" && (e.target as HTMLInputElement).selectionStart === val.length) setSelected([ri + 1, ci + 1]);
                            if (e.key === "ArrowLeft" && (e.target as HTMLInputElement).selectionStart === 0) setSelected([ri + 1, ci - 1]);
                            if (e.key === "ArrowDown") setSelected([ri + 2, ci]);
                            if (e.key === "ArrowUp") setSelected([ri, ci]);
                          }}
                        />
                      ) : (
                        <span className={`block px-2 py-1.5 ${cellStyle(val)}`}>{val}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {mode === "edit" && (
              <tr>
                <td className="border border-border/10" />
                <td colSpan={maxCols} className="border border-border/10 px-2 py-1">
                  <button onClick={addRow} className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground flex items-center gap-1 transition-colors">
                    <Plus className="w-3 h-3" /> Add row
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1 border-t border-border bg-muted/30 text-[10px] text-muted-foreground flex-shrink-0">
        <div className="flex items-center gap-4">
          <span>Status: <strong className="text-foreground">{status}</strong></span>
          <span>{rows.length} rows · {maxCols} columns</span>
          {selected && <span className="text-primary">Selected: {colLetter(selected[1])}{selected[0] + 1}</span>}
        </div>
        <span>ID: {reportId.slice(-8)}</span>
      </div>

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setShowRejectModal(false)}>
          <Card className="w-[400px]" onClick={e => e.stopPropagation()}>
            <CardContent className="pt-5 space-y-4">
              <h3 className="text-base font-bold text-destructive">Reject Document</h3>
              <p className="text-sm text-muted-foreground">Provide a reason — the agent will be notified and may revise.</p>
              <textarea className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-input resize-none"
                rows={3} placeholder="Reason for rejection…"
                value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowRejectModal(false)}>Cancel</Button>
                <Button variant="destructive" size="sm"
                  onClick={async () => { await onReject?.(rejectReason); setShowRejectModal(false); }}
                  disabled={!rejectReason.trim()}>
                  <X className="w-3.5 h-3.5 mr-1" /> Reject with Feedback
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
