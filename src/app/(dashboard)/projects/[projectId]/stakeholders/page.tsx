"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectStakeholders } from "@/hooks/use-api";
import { Plus, Users } from "lucide-react";

export default function StakeholdersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: stakeholders, isLoading } = useProjectStakeholders(projectId);
  const [selected, setSelected] = useState<any>(null);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-xl" /></div>;

  const items = stakeholders || [];

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Stakeholders</h1><p className="text-sm text-muted-foreground mt-1">{items.length} stakeholders registered</p></div>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Stakeholder</Button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <Users className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No stakeholders yet</h2>
          <p className="text-sm text-muted-foreground mb-4">Add stakeholders to track engagement and manage communications.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add First Stakeholder</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Power/Interest Grid */}
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle className="text-sm">Power / Interest Grid</CardTitle></CardHeader>
            <CardContent>
              <div className="relative w-full aspect-[2/1] min-h-[300px] rounded-xl bg-muted/30 border border-border/30">
                {/* Quadrant labels */}
                <span className="absolute top-2 left-2 text-[10px] text-muted-foreground">Keep Satisfied</span>
                <span className="absolute top-2 right-2 text-[10px] text-muted-foreground">Manage Closely</span>
                <span className="absolute bottom-2 left-2 text-[10px] text-muted-foreground">Monitor</span>
                <span className="absolute bottom-2 right-2 text-[10px] text-muted-foreground">Keep Informed</span>
                <div className="absolute top-1/2 left-0 right-0 h-px bg-border" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                {/* Stakeholder dots */}
                {items.map((s: any) => (
                  <button key={s.id} className="absolute w-8 h-8 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-white hover:scale-110 transition-transform"
                    style={{ left: `${s.interest}%`, bottom: `${s.power}%`, transform: "translate(-50%, 50%)" }}
                    onClick={() => setSelected(s)} title={s.name}>
                    {s.name.charAt(0)}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Detail / List */}
          <div className="space-y-4">
            {selected ? (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{selected.name}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Role</span><span className="font-medium">{selected.role || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Organisation</span><span className="font-medium">{selected.organisation || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Power</span><span className="font-bold">{selected.power}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Interest</span><span className="font-bold">{selected.interest}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Sentiment</span><Badge variant={selected.sentiment === "positive" ? "default" : "secondary"}>{selected.sentiment || "neutral"}</Badge></div>
                  {selected.email && <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{selected.email}</span></div>}
                  <div className="flex gap-2 pt-2"><Button variant="outline" size="sm" className="flex-1">Edit</Button><Button variant="outline" size="sm" className="flex-1">Message</Button></div>
                </CardContent>
              </Card>
            ) : (
              <Card className="p-6 text-center"><Users className="w-6 h-6 text-muted-foreground mx-auto mb-2" /><p className="text-xs text-muted-foreground">Click a stakeholder on the grid</p></Card>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">All Stakeholders</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {items.map((s: any) => (
                  <button key={s.id} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 text-left transition-colors"
                    onClick={() => setSelected(s)}>
                    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-white">{s.name.charAt(0)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{s.name}</p>
                      <p className="text-[10px] text-muted-foreground">{s.role || "—"}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">P:{s.power} I:{s.interest}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
