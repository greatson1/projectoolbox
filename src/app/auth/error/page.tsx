import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * NextAuth error page — wired via `pages.error` in src/lib/auth.ts.
 *
 * Most "errors" landing here are stale-JWT-cookie cases:
 *   - NEXTAUTH_URL changed (apex vs www, http vs https) and the cookie
 *     was minted under the old binding.
 *   - AUTH_SECRET rotated and the encryption no longer matches.
 *   - The JWT shape changed (we add fields like orgPlan, orgTrialEndsAt)
 *     and an unknown key trips strict decoders.
 *
 * In all three cases the cleanest UX is "wipe the stale cookies and
 * redirect to /login" so the user gets a fresh session. The previous
 * default behaviour was a static "Server error / check the server logs"
 * card with no escape hatch — the user had no idea they should clear
 * cookies, and the support burden landed on us.
 *
 * Only Configuration / JWTSessionError / SessionTokenError are silent-
 * recoverable; OAuth and Credentials errors stay informational because
 * the user can act on those directly (re-enter password, retry SSO).
 */

const RECOVERABLE_ERRORS = new Set([
  "Configuration",
  "JWTSessionError",
  "SessionTokenError",
  // NextAuth occasionally surfaces these as the "error" query param when a
  // token decodes to something that no longer makes sense (signed-out
  // user, missing fields, etc.). Treating them as recoverable means the
  // user lands on /login fresh rather than seeing a card with no action.
  "DecodeError",
  "InvalidStateError",
]);

// Every cookie name NextAuth uses in JWT-strategy mode, both __Secure-
// (production / https) and non-prefixed (local dev). The exact set
// depends on the host and cookie config; we delete all known names
// unconditionally because deleting a non-existent cookie is a no-op.
const COOKIE_NAMES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
  "next-auth.state",
  "__Secure-next-auth.state",
  "next-auth.pkce.code_verifier",
  "__Secure-next-auth.pkce.code_verifier",
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
];

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorCode = error || "Unknown";
  const isRecoverable = RECOVERABLE_ERRORS.has(errorCode);

  if (isRecoverable) {
    // Nuke every NextAuth cookie we know about so the next request to
    // /login arrives with a clean slate. cookies().delete is the
    // canonical Next.js 15+ way to set Set-Cookie: name=; Max-Age=0 on
    // the outgoing response.
    const jar = await cookies();
    for (const name of COOKIE_NAMES) {
      try { jar.delete(name); } catch { /* deleting a missing cookie is fine */ }
    }
    redirect(`/login?reason=session_reset`);
  }

  // Non-recoverable errors — surface the code so support can act on it.
  // Examples: OAuthCallback (provider rejected the callback URL),
  // CredentialsSignin (wrong password — but in v5 that's usually returned
  // to /login directly, not here).
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", padding: "2rem", fontFamily: "Inter, system-ui, sans-serif",
      background: "#0F172A", color: "#F8FAFC",
    }}>
      <div style={{
        maxWidth: 480, padding: "2rem", borderRadius: 12,
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
        textAlign: "center",
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Sign-in failed</h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", margin: "0 0 16px", lineHeight: 1.6 }}>
          {errorCode === "OAuthCallback" || errorCode === "OAuthSignin" ? (
            <>The OAuth provider rejected the sign-in. If you just changed your sign-in method, try again — otherwise contact support and quote error code <code>{errorCode}</code>.</>
          ) : errorCode === "AccessDenied" ? (
            <>Your account isn't permitted to sign in. If this is a mistake, contact support.</>
          ) : (
            <>Something went wrong during sign-in. Try again. If it persists, contact support and quote error code <code>{errorCode}</code>.</>
          )}
        </p>
        <a href="/login" style={{
          display: "inline-block", padding: "10px 20px", borderRadius: 8,
          background: "#6366F1", color: "#fff", fontWeight: 600, textDecoration: "none",
        }}>
          Back to sign in
        </a>
      </div>
    </div>
  );
}
