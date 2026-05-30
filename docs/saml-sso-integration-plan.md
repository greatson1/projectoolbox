# Enterprise SAML / OIDC SSO — Integration Plan

Plan for adding enterprise SSO to projectoolbox so customers can let their staff sign in with their corporate identity provider (Okta, Microsoft Entra ID, Google Workspace IdP, OneLogin, JumpCloud, Ping, etc.) instead of password or social login.

## Why this is needed

Enterprise IT teams treat individual passwords as a security risk. Without SSO, a typical "we want this for 200 staff" deal stalls at the IT review. SSO unblocks:

- Deal sizes >£20K/year (Enterprise plan tier)
- Compliance reviews (SOC2 evidence for Provisioning + Deprovisioning)
- HR-driven user lifecycle (employee leaves → account deactivated next sync)

## Decision: WorkOS vs roll-your-own

| | WorkOS | Self-hosted SAML (e.g. `@boxyhq/saml-jackson`) |
|---|---|---|
| Setup time | 2-3 days | 1-2 weeks |
| Cost | ~$125/mo per connected IdP after the free tier | Free (open source) |
| IdP support | Every major IdP, all kept up-to-date by WorkOS | You maintain compatibility |
| Admin UX | Customers configure via WorkOS Admin Portal (hosted) | You build the configuration UI |
| Directory Sync (SCIM) | Included | Separate library, more code |
| Compliance evidence | WorkOS provides SOC2 attestation | You produce your own |

**Recommendation: WorkOS.** Saves 1-2 engineer-weeks per IdP onboard. The per-IdP fee is invisible against a £20K/year deal.

## End-to-end flow

```
1. Customer admin contacts you ("we want SSO")
2. You generate a WorkOS Organization for them → returns an Admin Portal link
3. You email the customer the Admin Portal link
4. Their IT admin visits the link, configures SAML/OIDC with their IdP
   (WorkOS guides them step-by-step per IdP — Okta, Entra, etc.)
5. Their staff visit projectoolbox.com → click "Sign in with SSO" → enter
   their corporate email → WorkOS redirects to their IdP → IdP returns
   assertion → WorkOS returns a profile to your callback URL → your code
   creates/updates the User row, assigns to the right Org, mints a session
6. (Optional) Enable Directory Sync — WorkOS syncs the customer's HR
   directory into your User table. When staff are deactivated in HR, the
   matching projectoolbox account is automatically deactivated.
```

## Integration steps

### 1. WorkOS account + first project (~2 hours)

- Sign up at https://workos.com → free tier covers 1M users / 5 connections
- Create a "Production" project
- Save `WORKOS_API_KEY` + `WORKOS_CLIENT_ID` to Vercel env vars
- Configure redirect URI: `https://projectoolbox.com/api/auth/workos/callback`

### 2. Add WorkOS SDK + provider (~half day)

```bash
npm install @workos-inc/node
```

Create `src/app/api/auth/workos/login/route.ts`:
- Takes `email` query param
- Looks up the user's WorkOS Organization via email-domain mapping
  (you store `domain -> workosOrgId` on the projectoolbox Organisation row)
- Calls `workos.sso.getAuthorizationUrl({ organization, redirectUri, state })`
- Redirects to the URL

Create `src/app/api/auth/workos/callback/route.ts`:
- Receives `code` query param
- Calls `workos.sso.getProfileAndToken({ code, clientId })`
- The profile carries `email`, `firstName`, `lastName`, `organizationId`
- Lookup-or-create User row by email
- Lookup the projectoolbox Organisation by `workosOrgId`
- Create/update UserOrganisation membership with role from SAML attribute
  (default MEMBER if the IdP doesn't send a `role` claim)
- Mint a NextAuth JWT session (call `signIn("workos", { user })` via
  a Credentials-style provider that trusts the post-callback redirect)
- Redirect to `/dashboard`

### 3. Wire as a NextAuth provider (~2 hours)

Add a CredentialsProvider in `src/lib/auth.ts` that the WorkOS callback
posts to with a short-lived signed token (e.g. JWT with 60s expiry).
The provider verifies the token signature, extracts the userId, and
returns the user object. This keeps NextAuth as the session source of
truth without WorkOS needing to know NextAuth internals.

### 4. Schema additions (~1 hour, 1 migration)

Add to `Organisation`:
```prisma
workosOrgId        String?  @unique  // the WorkOS Organization ID
emailDomains       String[] @default([])  // for IdP discovery — "acme.com", "acmecorp.io"
ssoRequired        Boolean  @default(false)  // when true, hide password login
defaultMemberRole  UserRole @default(MEMBER) // role given to fresh SAML signups
```

Add to `User`:
```prisma
ssoProvisionedAt  DateTime?  // marks the row as managed by SAML
```

### 5. UI — login page (~half day)

Add an "Sign in with SSO" affordance:
- User clicks → enter email → `POST /api/auth/sso-discover` returns
  the WorkOS Organization ID if the email domain matches a configured
  org, else falls back to password login.

### 6. Customer admin UX (~half day)

For org owners on Enterprise plan:
- `/settings/sso` page with a "Configure SSO" button
- Click → server POSTs to WorkOS to generate an Admin Portal link
  (returns a short-lived URL)
- Show the link to the admin to email to their IT team

### 7. Directory Sync / SCIM (Phase 2, ~2 days)

After SAML is live and stable, add SCIM:
- WorkOS exposes `directorySync.listDirectories` etc.
- Add a webhook endpoint `/api/webhooks/workos/dsync` to receive
  user/group lifecycle events (create, update, deactivate)
- On `user.deactivated`: deactivate the projectoolbox User row + cancel
  active sessions

## Effort + cost summary

| Phase | Effort | Per-IdP cost |
|---|---|---|
| 1. WorkOS account | 2 hours | Free up to 1M users |
| 2-6. SAML flow + admin UX | 2-3 days | $125/mo per IdP after free tier |
| 7. SCIM Directory Sync | 2 days | Included in the per-IdP fee |
| **Total to ship SAML** | **2-3 days** | **~$1.5K/year per customer with SSO** |

## What to charge

SSO is a known Enterprise gate. Recommended pricing:
- Required on Enterprise plan (£20K+/year)
- Recover the $1.5K WorkOS cost in plan price; net margin still healthy

## Open questions to resolve before starting

1. Which IdPs do the first 1-3 prospective enterprise customers use? (Drives test priority — Okta and Entra are most common.)
2. Do we want IdP-initiated SSO (user starts at Okta dashboard, lands directly in projectoolbox) in addition to SP-initiated? IdP-initiated is one extra callback handler.
3. Do we want JIT user provisioning (first-time SAML signup auto-creates the user) or require pre-existing Invitation? JIT is the standard enterprise expectation.

## References

- WorkOS docs: https://workos.com/docs/sso
- NextAuth + WorkOS pattern: https://workos.com/docs/sso/guide/nextjs
- WorkOS pricing: https://workos.com/pricing