/**
 * WorkOS client singleton + small helpers used by the SSO routes.
 *
 * WorkOS handles the SAML/OIDC protocol grunt-work (XML signature
 * verification, certificate rotation, IdP-specific quirks) so we only need
 * three calls:
 *
 *   - `sso.getAuthorizationUrl({ organization, redirectUri, state })`
 *     → returns the URL we redirect the user's browser to so the IdP can
 *       challenge them.
 *
 *   - `sso.getProfileAndToken({ code, clientId })`
 *     → exchanges the `code` we receive on our callback for the verified
 *       user profile.
 *
 *   - `portal.generateLink({ organization, intent: "sso" })`
 *     → mints a short-lived URL we hand to the customer IT admin so they
 *       can configure their IdP self-serve in WorkOS's hosted UI.
 *
 * Returns null when env vars are unset so dev mode without WorkOS keys
 * doesn't crash on import. Routes check `if (!workos)` before use.
 */

import { WorkOS } from "@workos-inc/node";

let cached: WorkOS | null | undefined;

export function getWorkOS(): WorkOS | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    cached = null;
    return cached;
  }
  cached = new WorkOS(apiKey);
  return cached;
}

export const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID || "";

/** Where the WorkOS callback redirects the user. Must match the URL configured in the WorkOS dashboard. */
export function workosRedirectUri(): string {
  const base = process.env.NEXTAUTH_URL || "https://projectoolbox.com";
  return `${base.replace(/\/$/, "")}/api/auth/workos/callback`;
}

/** Lower-case + strip whitespace so domain lookups are stable. */
export function normaliseDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, "");
}
