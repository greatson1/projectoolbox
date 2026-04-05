import { ComingSoon } from "@/components/coming-soon";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Careers — Projectoolbox" };
export default function CareersPage() {
  return <ComingSoon icon="💼" title="We're hiring" description="We're a small, focused team building the future of AI-powered project management. No open roles right now — but if you're passionate about AI and PM, we'd love to hear from you." />;
}
