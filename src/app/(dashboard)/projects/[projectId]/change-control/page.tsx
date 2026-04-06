"use client";

import { useParams } from "next/navigation";
import { useProjectChangeRequests } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, GitPullRequest, FileText, CheckCircle2, XCircle, Clock } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  SUBMITTED: "outline",
  UNDER_REVIEW: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  IMPLEMENTED: "default",
};

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CRITICAL: "destructive",
  HIGH: "destructive",
  MEDIUM: "secondary",
  LOW: "outline",
};

export default function ChangeControlPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: changeRequests, isLoading } = useProjectChangeRequests(projectId);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const items = changeRequests || [];
  const pending = items.filter((cr: any) => cr.status === "SUBMITTED" || cr.status === "UNDER_REVIEW").length;
  const approved = items.filter((cr: any) => cr.status === "APPROVED" || cr.status === "IMPLEMENTED").length;
  const rejected = items.filter((cr: any) => cr.status === "REJECTED").length;

  const handleAdd = () => {
    const title = prompt("Change request title:");
    if (!title) return;
    fetch(`/api/projects/${projectId}/change-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category: "scope", priority: "MEDIUM", status: "SUBMITTED" }),
    })
      .then(() => {
        toast.success("Change request raised");
        window.location.reload();
      })
      .catch(() => toast.error("Failed to create change request"));
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Change Control</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length} change request{items.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="w-4 h-4 mr-1" /> Raise Change Request
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total CRs</p>
              <p className="text-2xl font-bold">{items.length}</p>
            </div>
            <FileText className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold text-amber-500">{pending}</p>
            </div>
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Approved</p>
              <p className="text-2xl font-bold text-green-500">{approved}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Rejected</p>
              <p className="text-2xl font-bold text-destructive">{rejected}</p>
            </div>
            <XCircle className="w-5 h-5 text-destructive" />
          </div>
        </Card>
      </div>

      {/* Empty State or Table */}
      {items.length === 0 ? (
        <div className="text-center py-20">
          <GitPullRequest className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No change requests</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Your AI agent will raise change requests when scope, schedule, or budget changes are needed.
          </p>
          <Button size="sm" onClick={handleAdd}>
            <Plus className="w-4 h-4 mr-1" /> Raise First Change Request
          </Button>
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {["ID", "Title", "Category", "Priority", "Status", "Requester", "Date", "Impact"].map((h) => (
                    <th
                      key={h}
                      className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((cr: any, idx: number) => {
                  const crId = cr.id ? `CR-${String(cr.id).slice(-3).padStart(3, "0")}` : `CR-${idx + 1}`;
                  const status = (cr.status || "SUBMITTED").toUpperCase();
                  const priority = (cr.priority || "MEDIUM").toUpperCase();
                  const category = cr.category || "scope";
                  const date = cr.createdAt
                    ? new Date(cr.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                    : "-";

                  return (
                    <tr key={cr.id || idx} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-primary">{crId}</td>
                      <td className="py-2.5 px-4 font-medium max-w-[250px] truncate">{cr.title}</td>
                      <td className="py-2.5 px-4">
                        <Badge variant="outline" className="capitalize text-[10px]">
                          {category}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant={PRIORITY_VARIANT[priority] || "secondary"} className="text-[10px]">
                          {priority}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant={STATUS_VARIANT[status] || "outline"} className="text-[10px]">
                          {status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">{cr.requester || cr.requestedBy || "-"}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{date}</td>
                      <td className="py-2.5 px-4 text-muted-foreground text-[11px] max-w-[200px] truncate">
                        {cr.impactSummary || cr.scopeImpact || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
