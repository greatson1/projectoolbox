"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "API error");
  }
  const json = await res.json();
  return json.data ?? json;
}

// ── Dashboard ──

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<any>("/api/dashboard"),
    refetchInterval: 30000,
  });
}

// ── Projects ──

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api<any[]>("/api/projects"),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api("/api/projects", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

// ── Agents ──

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api<any>("/api/agents"),
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api<any>(`/api/agents/${id}`),
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api("/api/agents", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useDeployAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, ...data }: any) =>
      api(`/api/agents/${agentId}/deploy`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// ── Approvals ──

export function useApprovals(status = "PENDING") {
  return useQuery({
    queryKey: ["approvals", status],
    queryFn: () => api<any[]>(`/api/approvals?status=${status}`),
    refetchInterval: 30000, // Poll every 30s
  });
}

export function useApprovalAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, comment }: { id: string; action: string; comment?: string }) =>
      api(`/api/approvals/${id}`, { method: "POST", body: JSON.stringify({ action, comment }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }),
  });
}

// ── Notifications ──

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<any[]>("/api/notifications"),
    refetchInterval: 15000, // Poll every 15s
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/notifications", { method: "POST", body: JSON.stringify({ action: "mark-all-read" }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

// ── Credits ──

export function useCredits() {
  return useQuery({
    queryKey: ["credits"],
    queryFn: () => api<any>("/api/credits"),
    refetchInterval: 30000,
  });
}

export function useCreditUsage() {
  return useQuery({
    queryKey: ["credits", "usage"],
    queryFn: () => api<any>("/api/credits/usage"),
    refetchInterval: 30000,
  });
}

// ── Billing ──

export function useBilling() {
  return useQuery({
    queryKey: ["billing"],
    queryFn: () => api<any>("/api/billing"),
  });
}

// ── Project-scoped ──

export function useProject(id: string | null) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api<any>(`/api/projects/${id}`),
    enabled: !!id,
  });
}

export function useProjectTasks(projectId: string | null) {
  return useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/tasks`),
    enabled: !!projectId,
  });
}

export function useProjectRisks(projectId: string | null) {
  return useQuery({
    queryKey: ["risks", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/risks`),
    enabled: !!projectId,
  });
}

export function useProjectIssues(projectId: string | null) {
  return useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/issues`),
    enabled: !!projectId,
  });
}

export function useProjectStakeholders(projectId: string | null) {
  return useQuery({
    queryKey: ["stakeholders", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/stakeholders`),
    enabled: !!projectId,
  });
}

export function useProjectChangeRequests(projectId: string | null) {
  return useQuery({
    queryKey: ["change-requests", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/change-requests`),
    enabled: !!projectId,
  });
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });
}

export function useCreateRisk(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/risks`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risks", projectId] }),
  });
}

// ── Admin ──

export function useTeamMembers() {
  return useQuery({
    queryKey: ["admin", "team"],
    queryFn: () => api<any[]>("/api/admin/team"),
  });
}

export function useAuditLog() {
  return useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => api<any[]>("/api/admin/audit-log"),
  });
}
