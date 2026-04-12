import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes (no auth required)
  const publicPaths = ["/", "/login", "/signup", "/onboarding", "/invite", "/review", "/api/auth", "/api/webhooks", "/api/review", "/api/invitations"];
  const isPublic = publicPaths.some(p => pathname === p || pathname.startsWith(p + "/"));

  // Static/API — pass through
  if (pathname.startsWith("/_next") || pathname.startsWith("/api/") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // Check for auth cookie (NextAuth session token)
  const token = req.cookies.get("authjs.session-token") || req.cookies.get("__Secure-authjs.session-token");

  // Not logged in → redirect to login (unless public)
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Logged in → redirect away from login/signup
  if (token && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
