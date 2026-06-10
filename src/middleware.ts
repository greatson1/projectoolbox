import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { isBypassed, evaluatePaywall, isBlocked } from "@/lib/paywall";
import { ipMatchesAllowlist } from "@/lib/ip-allowlist";
import { canUseFeature } from "@/lib/utils";

/**
 * Edge middleware — paywall enforcement.
 *
 * The JWT carries `orgPlan` and `orgCreatedAt` (stamped in the
 * NextAuth jwt callback). We decode the token in the edge, evaluate
 * the paywall verdict, and redirect blocked users to /billing if they
 * try to reach a non-bypass route. Adding `?paywall=1` so /billing can
 * render the "trial expired" headline without re-fetching anything.
 *
 * Pure check — no DB call per request. The plan + createdAt only
 * change on Stripe webhook (which re-mints the token on next sign-in)
 * or on org creation, so the JWT staleness window is acceptable.
 * Worst case: a user whose trial just expired might briefly still
 * reach the dashboard until their token refreshes; the layout's
 * existing checks catch them on the next interaction.
 */
export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Skip Next.js internals, static assets, and any explicitly bypassed
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

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    // No session — the route handler / page will run its own auth check.
    return NextResponse.next();
  }

  // Anything other than the dashboard surface passes through. We only
  // gate (dashboard) routes — public marketing pages, API endpoints
  // outside /api/projects, /api/agents are unaffected.
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

  // ── IP allowlist (BUSINESS+) ────────────────────────────────────────────
  // The allowlist is JWT-cached so checking it is free per request.
  // Enforce only when (a) the org has entries AND (b) the plan still
  // unlocks the feature — a downgraded org keeps the rows on its
  // Organisation row but middleware stops honouring them, so the
  // org isn't locked out of its own dashboard until they pay again
  // OR clear the list. Leaks the entry that matched is a privacy risk
  // so the 403 body only confirms whether the IP was allowed.
  if (orgIpAllowlist && orgIpAllowlist.length > 0 && canUseFeature(plan, "ipAllowlist")) {
    // Vercel / standard proxies set x-forwarded-for to a comma-separated
    // list; the leftmost entry is the client. NextRequest.ip falls back
    // to the connecting socket which inside the edge is the proxy hop.
    const xff = req.headers.get("x-forwarded-for") || "";
    const clientIp = xff.split(",")[0]?.trim() || (req as any).ip || "";
    if (!ipMatchesAllowlist(clientIp, orgIpAllowlist)) {
      if (pathname.startsWith("/api/")) {
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

  const status = evaluatePaywall({
    plan: plan ?? null,
    createdAt: orgCreatedAt,
  });
  if (!isBlocked(status)) return NextResponse.next();

  // Blocked — redirect to /billing with a state flag so the page can
  // render the paywall headline. JSON API requests get 402 Payment
  // Required so the client can surface a toast.
  if (pathname.startsWith("/api/")) {
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
