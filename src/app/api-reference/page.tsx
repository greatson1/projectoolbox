import { ComingSoon } from "@/components/coming-soon";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "API Reference — Projectoolbox" };
export default function ApiReferencePage() {
  return <ComingSoon icon="🔌" title="API Reference coming soon" description="A full REST API for integrating Projectoolbox into your own workflows and tooling. Available on Professional and Business plans. Get notified when it launches." />;
}
