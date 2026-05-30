import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 40) + "-" + Date.now().toString(36);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { workspace, plan, agent } = body;

    const updateData: Record<string, unknown> = { onboardingComplete: true };
    let orgId: string | undefined;

    // Create organisation if workspace data provided. The founder must be
    // recorded BOTH as a UserOrganisation member (so multi-org queries find
    // them) AND have user.role lifted to OWNER (so the role gate on
    // /api/invitations + other admin endpoints lets them act). Wrap in a
    // transaction so a partial failure doesn't strand the user in an org
    // they can't administer.
    if (workspace?.orgName) {
      const existingUser = await db.user.findUnique({ where: { id: session.user.id }, select: { orgId: true } });

      if (existingUser?.orgId) {
        orgId = existingUser.orgId;
      } else {
        const userId = session.user.id;
        orgId = await db.$transaction(async (tx) => {
          const org = await tx.organisation.create({
            data: {
              name: workspace.orgName,
              slug: slugify(workspace.orgName),
              industry: workspace.industry || null,
            },
          });
          await tx.userOrganisation.create({
            data: { userId, orgId: org.id, role: "OWNER" },
          });
          await tx.auditLog.create({
            data: { orgId: org.id, userId, action: "Created organisation", target: org.name },
          });
          return org.id;
        });
        updateData.orgId = orgId;
        // Founder of a brand-new org owns it; User.role mirrors the
        // active-org role (UserOrganisation.role is the per-org truth).
        updateData.role = "OWNER";
      }
    }

    // Update user
    await db.user.update({
      where: { id: session.user.id },
      data: updateData,
    });

    // Create agent if agent data provided and org exists
    if (agent?.name && orgId) {
      try {
        await db.agent.create({
          data: {
            name: agent.name,
            codename: agent.name.toUpperCase().replace(/\s+/g, "-"),
            gradient: agent.gradient || "#6366F1",
            autonomyLevel: agent.autonomyLevel || 2,
            status: "ACTIVE",
            orgId,
          },
        });
      } catch {
        // Agent creation is non-blocking
      }
    }

    return NextResponse.json({ data: { message: "Onboarding complete" } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Onboarding failed" }, { status: 500 });
  }
}
