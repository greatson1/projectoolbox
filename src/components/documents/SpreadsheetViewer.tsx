"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Download, Upload, Save, Eye, Edit3, X, FileSpreadsheet,
  Plus, Trash2, Copy, ArrowUpDown, Filter, History, Check,
  ChevronLeft, ChevronRight, Bold, Italic,
} from "lucide-react";

// ── Types ──
interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  bg?: string;
  align?: "left" | "center" | "right";
  format?: "text" | "number" | "currency" | "percent" | "date";
}

interface SpreadsheetCell {
  value: string | number | null;
  formula?: string;
  style?: CellStyle;
}

interface SpreadsheetData {
  name: string;
  headers: { key: string; label: string; width?: number; style?: CellStyle }[];
  rows: Record<string, SpreadsheetCell>[];
  summary?: Record<string, SpreadsheetCell>;
}

interface SpreadsheetViewerProps {
  reportId: string;
  title: string;
  type: string;
  status: string;
  projectName?: string;
  sheets: SpreadsheetData[];
  onSave?: (sheets: SpreadsheetData[]) => Promise<void>;
  onExport?: () => void;
  onUpload?: (file: File) => Promise<void>;
  onClose: () => void;
}

// ── Format cell value ──
function formatValue(cell: SpreadsheetCell | null | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const v = cell.value;
  const fmt = cell.style?.format;
  if (fmt === "currency" && typeof v === "number") return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
  if (fmt === "percent" && typeof v === "number") return `${v}%`;
  if (fmt === "number" && typeof v === "number") return v.toLocaleString();
  return String(v);
}

// ── Cell colour based on value ──
function getCellClass(cell: SpreadsheetCell | null | undefined, colKey: string): string {
  if (!cell) return "";
  const v = cell.value;
  if (typeof v === "number") {
    if (colKey.includes("variance") || colKey.includes("delta")) {
      return v > 0 ? "text-green-500" : v < 0 ? "text-destructive" : "";
    }
    if (colKey.includes("score") || colKey.includes("risk")) {
      return Number(v) >= 15 ? "text-destructive font-bold" : Number(v) >= 8 ? "text-amber-500 font-semibold" : "text-green-500";
    }
  }
  if (cell.style?.color) return "";
  return "";
}

// ── Column letter (A, B, C...) ──
function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

export function SpreadsheetViewer({
  reportId, title, type, status, projectName,
  sheets, onSave, onExport, onUpload, onClose,
}: SpreadsheetViewerProps) {
  const [activeSheet, setActiveSheet] = useState(0);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editData, setEditData] = useState<SpreadsheetData[]>(sheets);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterCol, setFilterCol] = useState<string | null>(null);
  const [filterVal, setFilterVal] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sheet = editData[activeSheet];
  if (!sheet) return null;

  // Sort rows
  let displayRows = [...sheet.rows];
  if (sortCol) {
    displayRows.sort((a, b) => {
      const av = a[sortCol]?.value ?? "";
      const bv = b[sortCol]?.value ?? "";
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }
  if (filterCol && filterVal) {
    displayRows = displayRows.filter(r => String(r[filterCol!]?.value || "").toLowerCase().includes(filterVal.toLowerCase()));
  }

  const handleCellEdit = (rowIdx: number, colKey: string, value: string) => {
    const newData = [...editData];
    const row = { ...newData[activeSheet].rows[rowIdx] };
    row[colKey] = { ...row[colKey], value: isNaN(Number(value)) ? value : Number(value) };
    newData[activeSheet].rows[rowIdx] = row;
    setEditData(newData);
  };

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try { await onSave(editData); setMode("view"); } catch { alert("Save failed"); }
    setSaving(false);
  };

  const handleExportXLSX = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();

    for (const s of editData) {
      const ws = wb.addWorksheet(s.name);

      // Headers
      ws.addRow(s.headers.map(h => h.label));
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, size: 11 };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
      headerRow.font = { bold: true, color: { argb: "FFF1F5F9" }, size: 11 };

      s.headers.forEach((h, i) => {
        ws.getColumn(i + 1).width = h.width || 15;
      });

      // Data rows
      for (const row of s.rows) {
        const values = s.headers.map(h => row[h.key]?.value ?? "");
        const excelRow = ws.addRow(values);
        s.headers.forEach((h, i) => {
          const cell = row[h.key];
          if (cell?.style?.bold) excelRow.getCell(i + 1).font = { bold: true };
          if (cell?.style?.format === "currency") excelRow.getCell(i + 1).numFmt = "$#,##0";
          if (cell?.style?.format === "percent") excelRow.getCell(i + 1).numFmt = "0%";
        });
      }

      // Summary row
      if (s.summary) {
        ws.addRow([]);
        const sumValues = s.headers.map(h => s.summary![h.key]?.value ?? "");
        const sumRow = ws.addRow(sumValues);
        sumRow.font = { bold: true };
        sumRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
        sumRow.font = { bold: true, color: { argb: "FFF1F5F9" } };
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${title.replace(/\s+/g, "_")}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
    await onUpload(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
          <FileSpreadsheet className="w-5 h-5 text-green-500" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold">{title}</h1>
              <Badge variant={status === "PUBLISHED" ? "default" : "secondary"} className="text-[9px]">{status}</Badge>
              <Badge variant="outline" className="text-[9px] bg-green-500/10 text-green-500 border-green-500/20">Spreadsheet</Badge>
            </div>
            {projectName && <p className="text-[10px] text-muted-foreground">{projectName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button className={`px-3 py-1 text-xs font-semibold flex items-center gap-1 ${mode === "view" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => setMode("view")}><Eye className="w-3 h-3" /> View</button>
            <button className={`px-3 py-1 text-xs font-semibold flex items-center gap-1 ${mode === "edit" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => setMode("edit")}><Edit3 className="w-3 h-3" /> Edit</button>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportXLSX}><Download className="w-3.5 h-3.5 mr-1" /> XLSX</Button>
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" className="hidden" onChange={handleUpload} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><Upload className="w-3.5 h-3.5 mr-1" /> Upload</Button>
          {mode === "edit" && <Button size="sm" onClick={handleSave} disabled={saving}><Save className="w-3.5 h-3.5 mr-1" /> {saving ? "Saving..." : "Save"}</Button>}
        </div>
      </div>

      {/* Toolbar (edit mode) */}
      {mode === "edit" && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30">
          {selectedCell && (
            <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 bg-muted rounded">
              {colLetter(sheet.headers.findIndex(h => h.key === selectedCell.col))}{selectedCell.row + 1}
            </span>
          )}
          <div className="w-px h-4 bg-border" />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Bold className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Italic className="w-3.5 h-3.5" /></Button>
          <div className="w-px h-4 bg-border" />
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => { /* add row */ }}>
            <Plus className="w-3 h-3 mr-1" /> Row
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => { /* add col */ }}>
            <Plus className="w-3 h-3 mr-1" /> Column
          </Button>
          {filterCol && (
            <div className="flex items-center gap-1 ml-2">
              <Filter className="w-3 h-3 text-muted-foreground" />
              <input className="px-2 py-0.5 rounded text-[10px] bg-background border border-input w-[120px]"
                placeholder="Filter..." value={filterVal} onChange={e => setFilterVal(e.target.value)} />
              <button className="text-muted-foreground" onClick={() => { setFilterCol(null); setFilterVal(""); }}><X className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      )}

      {/* Sheet tabs */}
      <div className="flex items-center gap-1 px-4 py-1 border-b border-border bg-muted/20">
        {editData.map((s, i) => (
          <button key={i} className={`px-3 py-1 text-xs font-semibold rounded-t transition-colors ${activeSheet === i ? "bg-card text-foreground border border-border border-b-0" : "text-muted-foreground hover:bg-muted"}`}
            onClick={() => setActiveSheet(i)}>
            {s.name}
          </button>
        ))}
      </div>

      {/* Spreadsheet grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted">
              {/* Row number column */}
              <th className="w-10 px-2 py-2 text-center text-[10px] font-semibold text-muted-foreground border-b border-r border-border bg-muted sticky left-0 z-20">#</th>
              {sheet.headers.map((h, i) => (
                <th key={h.key} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-r border-border bg-muted cursor-pointer hover:bg-muted/80 select-none"
                  style={{ minWidth: h.width ? `${h.width}px` : "120px" }}
                  onClick={() => handleSort(h.key)}>
                  <div className="flex items-center justify-between gap-1">
                    <span>{h.label}</span>
                    <div className="flex items-center gap-0.5">
                      {sortCol === h.key && <ArrowUpDown className="w-3 h-3 text-primary" />}
                      {mode === "edit" && (
                        <button className="opacity-0 group-hover:opacity-100" onClick={e => { e.stopPropagation(); setFilterCol(h.key); }}>
                          <Filter className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-muted/20 transition-colors">
                <td className="px-2 py-1.5 text-center text-[10px] text-muted-foreground border-b border-r border-border bg-muted/30 sticky left-0">{rowIdx + 1}</td>
                {sheet.headers.map(h => {
                  const cell = row[h.key];
                  const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === h.key;
                  return (
                    <td key={h.key}
                      className={`px-3 py-1.5 border-b border-r border-border transition-colors ${isSelected ? "ring-2 ring-primary ring-inset bg-primary/5" : ""} ${getCellClass(cell, h.key)} ${cell?.style?.bold ? "font-bold" : ""} ${cell?.style?.italic ? "italic" : ""}`}
                      style={{
                        textAlign: cell?.style?.align || (typeof cell?.value === "number" ? "right" : "left"),
                        backgroundColor: cell?.style?.bg || undefined,
                        color: cell?.style?.color || undefined,
                      }}
                      onClick={() => setSelectedCell({ row: rowIdx, col: h.key })}>
                      {mode === "edit" && isSelected ? (
                        <input className="w-full bg-transparent outline-none text-xs"
                          value={cell?.value ?? ""} autoFocus
                          onChange={e => handleCellEdit(rowIdx, h.key, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Tab") { e.preventDefault(); const ci = sheet.headers.findIndex(x => x.key === h.key); if (ci < sheet.headers.length - 1) setSelectedCell({ row: rowIdx, col: sheet.headers[ci + 1].key }); }
                            if (e.key === "Enter") { e.preventDefault(); if (rowIdx < displayRows.length - 1) setSelectedCell({ row: rowIdx + 1, col: h.key }); }
                            if (e.key === "Escape") setSelectedCell(null);
                          }} />
                      ) : (
                        <span>{formatValue(cell)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Summary row */}
            {sheet.summary && (
              <tr className="bg-muted font-bold border-t-2 border-border">
                <td className="px-2 py-2 text-center text-[10px] text-muted-foreground border-b border-r border-border sticky left-0 bg-muted">Σ</td>
                {sheet.headers.map(h => {
                  const cell = sheet.summary![h.key];
                  return (
                    <td key={h.key} className={`px-3 py-2 border-b border-r border-border ${getCellClass(cell, h.key)}`}
                      style={{ textAlign: typeof cell?.value === "number" ? "right" : "left" }}>
                      {formatValue(cell)}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>Rows: {displayRows.length}</span>
          <span>Columns: {sheet.headers.length}</span>
          {selectedCell && <span>Cell: {colLetter(sheet.headers.findIndex(h => h.key === selectedCell.col))}{selectedCell.row + 1}</span>}
          {filterVal && <span>Filtered: {displayRows.length} of {sheet.rows.length}</span>}
        </div>
        <span>{editData.length} sheet{editData.length > 1 ? "s" : ""} · {title}</span>
      </div>
    </div>
  );
}

// ── Pre-built spreadsheet templates ──
export const SPREADSHEET_TEMPLATES = {
  riskRegister: (risks: any[]): SpreadsheetData[] => [{
    name: "Risk Register",
    headers: [
      { key: "id", label: "ID", width: 80 },
      { key: "title", label: "Risk Description", width: 250 },
      { key: "category", label: "Category", width: 100 },
      { key: "probability", label: "P", width: 50, style: { align: "center" as const } },
      { key: "impact", label: "I", width: 50, style: { align: "center" as const } },
      { key: "score", label: "Score", width: 60, style: { align: "center" as const } },
      { key: "status", label: "Status", width: 90 },
      { key: "owner", label: "Owner", width: 120 },
      { key: "mitigation", label: "Mitigation Strategy", width: 300 },
    ],
    rows: risks.map((r, i) => ({
      id: { value: r.id?.slice(-6) || `R-${i + 1}` },
      title: { value: r.title },
      category: { value: r.category || "General" },
      probability: { value: r.probability, style: { align: "center" as const } },
      impact: { value: r.impact, style: { align: "center" as const } },
      score: { value: r.score || r.probability * r.impact, style: { align: "center" as const, bold: true } },
      status: { value: r.status },
      owner: { value: r.owner || "Unassigned" },
      mitigation: { value: r.mitigation || "" },
    })),
    summary: {
      id: { value: "TOTAL" },
      title: { value: `${risks.length} risks` },
      category: { value: "" },
      probability: { value: "" },
      impact: { value: "" },
      score: { value: Math.round(risks.reduce((s: number, r: any) => s + (r.score || r.probability * r.impact), 0) / (risks.length || 1)), style: { bold: true } },
      status: { value: "" },
      owner: { value: "" },
      mitigation: { value: "" },
    },
  }],

  budget: (budget: number, categories: any[]): SpreadsheetData[] => [{
    name: "Budget Tracker",
    headers: [
      { key: "category", label: "Category", width: 160 },
      { key: "budget", label: "Budget", width: 120, style: { format: "currency" as const } },
      { key: "actual", label: "Actual", width: 120, style: { format: "currency" as const } },
      { key: "variance", label: "Variance", width: 120, style: { format: "currency" as const } },
      { key: "pctSpent", label: "% Spent", width: 80, style: { format: "percent" as const } },
    ],
    rows: categories.map(c => ({
      category: { value: c.name },
      budget: { value: c.budget, style: { format: "currency" as const } },
      actual: { value: c.actual, style: { format: "currency" as const } },
      variance: { value: c.budget - c.actual, style: { format: "currency" as const } },
      pctSpent: { value: Math.round((c.actual / c.budget) * 100), style: { format: "percent" as const } },
    })),
    summary: {
      category: { value: "TOTAL", style: { bold: true } },
      budget: { value: budget, style: { format: "currency" as const, bold: true } },
      actual: { value: categories.reduce((s: number, c: any) => s + c.actual, 0), style: { format: "currency" as const, bold: true } },
      variance: { value: budget - categories.reduce((s: number, c: any) => s + c.actual, 0), style: { format: "currency" as const, bold: true } },
      pctSpent: { value: Math.round((categories.reduce((s: number, c: any) => s + c.actual, 0) / budget) * 100), style: { format: "percent" as const, bold: true } },
    },
  }],

  taskTracker: (tasks: any[]): SpreadsheetData[] => [{
    name: "Task Tracker",
    headers: [
      { key: "id", label: "ID", width: 80 },
      { key: "title", label: "Task", width: 250 },
      { key: "status", label: "Status", width: 100 },
      { key: "priority", label: "Priority", width: 80 },
      { key: "sp", label: "SP", width: 50 },
      { key: "progress", label: "Progress", width: 80, style: { format: "percent" as const } },
      { key: "assignee", label: "Assignee", width: 120 },
      { key: "start", label: "Start", width: 100 },
      { key: "end", label: "End", width: 100 },
    ],
    rows: tasks.map((t, i) => ({
      id: { value: t.id?.slice(-6) || `T-${i + 1}` },
      title: { value: t.title },
      status: { value: t.status },
      priority: { value: t.priority || "MEDIUM" },
      sp: { value: t.storyPoints || 0 },
      progress: { value: t.progress || 0, style: { format: "percent" as const } },
      assignee: { value: t.assigneeId || "Unassigned" },
      start: { value: t.startDate ? new Date(t.startDate).toLocaleDateString() : "" },
      end: { value: t.endDate ? new Date(t.endDate).toLocaleDateString() : "" },
    })),
    summary: {
      id: { value: "TOTAL" },
      title: { value: `${tasks.length} tasks` },
      status: { value: `${tasks.filter((t: any) => t.status === "DONE").length} done` },
      priority: { value: "" },
      sp: { value: tasks.reduce((s: number, t: any) => s + (t.storyPoints || 0), 0) },
      progress: { value: Math.round(tasks.reduce((s: number, t: any) => s + (t.progress || 0), 0) / (tasks.length || 1)), style: { format: "percent" as const } },
      assignee: { value: "" },
      start: { value: "" },
      end: { value: "" },
    },
  }],
};
