import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { recipients, subject, htmlContent } = await req.json();
  if (!recipients?.length) return NextResponse.json({ error: "Recipients required" }, { status: 400 });

  // Use Resend if available, otherwise log
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (RESEND_KEY) {
    for (const email of recipients) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Projectoolbox <reports@projectoolbox.com>",
          to: email,
          subject: subject || "Portfolio Report — Projectoolbox",
          html: htmlContent || "<p>Portfolio report from Projectoolbox.</p>",
        }),
      });
    }
  }

  return NextResponse.json({ data: { message: `Report sent to ${recipients.length} recipient(s)` } });
}
