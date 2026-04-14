"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, Send, RefreshCw, Check, Users, Clock, Mail } from "lucide-react";
import { toast } from "sonner";

interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  sector: string | null;
  status: "WAITING" | "INVITED" | "REGISTERED";
  createdAt: string;
}

const STATUS_STYLES = {
  WAITING:    "bg-amber-500/10 text-amber-500 border-amber-500/20",
  INVITED:    "bg-blue-500/10 text-blue-500 border-blue-500/20",
  REGISTERED: "bg-green-500/10 text-green-500 border-green-500/20",
};

export default function WaitlistAdminPage() {
  const [adminKey, setAdminKey]       = useState("");
  const [authed, setAuthed]           = useState(false);
  const [entries, setEntries]         = useState<WaitlistEntry[]>([]);
  const [loading, setLoading]         = useState(false);
  const [inviting, setInviting]       = useState<string | null>(null);
  const [copiedId, setCopiedId]       = useState<string | null>(null);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});

  const load = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", { headers: { "x-admin-key": key } });
      if (!res.ok) { toast.error("Invalid admin key"); return; }
      const data = await res.json();
      setEntries(data.data);
      setAuthed(true);
    } catch {
      toast.error("Failed to load waitlist");
    } finally {
      setLoading(false);
    }
  }, []);

  async function sendInvite(entry: WaitlistEntry) {
    setInviting(entry.id);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ email: entry.email, expiresInDays: 14 }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to generate invite"); return; }

      setInviteLinks(prev => ({ ...prev, [entry.id]: data.inviteUrl }));
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: "INVITED" } : e));
      toast.success("Invite link generated — copy and send it below");
    } catch {
      toast.error("Network error");
    } finally {
      setInviting(null);
    }
  }

  async function copyLink(id: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Invite link copied to clipboard");
  }

  const waiting    = entries.filter(e => e.status === "WAITING").length;
  const invited    = entries.filter(e => e.status === "INVITED").length;
  const registered = entries.filter(e => e.status === "REGISTERED").length;

  if (!authed) {
    return (
      <div className="max-w-sm mx-auto mt-32 px-6">
        <h1 className="text-xl font-bold mb-2">Waitlist Admin</h1>
        <p className="text-sm text-muted-foreground mb-6">Enter your admin key to continue.</p>
        <div className="flex gap-2">
          <input
            type="password"
            value={adminKey}
            onChange={e => setAdminKey(e.target.value)}
            onKeyDown={e => e.key === "Enter" && load(adminKey)}
            placeholder="Admin key..."
            className="flex-1 px-4 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button onClick={() => load(adminKey)} disabled={!adminKey || loading}>
            {loading ? "..." : "Enter"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Waitlist</h1>
          <p className="text-sm text-muted-foreground mt-1">{entries.length} total signups</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(adminKey)} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { icon: Clock, label: "Waiting", value: waiting, color: "text-amber-500" },
          { icon: Mail, label: "Invited", value: invited, color: "text-blue-500" },
          { icon: Users, label: "Registered", value: registered, color: "text-green-500" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-5 flex items-center gap-3">
              <s.icon className={`w-5 h-5 ${s.color}`} />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">No signups yet.</p>
        )}
        {entries.map(entry => (
          <Card key={entry.id} className="overflow-hidden">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-4 flex-wrap">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{entry.email}</span>
                    {entry.name && <span className="text-xs text-muted-foreground">· {entry.name}</span>}
                    {entry.sector && (
                      <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{entry.sector}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Joined {new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>

                {/* Status */}
                <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[entry.status]}`}>
                  {entry.status}
                </Badge>

                {/* Actions */}
                {entry.status === "WAITING" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendInvite(entry)}
                    disabled={inviting === entry.id}
                    className="text-xs"
                  >
                    <Send className="w-3 h-3 mr-1.5" />
                    {inviting === entry.id ? "Generating..." : "Generate Invite"}
                  </Button>
                )}

                {inviteLinks[entry.id] && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => copyLink(entry.id, inviteLinks[entry.id])}
                    className="text-xs"
                  >
                    {copiedId === entry.id
                      ? <><Check className="w-3 h-3 mr-1.5" /> Copied!</>
                      : <><Copy className="w-3 h-3 mr-1.5" /> Copy Invite Link</>
                    }
                  </Button>
                )}

                {entry.status === "INVITED" && !inviteLinks[entry.id] && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendInvite(entry)}
                    disabled={inviting === entry.id}
                    className="text-xs text-muted-foreground"
                  >
                    <RefreshCw className="w-3 h-3 mr-1.5" />
                    {inviting === entry.id ? "Generating..." : "New Link"}
                  </Button>
                )}
              </div>

              {/* Invite link display */}
              {inviteLinks[entry.id] && (
                <div className="mt-2 flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                  <code className="text-[10px] text-muted-foreground flex-1 truncate">{inviteLinks[entry.id]}</code>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
