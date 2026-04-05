// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents } from "@/hooks/use-api";
import {
  Search, Plus, FileText, Globe, Mail, MessageSquare, Brain,
  Upload, Link, Trash2, Shield, X, Loader2, Microscope,
} from "lucide-react";

const TYPE_ICONS: Record<string, { icon: any; label: string; color: string }> = {
  TEXT: { icon: FileText, label: "Text", color: "#6366F1" },
  FILE: { icon: Upload, label: "File", color: "#22D3EE" },
  URL: { icon: Globe, label: "Web", color: "#10B981" },
  EMAIL: { icon: Mail, label: "Email", color: "#F59E0B" },
  TRANSCRIPT: { icon: MessageSquare, label: "Transcript", color: "#8B5CF6" },
  CHAT: { icon: MessageSquare, label: "Chat", color: "#EC4899" },
  DECISION: { icon: Brain, label: "Decision", color: "#EF4444" },
};

const TRUST_BADGES: Record<string, { label: string; cls: string }> = {
  HIGH_TRUST: { label: "High Trust", cls: "text-emerald-500 bg-emerald-500/10" },
  STANDARD: { label: "Standard", cls: "text-muted-foreground bg-muted" },
  REFERENCE_ONLY: { label: "Reference", cls: "text-amber-500 bg-amber-500/10" },
};

export default function KnowledgeBasePage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterLayer, setFilterLayer] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");

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
    if (filterType) params.set("type", filterType);
    if (filterLayer) params.set("layer", filterLayer);
    fetch(`/api/agents/${selectedAgent}/knowledge?${params}`)
      .then(r => r.json()).then(d => { setItems(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); }, [selectedAgent, searchQuery, filterType, filterLayer]);

  const deleteItem = async (itemId: string) => {
    await fetch(`/api/agents/${selectedAgent}/knowledge?itemId=${itemId}`, { method: "DELETE" });
    setItems(items.filter(i => i.id !== itemId));
  };

  return (
    <div className="max-w-[1100px] space-y-6 animate-page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1">Agent memory — documents, research, emails, transcripts</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm outline-none">
            {agents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => setShowResearch(true)}>
            <Microscope className="h-3.5 w-3.5 mr-1" /> Research
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Knowledge
          </Button>
        </div>
      </div>

      {/* Search + Type filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search knowledge base..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
        </div>
        <div className="flex gap-1">
          {[null, "TEXT", "FILE", "URL", "EMAIL", "TRANSCRIPT"].map(t => (
            <button key={t || "all"} onClick={() => setFilterType(t)}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${filterType === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {t ? TYPE_ICONS[t]?.label || t : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Layer tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
        {[{ id: null, label: "All Layers" }, { id: "PROJECT", label: "Project Memory" }, { id: "WORKSPACE", label: "Workspace Memory" }, { id: "AGENT", label: "Agent Memory" }].map(l => (
          <button key={l.id || "all"} onClick={() => setFilterLayer(l.id)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${filterLayer === l.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
            {l.label}
          </button>
        ))}
      </div>

      {/* Items */}
      {loading ? (
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-bold mb-2">Empty knowledge base</h3>
          <p className="text-sm text-muted-foreground mb-4">Upload documents, paste text, or run research for the agent to learn from.</p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Add Knowledge</Button>
            <Button variant="outline" onClick={() => setShowResearch(true)}><Microscope className="h-4 w-4 mr-1" /> Run Research</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item: any) => {
            const typeConfig = TYPE_ICONS[item.type] || TYPE_ICONS.TEXT;
            const Icon = typeConfig.icon;
            const trust = TRUST_BADGES[item.trustLevel] || TRUST_BADGES.STANDARD;
            return (
              <Card key={item.id} className="hover:ring-2 hover:ring-primary/10 transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${typeConfig.color}15` }}>
                      <Icon className="w-4 h-4" style={{ color: typeConfig.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold truncate">{item.title}</span>
                        <Badge variant="secondary" className="text-[9px]">{item.layer}</Badge>
                        <Badge variant="secondary" className={`text-[9px] ${trust.cls}`}>{trust.label}</Badge>
                        {item.confidential && <Badge variant="destructive" className="text-[9px]"><Shield className="w-2.5 h-2.5 mr-0.5" />Confidential</Badge>}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{typeConfig.label}</span><span>·</span>
                        <span>{new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                        {item.tags?.length > 0 && item.tags.slice(0, 3).map((t: string) => <Badge key={t} variant="outline" className="text-[8px] px-1">{t}</Badge>)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-muted"><Link className="w-3.5 h-3.5 text-muted-foreground" /></a>}
                      <button onClick={() => deleteItem(item.id)} className="p-1.5 rounded-md hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {showAdd && <AddKnowledgeModal agentId={selectedAgent} onClose={() => { setShowAdd(false); fetchItems(); }} />}
      {showResearch && <ResearchModal agentId={selectedAgent} onClose={() => { setShowResearch(false); fetchItems(); }} />}
    </div>
  );
}

// ─── Add Knowledge Modal ───
function AddKnowledgeModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [tab, setTab] = useState<"text" | "url">("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [layer, setLayer] = useState("PROJECT");
  const [trustLevel, setTrustLevel] = useState("STANDARD");
  const [confidential, setConfidential] = useState(false);
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    await fetch(`/api/agents/${agentId}/knowledge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), content: content.trim(), type: tab === "url" ? "URL" : "TEXT", layer, sourceUrl: sourceUrl || undefined, trustLevel, confidential, tags: tags.split(",").map(t => t.trim()).filter(Boolean) }),
    });
    setSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold">Add to Knowledge Base</h2>
            <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
          </div>
          <div className="flex gap-1 p-1 rounded-lg bg-muted/50 mb-4">
            <button onClick={() => setTab("text")} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${tab === "text" ? "bg-card shadow-sm" : "text-muted-foreground"}`}><FileText className="inline h-3.5 w-3.5 mr-1" />Paste Text</button>
            <button onClick={() => setTab("url")} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${tab === "url" ? "bg-card shadow-sm" : "text-muted-foreground"}`}><Globe className="inline h-3.5 w-3.5 mr-1" />URL</button>
          </div>
          <div className="space-y-3">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
            {tab === "url" && <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..." className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />}
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={6} placeholder="Content..." className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none resize-y font-mono" />
            <div className="grid grid-cols-2 gap-3">
              <select value={layer} onChange={e => setLayer(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none">
                <option value="PROJECT">Project Memory</option><option value="WORKSPACE">Workspace Memory</option><option value="AGENT">Agent Memory</option>
              </select>
              <select value={trustLevel} onChange={e => setTrustLevel(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none">
                <option value="HIGH_TRUST">High Trust</option><option value="STANDARD">Standard</option><option value="REFERENCE_ONLY">Reference Only</option>
              </select>
            </div>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma-separated)" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none" />
            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
              <input type="checkbox" checked={confidential} onChange={e => setConfidential(e.target.checked)} className="rounded" />
              <Shield className="w-3 h-3" />Mark as Confidential
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting || !title || !content}>{submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Brain className="w-4 h-4 mr-1" />}Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Research Modal ───
function ResearchModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [type, setType] = useState("pestle");
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const runResearch = async () => {
    setRunning(true); setError(""); setResult(null);
    try {
      const body: any = { type };
      if (type === "search") body.query = query;
      if (type === "stakeholder") body.stakeholder = { name };
      if (type === "vendor") body.vendor = { name };

      const r = await fetch(`/api/agents/${agentId}/research`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok) setResult(d.data);
      else setError(d.error || "Research failed");
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  };

  const TYPES = [
    { id: "pestle", label: "PESTLE Scan", cost: 8, desc: "Full 6-dimension environmental scan" },
    { id: "search", label: "Web Search", cost: 3, desc: "Targeted research query" },
    { id: "stakeholder", label: "Stakeholder Intel", cost: 5, desc: "Professional background research" },
    { id: "vendor", label: "Vendor Research", cost: 5, desc: "Vendor risk assessment" },
    { id: "news", label: "News Monitor", cost: 3, desc: "Latest industry developments" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold"><Microscope className="inline w-5 h-5 mr-2" />Internet Intelligence</h2>
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

          {/* Input */}
          {type === "search" && (
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="What do you want to research?"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none mb-3" />
          )}
          {(type === "stakeholder" || type === "vendor") && (
            <input value={name} onChange={e => setName(e.target.value)} placeholder={type === "stakeholder" ? "Stakeholder name" : "Vendor / technology name"}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none mb-3" />
          )}

          <Button onClick={runResearch} disabled={running || (type === "search" && !query) || ((type === "stakeholder" || type === "vendor") && !name)} className="w-full">
            {running ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Researching...</> : <><Microscope className="w-4 h-4 mr-1" />Run Research</>}
          </Button>

          {error && <p className="text-sm text-destructive mt-3">{error}</p>}

          {/* Results */}
          {result && (
            <div className="mt-4 space-y-3">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-xs font-semibold text-emerald-500 mb-1">Research Complete {result.cached && "(cached)"}</p>
                <p className="text-xs text-muted-foreground">{result.creditCost} credits used</p>
              </div>

              {/* PESTLE findings */}
              {result.findings && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold">{result.findings.length} findings · {result.risksCreated || 0} risks created</p>
                  {result.findings.slice(0, 8).map((f: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 text-xs">
                      <Badge variant={f.impact === "HIGH" ? "destructive" : "secondary"} className="text-[9px] flex-shrink-0 mt-0.5">{f.impact}</Badge>
                      <div>
                        <p className="font-medium">[{f.dimension}] {f.title}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Text content (search, stakeholder, vendor, news) */}
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
                    <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-primary truncate hover:underline">{s}</a>
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
