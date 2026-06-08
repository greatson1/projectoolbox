import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public routes that do not require an authenticated session.
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/invite",
  "/sso-complete",
  "/mfa-required",
  "/api/auth",
  "/api/onboarding",
  "/api/invitations",
  "/api/waitlist",
  "/api/webhooks",
  "/api/review",
  "/about",
  "/contact",
  "/blog",
  "/docs",
  "/api-reference",
  "/legal",
  "/careers",
  "/webinars",
  "/community",
  "/changelog",
  "/integrations",
  "/robots.txt",
  "/sitemap.xml",
];

function isPublic(path: string): boolean {
  if (PUBLIC_ROUTES.some((r) => path === r || path.startsWith(r + "/"))) return true;
  // Auth callback routes /api/auth/[...nextauth] etc.
  if (path.startsWith("/api/auth/")) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let static assets and Next internals pass through
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(js|css|png|jpg|svg|ico|woff2|json|txt|xml|webp)$/)
  ) {
    return NextResponse.next();
  }

  // Let public routes through
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // For all other routes, require the session cookie to be present.
  // The per-route auth() call is the source of truth — middleware only
  // gates the obvious unauthenticated traffic to reduce DB load.
  const sessionToken = req.cookies.get("next-auth.session-token")?.value ||
                       req.cookies.get("__Secure-next-auth.session-token")?.value;

  if (!sessionToken) {
    const url = new URL("/login", req.url);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and the explicitly public ones
    "/((?!_next/static|_next/image|public).*)",
  ],
};
