// @ts-nocheck
"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents } from "@/hooks/use-api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Search, Plus, FileText, Globe, Mail, MessageSquare, Brain,
  Upload, Link2, Trash2, Shield, X, Loader2, Microscope, Eye, Edit3,
  Tag, Network, ArrowLeft, Save, Hash, Clock, List, GitBranch,
} from "lucide-react";
import { KBGraphView } from "@/components/knowledge/KBGraphView";

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, { icon: any; label: string; color: string }> = {
  TEXT:       { icon: FileText,     label: "Text",       color: "#6366F1" },
  FILE:       { icon: Upload,       label: "File",       color: "#22D3EE" },
  URL:        { icon: Globe,        label: "Web",        color: "#10B981" },
  EMAIL:      { icon: Mail,         label: "Email",      color: "#F59E0B" },
  TRANSCRIPT: { icon: MessageSquare,label: "Transcript", color: "#8B5CF6" },
  CHAT:       { icon: MessageSquare,label: "Chat",       color: "#EC4899" },
  DECISION:   { icon: Brain,        label: "Decision",   color: "#EF4444" },
  IMAGE:      { icon: Upload,       label: "Image",      color: "#14B8A6" },
};

const TRUST_COLORS: Record<string, string> = {
  HIGH_TRUST:     "text-emerald-500",
  STANDARD:       "text-muted-foreground",
  REFERENCE_ONLY: "text-amber-500",
};

const LAYERS = [
  { id: null,        label: "All" },
  { id: "PROJECT",   label: "Project" },
  { id: "WORKSPACE", label: "Workspace" },
  { id: "AGENT",     label: "Agent" },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export default function KnowledgeBasePage() {
  usePageTitle("Knowledge Base");

  const [items, setItems]           = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterLayer, setFilterLayer] = useState<string | null>(null);
  const [filterTag, setFilterTag]   = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing]       = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle]   = useState("");
  const [saving, setSaving]         = useState(false);
  const [showAdd, setShowAdd]       = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [viewMode, setViewMode]     = useState<"list" | "graph">("list");

  const { data: agentsData } = useAgents();
  const agents = agentsData?.agents || [];

  useEffect(() => {
    if (!selectedAgent && agents.length > 0) setSelectedAgent(agents[0]?.id || "");
  }, [agents, selectedAgent]);

  const fetchItems = () => {
    if (!selectedAgent) { setLoading(false); return; }
    setLoading(true);
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (filterType)  params.set("type", filterType);
    if (filterLayer) params.set("layer", filterLayer);
    fetch(`/api/agents/${selectedAgent}/knowledge?${params}`)
      .then(r => r.json())
      .then(d => { setItems(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); }, [selectedAgent, searchQuery, filterType, filterLayer]);

  const selectedItem = useMemo(() => items.find(i => i.id === selectedId), [items, selectedId]);

  // Tag cloud
  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(i => (i.tags || []).forEach((t: string) => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [items]);

  // Backlinks
  const backlinks = useMemo(() => {
    if (!selectedItem) return [];
    const title = (selectedItem.title || "").toLowerCase();
    return items.filter(i =>
      i.id !== selectedId &&
      ((i.content || "").toLowerCase().includes(title) ||
       (i.tags || []).some((t: string) => (selectedItem.tags || []).includes(t)))
    );
  }, [selectedItem, items, selectedId]);

  // Client-side secondary filter (tag only — type/layer/search go to API)
  const filtered = useMemo(() => {
    return items.filter(i => {
      if (filterTag && !(i.tags || []).includes(filterTag)) return false;
      return true;
    });
  }, [items, filterTag]);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    await fetch(`/api/agents/${selectedAgent}/knowledge`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: selectedId, title: editTitle, content: editContent }),
    });
    setItems(prev => prev.map(i => i.id === selectedId ? { ...i, title: editTitle, content: editContent } : i));
    setEditing(false);
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/agents/${selectedAgent}/knowledge?itemId=${id}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  if (loading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="flex gap-4"><Skeleton className="h-[600px] w-72" /><Skeleton className="h-[600px] flex-1" /></div>
    </div>
  );

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Knowledge Base</h1>
          <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
          <select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}
            className="ml-2 px-2 py-1 rounded-lg border border-border bg-background text-xs outline-none">
            {agents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setViewMode("list")}
              className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${viewMode === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              <List className="w-3.5 h-3.5" /> List
            </button>
            <button onClick={() => setViewMode("graph")}
              className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors border-l border-border ${viewMode === "graph" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              <GitBranch className="w-3.5 h-3.5" /> Graph
            </button>
          </div>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowResearch(true)}>
            <Microscope className="w-3.5 h-3.5 mr-1" /> Research
          </Button>
          <Button size="sm" className="text-xs" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Knowledge
          </Button>
        </div>
      </div>

      {/* ── Layer tabs ── */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/40 mb-3 flex-shrink-0">
        {LAYERS.map(l => (
          <button key={String(l.id)} onClick={() => setFilterLayer(l.id)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${filterLayer === l.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {l.label}
          </button>
        ))}
      </div>

      {/* ── Graph view ── */}
      {viewMode === "graph" ? (
        <KBGraphView
          items={filtered}
          onSelect={(id) => { setSelectedId(id); setViewMode("list"); }}
          selectedId={selectedId}
        />
      ) : (
      /* ── Obsidian split pane ── */
      <div className="flex gap-0 flex-1 overflow-hidden rounded-xl border border-border">

        {/* Left sidebar — file explorer */}
        <div className="w-72 flex-shrink-0 border-r border-border flex flex-col bg-muted/20">

          {/* Search */}
          <div className="p-3 border-b border-border/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search knowledge base..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs outline-none" />
            </div>
          </div>

          {/* Type filters */}
          <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-border/30">
            <button onClick={() => setFilterType(null)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${!filterType ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              All
            </button>
            {Object.entries(TYPE_ICONS).slice(0, 5).map(([key, val]) => (
              <button key={key} onClick={() => setFilterType(filterType === key ? null : key)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium ${filterType === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {val.label}
              </button>
            ))}
          </div>

          {/* Tag cloud */}
          {allTags.length > 0 && (
            <div className="px-3 py-2 border-b border-border/30">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                <Hash className="w-3 h-3 inline mr-0.5" />Tags
              </p>
              <div className="flex flex-wrap gap-1">
                {allTags.slice(0, 15).map(([tag, count]) => (
                  <button key={tag} onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                    className={`px-1.5 py-0.5 rounded text-[9px] ${filterTag === tag ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground hover:text-foreground"}`}>
                    {tag} <span className="opacity-50">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Item list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-muted-foreground mb-3">No items found</p>
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowAdd(true)}>
                  <Plus className="w-3 h-3 mr-1" /> Add Knowledge
                </Button>
              </div>
            ) : (
              filtered.map(item => {
                const typeConfig = TYPE_ICONS[item.type] || TYPE_ICONS.TEXT;
                const Icon = typeConfig.icon;
                const isActive = selectedId === item.id;
                return (
                  <button key={item.id}
                    onClick={() => { setSelectedId(item.id); setEditing(false); setEditContent(item.content); setEditTitle(item.title); }}
                    className={`w-full text-left px-3 py-2.5 border-b border-border/20 hover:bg-muted/30 transition-colors ${isActive ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}>
                    <div className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: typeConfig.color }} />
                      <span className="text-xs font-medium truncate flex-1">{item.title}</span>
                      {item.confidential && <Shield className="w-3 h-3 text-destructive flex-shrink-0" />}
                      <span className={`text-[9px] flex-shrink-0 ${TRUST_COLORS[item.trustLevel] || ""}`}>
                        {item.trustLevel === "HIGH_TRUST" ? "H" : item.trustLevel === "REFERENCE_ONLY" ? "R" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 pl-5">
                      <p className="text-[10px] text-muted-foreground truncate flex-1">
                        {(item.content || "").slice(0, 55)}
                      </p>
                      {item.layer && (
                        <Badge variant="secondary" className="text-[8px] px-1 flex-shrink-0">{item.layer}</Badge>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right — content viewer / editor */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {!selectedItem ? (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <Brain className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Select an item to view</p>
                <p className="text-xs text-muted-foreground/50 mt-1">{filtered.length} of {items.length} items shown</p>
                <div className="flex gap-2 justify-center mt-4">
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowAdd(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Add Knowledge
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowResearch(true)}>
                    <Microscope className="w-3 h-3 mr-1" /> Run Research
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Note header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-border/30 flex-shrink-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {editing ? (
                    <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                      className="text-sm font-bold bg-transparent outline-none flex-1 border-b border-primary/30 pb-0.5" />
                  ) : (
                    <h2 className="text-sm font-bold truncate">{selectedItem.title}</h2>
                  )}
                  <Badge variant="secondary" className="text-[9px] flex-shrink-0">{selectedItem.type}</Badge>
                  <Badge variant="secondary" className="text-[9px] flex-shrink-0">{selectedItem.layer}</Badge>
                  {selectedItem.confidential && (
                    <Badge variant="destructive" className="text-[9px] flex-shrink-0">
                      <Shield className="w-2.5 h-2.5 mr-0.5" />Confidential
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {editing ? (
                    <>
                      <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
                        <Save className="w-3 h-3 mr-1" />{saving ? "Saving..." : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => { setEditing(true); setEditContent(selectedItem.content); setEditTitle(selectedItem.title); }}>
                        <Edit3 className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                        onClick={() => handleDelete(selectedItem.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Meta bar */}
              <div className="px-5 py-2 border-b border-border/20 flex items-center gap-3 text-[10px] text-muted-foreground flex-shrink-0 flex-wrap">
                <span>
                  <Clock className="w-3 h-3 inline mr-0.5" />
                  {new Date(selectedItem.updatedAt || selectedItem.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
                {selectedItem.sourceUrl && (
                  <a href={selectedItem.sourceUrl} target="_blank" rel="noopener" className="text-primary hover:underline">
                    <Globe className="w-3 h-3 inline mr-0.5" />Source
                  </a>
                )}
                <span className={TRUST_COLORS[selectedItem.trustLevel]}>
                  {selectedItem.trustLevel === "HIGH_TRUST" ? "High Trust" : selectedItem.trustLevel === "REFERENCE_ONLY" ? "Reference Only" : "Standard"}
                </span>
                {selectedItem.tags?.map((t: string) => (
                  <button key={t} onClick={() => { setFilterTag(t); setSelectedId(null); }}
                    className="px-1.5 py-0.5 rounded bg-muted/50 hover:bg-primary/10 text-[9px]">#{t}</button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto">
                {editing ? (
                  <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                    className="w-full h-full px-5 py-4 text-sm font-mono bg-transparent outline-none resize-none leading-relaxed"
                    placeholder="Write in Markdown..." />
                ) : (
                  <div className="px-5 py-4 prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedItem.content || ""}</ReactMarkdown>
                  </div>
                )}
              </div>

              {/* Backlinks */}
              {backlinks.length > 0 && !editing && (
                <div className="border-t border-border/30 px-5 py-3 flex-shrink-0 bg-muted/10">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    <Network className="w-3 h-3 inline mr-1" />Backlinks ({backlinks.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {backlinks.slice(0, 8).map(bl => (
                      <button key={bl.id}
                        onClick={() => { setSelectedId(bl.id); setEditContent(bl.content); setEditTitle(bl.title); }}
                        className="px-2 py-1 rounded-lg bg-muted/50 hover:bg-primary/10 text-[10px] font-medium transition-colors truncate max-w-[200px]">
                        <ArrowLeft className="w-2.5 h-2.5 inline mr-0.5" />{bl.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* ── Modals ── */}
      {showAdd && (
        <AddKnowledgeModal agentId={selectedAgent} onClose={() => { setShowAdd(false); fetchItems(); }} />
      )}
      {showResearch && (
        <ResearchModal agentId={selectedAgent} onClose={() => { setShowResearch(false); fetchItems(); }} />
      )}
    </div>
  );
}

// ─── Add Knowledge Modal ─────────────────────────────────────────────────────

function AddKnowledgeModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [tab, setTab]             = useState<"text" | "url" | "file">("text");
  const [title, setTitle]         = useState("");
  const [content, setContent]     = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [layer, setLayer]         = useState("PROJECT");
  const [trustLevel, setTrustLevel] = useState("STANDARD");
  const [tags, setTags]           = useState("");
  const [confidential, setConfidential] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    await fetch(`/api/agents/${agentId}/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        content: content.trim(),
        type: tab === "url" ? "URL" : "TEXT",
        layer,
        sourceUrl: sourceUrl || undefined,
        trustLevel,
        confidential,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      }),
    });
    setSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold">Add Knowledge</h2>
            <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 p-1 rounded-lg bg-muted/50 mb-4">
            {[
              { id: "text", icon: FileText, label: "Text" },
              { id: "url",  icon: Globe,   label: "URL" },
              { id: "file", icon: Upload,  label: "File" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id as any)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1 transition-all ${tab === t.id ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
                <t.icon className="w-3.5 h-3.5" />{t.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title *"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />

            {tab === "url" && (
              <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
            )}

            {tab === "file" ? (
              <div className="relative border-2 border-dashed border-border rounded-lg p-8 text-center">
                <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Drag & drop or click to upload</p>
                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setTitle(title || file.name);
                    const text = await file.text();
                    setContent(text.slice(0, 50000));
                    setTab("text");
                  }} />
              </div>
            ) : (
              <textarea value={content} onChange={e => setContent(e.target.value)} rows={7}
                placeholder={tab === "url" ? "Optional summary or notes..." : "Write in Markdown..."}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none resize-y font-mono" />
            )}

            <div className="grid grid-cols-2 gap-3">
              <select value={layer} onChange={e => setLayer(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none">
                <option value="PROJECT">Project Memory</option>
                <option value="WORKSPACE">Workspace Memory</option>
                <option value="AGENT">Agent Memory</option>
              </select>
              <select value={trustLevel} onChange={e => setTrustLevel(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none">
                <option value="HIGH_TRUST">High Trust</option>
                <option value="STANDARD">Standard</option>
                <option value="REFERENCE_ONLY">Reference Only</option>
              </select>
            </div>

            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma-separated)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />

            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={confidential} onChange={e => setConfidential(e.target.checked)}
                className="rounded border-border" />
              <Shield className="w-3.5 h-3.5 text-destructive" />
              <span>Mark as confidential</span>
            </label>
          </div>

          <div className="flex gap-2 justify-end mt-5">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={submitting || !title.trim()}>
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
              {submitting ? "Adding..." : "Add to KB"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Research Modal ───────────────────────────────────────────────────────────

function ResearchModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [type, setType]     = useState("pestle");
  const [query, setQuery]   = useState("");
  const [name, setName]     = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError]   = useState("");

  const TYPES = [
    { id: "pestle",      label: "PESTLE Scan",       cost: 8, desc: "Full 6-dimension environmental scan" },
    { id: "search",      label: "Web Search",        cost: 3, desc: "Targeted research query" },
    { id: "stakeholder", label: "Stakeholder Intel", cost: 5, desc: "Professional background research" },
    { id: "vendor",      label: "Vendor Research",   cost: 5, desc: "Vendor risk assessment" },
    { id: "news",        label: "News Monitor",      cost: 3, desc: "Latest industry developments" },
  ];

  const runResearch = async () => {
    setRunning(true); setError(""); setResult(null);
    try {
      const body: any = { type };
      if (type === "search")      body.query = query;
      if (type === "stakeholder") body.stakeholder = { name };
      if (type === "vendor")      body.vendor = { name };

      const r = await fetch(`/api/agents/${agentId}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok) setResult(d.data);
      else setError(d.error || "Research failed");
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Microscope className="w-5 h-5 text-primary" /> Internet Intelligence
            </h2>
            <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
          </div>

          {/* Research type selector */}
          <div className="grid grid-cols-5 gap-1.5 mb-4">
            {TYPES.map(t => (
              <button key={t.id} onClick={() => setType(t.id)}
                className={`p-2 rounded-lg text-center transition-all ${type === t.id ? "bg-primary/10 border border-primary/20" : "bg-muted/50 hover:bg-muted"}`}>
                <p className="text-[11px] font-semibold">{t.label}</p>
                <p className="text-[9px] text-muted-foreground">{t.cost} credits</p>
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mb-3">{TYPES.find(t => t.id === type)?.desc}</p>

          {type === "search" && (
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="What do you want to research?"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none mb-3" />
          )}
          {(type === "stakeholder" || type === "vendor") && (
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={type === "stakeholder" ? "Stakeholder name" : "Vendor / technology name"}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none mb-3" />
          )}

          <Button onClick={runResearch} className="w-full"
            disabled={running || (type === "search" && !query) || ((type === "stakeholder" || type === "vendor") && !name)}>
            {running
              ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Researching...</>
              : <><Microscope className="w-4 h-4 mr-1" />Run Research</>}
          </Button>

          {error && <p className="text-sm text-destructive mt-3">{error}</p>}

          {result && (
            <div className="mt-4 space-y-3">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-xs font-semibold text-emerald-500 mb-1">
                  Research Complete {result.cached && "(cached)"}
                </p>
                <p className="text-xs text-muted-foreground">{result.creditCost} credits used</p>
              </div>

              {/* PESTLE findings */}
              {result.findings && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold">{result.findings.length} findings · {result.risksCreated || 0} risks created</p>
                  {result.findings.slice(0, 8).map((f: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 text-xs">
                      <Badge variant={f.impact === "HIGH" ? "destructive" : "secondary"} className="text-[9px] flex-shrink-0 mt-0.5">
                        {f.impact}
                      </Badge>
                      <div>
                        <p className="font-medium">[{f.dimension}] {f.title}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Text results (search / stakeholder / vendor / news) */}
              {result.content && (
                <div className="p-3 rounded-lg bg-muted/30 text-xs leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                  {result.content}
                </div>
              )}

              {/* Sources */}
              {result.sources?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Sources</p>
                  {result.sources.slice(0, 5).map((s: string, i: number) => (
                    <a key={i} href={s} target="_blank" rel="noopener noreferrer"
                      className="block text-[10px] text-primary truncate hover:underline">{s}</a>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
