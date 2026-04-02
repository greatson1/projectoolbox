import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  // Public routes — no auth required
  const publicRoutes = ["/", "/login", "/signup", "/api/auth", "/api/webhooks"];
  const isPublicRoute = publicRoutes.some(r => pathname === r || pathname.startsWith(r + "/"));

  // API routes that need auth will handle it themselves
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Static assets
  if (pathname.startsWith("/_next") || pathname.includes(".")) return NextResponse.next();

  // If not logged in and trying to access protected route
  if (!isLoggedIn && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // If logged in and trying to access login/signup, redirect to dashboard
  if (isLoggedIn && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
