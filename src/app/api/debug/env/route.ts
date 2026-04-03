import { NextResponse } from "next/server";

// Temporary debug endpoint - DELETE AFTER FIXING
export async function GET() {
  return NextResponse.json({
    hasGoogleId: !!process.env.GOOGLE_CLIENT_ID,
    googleIdPrefix: process.env.GOOGLE_CLIENT_ID?.slice(0, 15) || "MISSING",
    hasGoogleSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasAuthGoogleId: !!process.env.AUTH_GOOGLE_ID,
    nextauthUrl: process.env.NEXTAUTH_URL || "MISSING",
    hasDbUrl: !!process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });
}
