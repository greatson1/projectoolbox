import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await req.json();

  await db.user.update({
    where: { id: session.user.id },
    data: { notificationPrefs: prefs },
  });

  return NextResponse.json({ data: { message: "Preferences saved" } });
}
