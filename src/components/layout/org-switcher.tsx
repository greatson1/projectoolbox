"use client";

import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Plus, Check } from "lucide-react";

export function OrgSwitcher() {
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/orgs/switch").then(r => r.json()).then(d => {
      if (d.data) {
        setOrgs(d.data.orgs || []);
        setActiveOrgId(d.data.activeOrgId);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeOrg = orgs.find(o => o.active) || orgs[0];

  const switchOrg = async (orgId: string) => {
    setOpen(false);
    await fetch("/api/orgs/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    window.location.reload(); // Reload to refresh all data for new org
  };

  if (orgs.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/50 transition-colors"
      >
        {activeOrg?.logoUrl ? (
          <img src={activeOrg.logoUrl} alt="" className="w-5 h-5 rounded" />
        ) : (
          <div className="w-5 h-5 rounded bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-[8px] font-bold text-white">
            {(activeOrg?.name || "P")[0]}
          </div>
        )}
        <span className="text-xs font-semibold truncate max-w-[120px]">{activeOrg?.name || "Organisation"}</span>
        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[240px] rounded-xl bg-card border border-border shadow-xl z-50 py-1.5 animate-page-enter">
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your organisations</p>
          {orgs.map(org => (
            <button
              key={org.id}
              onClick={() => org.active ? setOpen(false) : switchOrg(org.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors ${org.active ? "bg-primary/5" : ""}`}
            >
              {org.logoUrl ? (
                <img src={org.logoUrl} alt="" className="w-6 h-6 rounded" />
              ) : (
                <div className="w-6 h-6 rounded bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-[9px] font-bold text-white">
                  {org.name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">{org.name}</p>
                <p className="text-[10px] text-muted-foreground">{org.role} · {org.plan}</p>
              </div>
              {org.active && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
            </button>
          ))}
          <div className="border-t border-border/30 mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); window.location.href = "/onboarding"; }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors text-xs text-muted-foreground"
            >
              <Plus className="w-4 h-4" />
              Create Organisation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
