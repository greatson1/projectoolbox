import { ComingSoon } from "@/components/coming-soon";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Blog — Projectoolbox" };
export default function BlogPage() {
  return <ComingSoon icon="✍️" title="Blog coming soon" description="Articles on AI in project management, PM methodology, and how to get the most from your Projectoolbox agent. Drop your email and we'll notify you when we publish." />;
}
