import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that require a valid session — everything else is public
const PROTECTED_PATHS = [
  "/dashboard",
  "/agents",
  "/approvals",
  "/billing",
  "/calendar",
  "/knowledge",
  "/meetings",
  "/notifications",
  "/portfolio",
  "/projects",
  "/reports",
  "/settings",
  "/activity",
  "/programmes",
  "/invoices",
  "/admin",
  "/tools",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Static files and Next.js internals — always pass through
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // All API routes pass through — they handle their own auth
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Check for auth cookie (NextAuth session token)
  const token =
    req.cookies.get("authjs.session-token") ||
    req.cookies.get("__Secure-authjs.session-token");

  // Not logged in and trying to access a protected route → redirect to login
  if (!token && isProtected(pathname)) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Logged in → redirect away from login/signup to dashboard
  if (token && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
