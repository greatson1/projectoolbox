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
    refetchInterval: 120000, // 2 min — main overview needs reasonable freshness
  });
}

// ── Projects ──

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api<any[]>("/api/projects"),
    // no polling — uses staleTime from QueryClient defaults
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
    refetchInterval: 20000, // 20 s — drives the bottom status banner; needs to stay close to live
    refetchOnWindowFocus: true,
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api<any>(`/api/agents/${id}`),
    enabled: !!id,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useAgentMetrics(id: string | null) {
  return useQuery({
    queryKey: ["agent-metrics", id],
    queryFn: () => api<any>(`/api/agents/${id}/metrics`),
    enabled: !!id,
    // no polling — uses staleTime from QueryClient defaults
    staleTime: 30000,
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
    refetchInterval: 120000, // 2 min — approval queue needs freshness
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
    // no polling — uses staleTime from QueryClient defaults
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
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useCreditUsage() {
  return useQuery({
    queryKey: ["credits", "usage"],
    queryFn: () => api<any>("/api/credits/usage"),
    // no polling — uses staleTime from QueryClient defaults
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
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useProjectTasks(projectId: string | null) {
  return useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/tasks`),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

/** PM overhead tasks only (scaffolded) — used by the agent progress tracker */
export function usePMTasks(projectId: string | null) {
  return useQuery({
    queryKey: ["pm-tasks", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/tasks?include=all`).then(
      tasks => (tasks || []).filter((t: any) => t.description?.includes("[scaffolded]"))
    ),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useProjectRisks(projectId: string | null) {
  return useQuery({
    queryKey: ["risks", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/risks`),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useProjectIssues(projectId: string | null) {
  return useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/issues`),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useProjectArtefacts(projectId: string | null) {
  return useQuery({
    queryKey: ["project-artefacts", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/artefacts`),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useProjectMetrics(projectId: string | null) {
  return useQuery({
    queryKey: ["project-metrics", projectId],
    queryFn: () => api<any>(`/api/projects/${projectId}/metrics`),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useProjectStakeholders(projectId: string | null) {
  return useQuery({
    queryKey: ["stakeholders", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/stakeholders`),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useProjectChangeRequests(projectId: string | null) {
  return useQuery({
    queryKey: ["change-requests", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/change-requests`),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useProjectResources(projectId: string | null) {
  return useQuery({
    queryKey: ["resources", projectId],
    queryFn: () => api<any>(`/api/projects/${projectId}/resources`),
    enabled: !!projectId,
    // no polling — uses staleTime from QueryClient defaults
  });
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });
}

export function useUpdateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...data }: { taskId: string; [key: string]: any }) =>
      api(`/api/projects/${projectId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });
}

export function useDeleteTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      api(`/api/projects/${projectId}/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });
}

// ── Sprints ──

export function useProjectSprints(projectId: string | null) {
  return useQuery({
    queryKey: ["sprints", projectId],
    queryFn: () => api<any[]>(`/api/projects/${projectId}/sprints`),
    enabled: !!projectId,
  });
}

export function useCreateSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/sprints`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sprints", projectId] }),
  });
}

export function useUpdateSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sprintId, ...data }: { sprintId: string; [key: string]: any }) =>
      api(`/api/projects/${projectId}/sprints/${sprintId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sprints", projectId] }),
  });
}

export function useDeleteSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sprintId: string) =>
      api(`/api/projects/${projectId}/sprints/${sprintId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprints", projectId] });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });
}

export function useCreateRisk(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/risks`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risks", projectId] }),
  });
}

// ── Meetings ──

export function useMeetings(projectId?: string | null) {
  return useQuery({
    queryKey: ["meetings", projectId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      return api<any>(`/api/meetings?${params}`);
    },
  });
}

export function useMeeting(id: string | null) {
  return useQuery({
    queryKey: ["meeting", id],
    queryFn: () => api<any>(`/api/meetings/${id}`),
    enabled: !!id,
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api("/api/meetings", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function useUpdateMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/meetings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      qc.invalidateQueries({ queryKey: ["meeting", id] });
    },
  });
}

// ── Calendar ──

export function useCalendarEvents(range?: string, projectId?: string | null) {
  return useQuery({
    queryKey: ["calendar", range, projectId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (range) params.set("range", range);
      if (projectId) params.set("projectId", projectId);
      return api<any>(`/api/calendar?${params}`);
    },
  });
}

export function useCreateCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api("/api/calendar", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

// ── Agent Email ──

export function useAgentEmail(agentId: string | null) {
  return useQuery({
    queryKey: ["agent-email", agentId],
    queryFn: () => api<any>(`/api/agents/${agentId}/email`),
    enabled: !!agentId,
  });
}

export function useGenerateAgentEmail(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/agents/${agentId}/email`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-email", agentId] }),
  });
}

// ── Agent Inbox ──

export function useAgentInbox(agentId: string | null) {
  return useQuery({
    queryKey: ["agent-inbox", agentId],
    queryFn: () => api<any>(`/api/agents/${agentId}/inbox`),
    enabled: !!agentId,
    // no polling — uses staleTime from QueryClient defaults
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

// ── API Keys ──

export function useApiKeys() {
  return useQuery({
    queryKey: ["admin", "api-keys"],
    queryFn: () => api<any[]>("/api/admin/api-keys"),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api<any>("/api/admin/api-keys", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "api-keys"] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/admin/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "api-keys"] }),
  });
}

// ── Webhooks ──

export function useWebhooks() {
  return useQuery({
    queryKey: ["admin", "webhooks"],
    queryFn: () => api<any[]>("/api/admin/webhooks"),
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api<any>("/api/admin/webhooks", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "webhooks"] }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/admin/webhooks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "webhooks"] }),
  });
}

// ── Agent Actions ──

export function usePauseAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api(`/api/agents/${agentId}/pause`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); qc.invalidateQueries({ queryKey: ["agent"] }); },
  });
}

export function useResumeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api(`/api/agents/${agentId}/resume`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agents"] }); qc.invalidateQueries({ queryKey: ["agent"] }); },
  });
}

export function useUpdateAgent(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agent", agentId] }); qc.invalidateQueries({ queryKey: ["agents"] }); },
  });
}

// ── Issues ──

export function useCreateIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/issues`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues", projectId] }),
  });
}

// ── Change Requests ──

export function useCreateChangeRequest(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/change-requests`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-requests", projectId] }),
  });
}

// ── Stakeholders ──

export function useCreateStakeholder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/stakeholders`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stakeholders", projectId] }),
  });
}

// ── Risks ──

export function useUpdateRisk(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ riskId, ...data }: any) => api(`/api/projects/${projectId}/risks`, { method: "PATCH", body: JSON.stringify({ riskId, ...data }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risks", projectId] }),
  });
}

// ── Billing ──

export function useCheckout() {
  return useMutation({
    mutationFn: (data: any) => api<any>("/api/billing/checkout", { method: "POST", body: JSON.stringify(data) }),
  });
}

export function useBillingPortal() {
  return useMutation({
    mutationFn: () => api<any>("/api/billing/portal", { method: "POST" }),
  });
}

// ── Admin ──

export function useOrgSettings() {
  return useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api<any>("/api/admin/settings"),
  });
}

export function useSaveOrgSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api("/api/admin/settings", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useUpdateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api("/api/admin/team", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "team"] }),
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (data: any) => api("/api/admin/team/invite", { method: "POST", body: JSON.stringify(data) }),
  });
}

// ── Notifications Preferences ──

export function useSaveNotificationPrefs() {
  return useMutation({
    mutationFn: (data: any) => api("/api/notifications/preferences", { method: "POST", body: JSON.stringify(data) }),
  });
}

// ── Decisions ──

export function useCreateDecision(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/decisions`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decisions", projectId] }),
  });
}

// ── Report Schedule ──

export function useCreateReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api("/api/reports/schedule", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}

// ── Communications ──

export function useLogCommunication(projectId: string) {
  return useMutation({
    mutationFn: (data: any) => api(`/api/projects/${projectId}/communications`, { method: "POST", body: JSON.stringify(data) }),
  });
}

// ── Artefact Review ──

export function useAgentArtefacts(agentId: string | null) {
  return useQuery({
    queryKey: ["artefacts", agentId],
    queryFn: () => api<any[]>(`/api/agents/${agentId}/artefacts`),
    enabled: !!agentId,
  });
}

export function useUpdateArtefact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ artefactId, ...data }: any) => api(`/api/agents/artefacts/${artefactId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["artefacts"] }); qc.invalidateQueries({ queryKey: ["agents"] }); },
  });
}

// ── Knowledge Base ──

export function useAgentKnowledge(agentId: string | null) {
  return useQuery({
    queryKey: ["knowledge", agentId],
    queryFn: () => api<any[]>(`/api/agents/${agentId}/knowledge`),
    enabled: !!agentId,
  });
}

export function useDeleteKnowledgeItem(agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      api(`/api/agents/${agentId}/knowledge?itemId=${itemId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge", agentId] }),
  });
}

export function useIngest(agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { type: string; title: string; content?: string; sourceUrl?: string } | FormData) => {
      const isFormData = payload instanceof FormData;
      return fetch(`/api/agents/${agentId}/ingest`, {
        method: "POST",
        ...(isFormData ? { body: payload } : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      }).then(async r => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "Ingest failed");
        return json.data;
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge", agentId] }),
  });
}

// ── Portfolio Email ──

export function useEmailPortfolioReport() {
  return useMutation({
    mutationFn: (data: any) => api("/api/portfolio/email", { method: "POST", body: JSON.stringify(data) }),
  });
}

// ── ML Predictions ──

export function useApprovalLikelihood(type: string | null, urgency?: string | null) {
  return useQuery({
    queryKey: ["ml", "approval_likelihood", type, urgency],
    queryFn: () => api<any>(`/api/ml/predictions?kind=approval_likelihood&type=${encodeURIComponent(type || "")}${urgency ? `&urgency=${encodeURIComponent(urgency)}` : ""}`),
    enabled: !!type,
    staleTime: 60 * 60 * 1000, // 1 hour — baseline changes slowly
  });
}

export function useImpactCalibration(type: string | null) {
  return useQuery({
    queryKey: ["ml", "impact_calibration", type],
    queryFn: () => api<any>(`/api/ml/predictions?kind=impact_calibration&type=${encodeURIComponent(type || "")}`),
    enabled: !!type,
    staleTime: 60 * 60 * 1000,
  });
}

export function useStoryPointCalibration(assignee?: string | null) {
  return useQuery({
    queryKey: ["ml", "story_point_calibration", assignee],
    queryFn: () => api<any>(`/api/ml/predictions?kind=story_point_calibration${assignee ? `&assignee=${encodeURIComponent(assignee)}` : ""}`),
    staleTime: 60 * 60 * 1000,
  });
}

export function useRiskMaterialisation(riskId: string | null) {
  return useQuery({
    queryKey: ["ml", "risk_materialisation", riskId],
    queryFn: () => api<any>(`/api/ml/predictions?kind=risk_materialisation&riskId=${encodeURIComponent(riskId || "")}`),
    enabled: !!riskId,
    staleTime: 30 * 60 * 1000,
  });
}

export function useSimilarProjects(projectId: string | null, k = 5) {
  return useQuery({
    queryKey: ["ml", "similar_projects", projectId, k],
    queryFn: () => api<any[]>(`/api/ml/predictions?kind=similar_projects&projectId=${encodeURIComponent(projectId || "")}&k=${k}`),
    enabled: !!projectId,
    staleTime: 24 * 60 * 60 * 1000,
  });
}
