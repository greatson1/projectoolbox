import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { isBypassed, evaluatePaywall, isBlocked } from "@/lib/paywall";
import { ipMatchesAllowlist } from "@/lib/ip-allowlist";
import { canUseFeature } from "@/lib/utils";

/**
 * Edge proxy — combined enforcement.
 *
 * Next.js deprecated `middleware.ts` in favour of `proxy.ts`. Vercel
 * builds error out when both files exist, so this file is the single
 * source of edge-side request handling. Three concerns are layered in
 * this order (cheapest gates first):
 *
 *  1. Auth redirect — unauthenticated users hitting dashboard routes
 *     are bounced to /login with a callbackUrl. Layout components do
 *     the same check; this is an early-bounce UX improvement.
 *  2. IP allowlist (BUSINESS+) — if the org has an allowlist AND the
 *     plan still unlocks the feature, refuse requests from IPs not on
 *     the list. JWT-cached so it's free per request.
 *  3. Paywall — orgs with expired trials get redirected to /billing
 *     (or 402 on API). JWT carries plan + createdAt so this is also
 *     free per request.
 *
 * Pure edge — no DB calls. The JWT is re-minted on next sign-in and on
 * Stripe webhook + org-creation events, so staleness is bounded.
 */

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
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // ── 0. Static/internal pass-through ─────────────────────────────────
  // Skip Next.js internals, asset paths, and any explicitly bypassed
  // route. PAYWALL_BYPASS_PATHS covers /billing, /api/billing,
  // /api/webhooks, /api/auth, /login, /signup, etc.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/logo") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/manifest") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webp") ||
    isBypassed(pathname)
  ) {
    return NextResponse.next();
  }

  // All API routes that aren't paywall-gated below pass through their
  // own auth checks. We still run the IP allowlist + paywall logic on
  // /api/projects, /api/agents, /api/approvals further down.
  const isApiRoute = pathname.startsWith("/api/");

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // ── 1. Auth redirect ────────────────────────────────────────────────
  // Unauthenticated user hits a protected page → bounce to /login. API
  // routes do their own auth so we don't redirect those — they'd 401
  // naturally.
  if (!token) {
    if (!isApiRoute && isProtected(pathname)) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Logged in → redirect away from /login & /signup to /dashboard.
  if (pathname === "/login" || pathname === "/signup") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Invite-only mode (off by default): /signup without ?invite= bounces
  // to /waitlist. Kept here so an operator can re-enable the gate later
  // by setting INVITE_ONLY=true on Vercel.
  const flag = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "true";
  if (
    pathname === "/signup" &&
    !req.nextUrl.searchParams.get("invite") &&
    (flag(process.env.INVITE_ONLY) || flag(process.env.NEXT_PUBLIC_INVITE_ONLY))
  ) {
    return NextResponse.redirect(new URL("/waitlist", req.url));
  }

  // Anything other than the dashboard surface passes through without
  // paywall/allowlist enforcement.
  const isDashboardRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/projects") ||
    pathname.startsWith("/agents") ||
    pathname.startsWith("/approvals") ||
    pathname.startsWith("/portfolio") ||
    pathname.startsWith("/meetings") ||
    pathname.startsWith("/calendar") ||
    pathname.startsWith("/reports") ||
    pathname.startsWith("/people") ||
    pathname.startsWith("/integrations") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/knowledge") ||
    pathname.startsWith("/risk") ||
    pathname.startsWith("/cost") ||
    pathname.startsWith("/api/projects") ||
    pathname.startsWith("/api/agents") ||
    pathname.startsWith("/api/approvals");
  if (!isDashboardRoute) return NextResponse.next();

  const plan = (token as any).orgPlan as string | undefined;
  const orgCreatedAtRaw = (token as any).orgCreatedAt as string | undefined;
  const orgCreatedAt = orgCreatedAtRaw ? new Date(orgCreatedAtRaw) : null;
  const orgIpAllowlist = (token as any).orgIpAllowlist as string[] | undefined;

  // ── 2. IP allowlist (BUSINESS+) ─────────────────────────────────────
  // The allowlist is JWT-cached so checking it is free per request.
  // Enforce only when (a) the org has entries AND (b) the plan still
  // unlocks the feature — a downgraded org keeps the rows on its
  // Organisation row but middleware stops honouring them, so the org
  // isn't locked out of its own dashboard until they pay again OR clear
  // the list. Leaking the entry that matched is a privacy risk so the
  // 403 body only confirms whether the IP was allowed.
  if (orgIpAllowlist && orgIpAllowlist.length > 0 && canUseFeature(plan, "ipAllowlist")) {
    // Vercel / standard proxies set x-forwarded-for to a comma-separated
    // list; the leftmost entry is the client. NextRequest.ip falls back
    // to the connecting socket which inside the edge is the proxy hop.
    const xff = req.headers.get("x-forwarded-for") || "";
    const clientIp = xff.split(",")[0]?.trim() || (req as any).ip || "";
    if (!ipMatchesAllowlist(clientIp, orgIpAllowlist)) {
      if (isApiRoute) {
        return NextResponse.json(
          { error: "Forbidden", reason: "ip_not_allowed" },
          { status: 403 },
        );
      }
      // Show a clear page rather than a generic 403 so the admin who
      // misconfigured the allowlist knows exactly what's wrong.
      return new NextResponse(
        `<!doctype html><html><body style="font-family:Inter,sans-serif;padding:60px;max-width:560px;margin:0 auto;text-align:center;">
          <h1 style="font-size:20px;margin-bottom:12px;">Access blocked by IP allowlist</h1>
          <p style="color:#64748B;font-size:14px;line-height:1.6;">Your organisation restricts dashboard access by IP. Your current IP (<code>${clientIp || "unknown"}</code>) is not on the list. Ask your OWNER to add it from /settings/security or sign in from an allowed network.</p>
        </body></html>`,
        { status: 403, headers: { "Content-Type": "text/html" } },
      );
    }
  }

  // ── 3. Paywall ──────────────────────────────────────────────────────
  const status = evaluatePaywall({
    plan: plan ?? null,
    createdAt: orgCreatedAt,
  });
  if (!isBlocked(status)) return NextResponse.next();

  // Blocked — redirect to /billing with a state flag so the page can
  // render the paywall headline. JSON API requests get 402 Payment
  // Required so the client can surface a toast.
  if (isApiRoute) {
    return NextResponse.json(
      { error: "Payment Required", reason: status.kind },
      { status: 402 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/billing";
  url.searchParams.set("paywall", status.kind);
  return NextResponse.redirect(url);
}

export const config = {
  // Apply broadly; the function above short-circuits on bypass + assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png|manifest.json).*)"],
};
