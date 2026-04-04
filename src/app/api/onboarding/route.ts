import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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

    // Create organisation if workspace data provided
    if (workspace?.orgName) {
      const existingUser = await db.user.findUnique({ where: { id: session.user.id }, select: { orgId: true } });

      if (existingUser?.orgId) {
        orgId = existingUser.orgId;
      } else {
        const org = await db.organisation.create({
          data: {
            name: workspace.orgName,
            slug: slugify(workspace.orgName),
            industry: workspace.industry || null,
          },
        });
        orgId = org.id;
        updateData.orgId = org.id;
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
            autonomyLevel: agent.autonomyLevel || 3,
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
