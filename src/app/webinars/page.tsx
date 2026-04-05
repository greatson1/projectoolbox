import { ComingSoon } from "@/components/coming-soon";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Webinars — Projectoolbox" };
export default function WebinarsPage() {
  return <ComingSoon icon="🎥" title="Webinars coming soon" description="Live and recorded sessions on AI project management, getting the most from your agents, and PM methodology. Register your interest below." />;
}
