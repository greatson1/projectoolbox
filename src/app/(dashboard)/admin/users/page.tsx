"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Users, Activity, AlertTriangle, Wallet, MessageSquare, FolderKanban } from "lucide-react";
import { toast } from "sonner";

interface OrgRef { id: string; name: string; plan: string }

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  org: OrgRef | null;
  emailVerified: string | null;
  passwordHash: boolean;
  linkedAccounts: number;
  activeSessions: number;
  onboardingComplete: boolean;
  projects: number;
  agents: number;
  chats: number;
  lastActivityAt: string;
  createdAt: string;
  looksBrokenSignup: boolean;
  looksAbandoned: boolean;
}

const PLAN_COLOURS: Record<string, string> = {
  FREE:         "text-muted-foreground border-muted-foreground/30",
  STARTER:      "text-blue-500 border-blue-500/30",
  PROFESSIONAL: "text-violet-500 border-violet-500/30",
  BUSINESS:     "text-emerald-500 border-emerald-500/30",
  ENTERPRISE:   "text-amber-500 border-amber-500/30",
};

export default function UsersAdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [authed, setAuthed]     = useState(false);
  const [users, setUsers]       = useState<UserRow[]>([]);
  const [realCount, setReal]    = useState(0);
  const [loading, setLoading]   = useState(false);
  const [includeTest, setIncT]  = useState(false);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { headers: { "x-admin-key": key } });
      if (!res.ok) { toast.error("Invalid admin key"); return; }
      const data = await res.json();
      setUsers(data.data);
      setReal(data.realCount);
      setAuthed(true);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = sessionStorage.getItem("admin-key");
    if (saved) {
      setAdminKey(saved);
      load(saved);
    }
  }, [load]);

  function saveAndLoad(key: string) {
    if (typeof window !== "undefined") sessionStorage.setItem("admin-key", key);
    load(key);
  }

  if (!authed) {
    return (
      <div className="max-w-sm mx-auto mt-32 px-6">
        <h1 className="text-xl font-bold mb-2">Users Admin</h1>
        <p className="text-sm text-muted-foreground mb-6">Enter your admin key to continue.</p>
        <div className="flex gap-2">
          <input
            type="password"
            value={adminKey}
            onChange={e => setAdminKey(e.target.value)}
            onKeyDown={e => e.key === "Enter" && saveAndLoad(adminKey)}
            placeholder="Admin key..."
            className="flex-1 px-4 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button onClick={() => saveAndLoad(adminKey)} disabled={!adminKey || loading}>
            {loading ? "..." : "Enter"}
          </Button>
        </div>
      </div>
    );
  }

  // Optionally hide test/walkthrough accounts so the headline number
  // matches the "real users" stat. Most admin sessions want this hidden.
  const visible = includeTest
    ? users
    : users.filter(u => !/@projectoolbox\.test$|^ui-walk-|^e2e-/.test(u.email));

  const paying      = visible.filter(u => u.org && u.org.plan !== "FREE").length;
  const freeOnly    = visible.filter(u => u.org && u.org.plan === "FREE").length;
  const noOrg       = visible.filter(u => !u.org).length;
  const abandoned   = visible.filter(u => u.looksAbandoned).length;
  const brokenLogin = visible.filter(u => u.looksBrokenSignup).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {visible.length} {includeTest ? "total" : "real"} accounts · {realCount} excluding test accounts
          </p>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={includeTest} onChange={e => setIncT(e.target.checked)} />
            Include test accounts
          </label>
          <Button variant="outline" size="sm" onClick={() => load(adminKey)} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {[
          { icon: Wallet,         label: "Paying",         value: paying,      color: "text-emerald-500" },
          { icon: Users,          label: "Free plan",      value: freeOnly,    color: "text-muted-foreground" },
          { icon: Activity,       label: "No org",         value: noOrg,       color: "text-amber-500" },
          { icon: AlertTriangle,  label: "Abandoned",      value: abandoned,   color: "text-orange-500" },
          { icon: AlertTriangle,  label: "Broken signup",  value: brokenLogin, color: "text-red-500" },
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

      <div className="space-y-2">
        {visible.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">No accounts yet.</p>
        )}
        {visible.map(u => {
          const planClass = u.org ? PLAN_COLOURS[u.org.plan] || PLAN_COLOURS.FREE : "text-amber-500 border-amber-500/30";
          return (
            <Card key={u.id} className="overflow-hidden">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{u.email}</span>
                      {u.name && <span className="text-xs text-muted-foreground">· {u.name}</span>}
                      {u.role !== "MEMBER" && (
                        <span className="text-[10px] bg-violet-500/10 text-violet-500 px-2 py-0.5 rounded-full">{u.role}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Joined {new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {" · "}
                      Last active {new Date(u.lastActivityAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <FolderKanban className="w-3 h-3" /> {u.projects}
                    <MessageSquare className="w-3 h-3 ml-2" /> {u.chats}
                  </div>

                  {u.org ? (
                    <>
                      <span className="text-xs text-muted-foreground truncate max-w-[160px]">{u.org.name}</span>
                      <Badge variant="outline" className={`text-[10px] ${planClass}`}>{u.org.plan}</Badge>
                    </>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">No org</Badge>
                  )}

                  {u.looksBrokenSignup && (
                    <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/30" title="Email verified but no password or OAuth link — user cannot log in">
                      Broken
                    </Badge>
                  )}
                  {u.looksAbandoned && (
                    <Badge variant="outline" className="text-[10px] text-orange-500 border-orange-500/30" title="Completed onboarding but never created projects, agents, or chats">
                      Abandoned
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
