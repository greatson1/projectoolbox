import { ComingSoon } from "@/components/coming-soon";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Docs — Projectoolbox" };
export default function DocsPage() {
  return <ComingSoon icon="📚" title="Documentation coming soon" description="Full documentation covering agent configuration, autonomy levels, integrations, API reference, and best practices. Get notified when it launches." />;
}
