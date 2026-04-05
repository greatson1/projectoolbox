import { ComingSoon } from "@/components/coming-soon";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Community — Projectoolbox" };
export default function CommunityPage() {
  return <ComingSoon icon="🤝" title="Community coming soon" description="A space for Projectoolbox users to share tips, templates, agent configurations, and PM best practices. Coming soon — drop your email to be first in." />;
}
