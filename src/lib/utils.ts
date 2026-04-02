import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function formatDate(date: Date | string, style: "short" | "long" = "short") {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-GB", style === "long"
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "numeric", month: "short", year: "2-digit" });
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}

export const CREDIT_COSTS = {
  SIMPLE_QUERY: 1,
  COMPLEX_ANALYSIS: 5,
  AUTONOMOUS_DECISION: 3,
  REPORT_GENERATION: 10,
  DOCUMENT_GENERATION: 8,
  MONTE_CARLO: 15,
  AGENT_DEPLOYMENT: 10,
} as const;

export const PLAN_LIMITS: Record<string, { credits: number; agents: number; projects: number }> = {
  FREE: { credits: 50, agents: 1, projects: 1 },
  STARTER: { credits: 500, agents: 2, projects: 3 },
  PROFESSIONAL: { credits: 2000, agents: 5, projects: 10 },
  BUSINESS: { credits: 10000, agents: 15, projects: 50 },
  ENTERPRISE: { credits: 999999, agents: 999, projects: 999 },
};
