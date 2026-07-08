import { redirect } from "next/navigation";

/**
 * Alias: the Risk Register page lives at /projects/:id/risk (singular) but
 * the API namespace is /api/projects/:id/risks (plural) — deep links and
 * users guessing the URL kept landing on a hard 404. Redirect to the page.
 */
export default async function RisksAlias({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/risk`);
}
