/**
 * OWNER-only SSO provisioning endpoint.
 *
 *   GET  /api/org/sso/setup
 *     → Returns current SSO status for this org: workosOrgId (if any),
 *       configured emailDomains, ssoRequired flag.
 *
 *   POST /api/org/sso/setup { emailDomains: ["acme.com"] }
 *     → If no workosOrgId is set, creates a WorkOS Organization for this
 *       projectoolbox org (matched by name + supplied domains), persists
 *       the workosOrgId on the Organisation row, and returns an Admin
 *       Portal link the OWNER can email to their IT team. The IT team
 *       follows the link to configure the IdP self-serve.
 *
 *   PATCH /api/org/sso/setup { ssoRequired: boolean }
 *     → Toggles ssoRequired. When true, password + Google + Microsoft
 *       OAuth login is blocked for users in this org — they must come
 *       through SAML.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkOS, normaliseDomain } from "@/lib/workos";
import { GenerateLinkIntent } from "@workos-inc/node";
import { requirePlanFeature } from "@/lib/plan-guard";

export const dynamic = "force-dynamic";

async function ownerGuard() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const orgId = (session.user as any).orgId as string | undefined;
  const role = (session.user as any).role as string | undefined;
  if (!orgId) return { error: NextResponse.json({ error: "No organisation" }, { status: 400 }) };
  if (role !== "OWNER") {
    return { error: NextResponse.json({ error: "Only the organisation Owner can configure SSO" }, { status: 403 }) };
  }
  return { session, orgId, userId: session.user.id };
}

export async function GET() {
  const guard = await ownerGuard();
  if ("error" in guard) return guard.error;

  const org = await db.organisation.findUnique({
    where: { id: guard.orgId },
    select: { workosOrgId: true, emailDomains: true, ssoRequired: true, name: true },
  });
  return NextResponse.json({ data: org });
}

export async function POST(req: NextRequest) {
  const guard = await ownerGuard();
  if ("error" in guard) return guard.error;

  // BUSINESS+ gate. SSO/SAML provisioning is the upgrade reason at that
  // tier; STARTER and PROFESSIONAL get a clean 403 with the message from
  // insufficientPlanResponse() pointing them at /billing.
  const planGuard = await requirePlanFeature(guard.session, "ssoSaml");
  if (!planGuard.ok) return planGuard.response;

  const workos = getWorkOS();
  if (!workos) {
    return NextResponse.json({ error: "SSO is not configured on this deployment. Contact support." }, { status: 503 });
  }

  let body: { emailDomains?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawDomains = Array.isArray(body.emailDomains) ? body.emailDomains : [];
  const domains = rawDomains
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .map(normaliseDomain)
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));

  if (domains.length === 0) {
    return NextResponse.json({ error: "At least one email domain is required (e.g. acme.com)" }, { status: 400 });
  }

  const org = await db.organisation.findUnique({
    where: { id: guard.orgId },
    select: { name: true, workosOrgId: true },
  });
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  let workosOrgId = org.workosOrgId;
  if (!workosOrgId) {
    try {
      // Pass domains as plain { domain, state } objects — WorkOS accepts the
      // string-literal "verified" but the TypeScript type expects the
      // DomainDataState enum, hence the cast.
      const created = await workos.organizations.createOrganization({
        name: org.name,
        domainData: domains.map((d) => ({ domain: d, state: "verified" })) as any,
      });
      workosOrgId = created.id;
    } catch (e: any) {
      console.error("[sso setup] createOrganization failed:", e);
      return NextResponse.json({ error: e?.message || "Failed to create WorkOS organization" }, { status: 502 });
    }
  }

  await db.organisation.update({
    where: { id: guard.orgId },
    data: { workosOrgId, emailDomains: domains },
  });

  // Generate the Admin Portal link the OWNER will share with their IT team.
  let portalUrl: string | null = null;
  try {
    const portal = await workos.adminPortal.generateLink({
      organization: workosOrgId,
      intent: GenerateLinkIntent.SSO,
    });
    portalUrl = portal.link;
  } catch (e) {
    console.error("[sso setup] portal generation failed:", e);
  }

  await db.auditLog.create({
    data: {
      orgId: guard.orgId,
      userId: guard.userId,
      action: "Provisioned SSO connection",
      target: `${domains.join(", ")}`,
    },
  });

  return NextResponse.json({ data: { workosOrgId, emailDomains: domains, portalUrl } });
}

export async function PATCH(req: NextRequest) {
  const guard = await ownerGuard();
  if ("error" in guard) return guard.error;

  const body = await req.json();
  if (typeof body?.ssoRequired !== "boolean") {
    return NextResponse.json({ error: "ssoRequired must be boolean" }, { status: 400 });
  }
  // BUSINESS+ gate on TURNING IT ON. Same downgrade-tolerance as the
  // org-MFA toggle — let an org that dropped from BUSINESS still turn the
  // policy OFF without being blocked.
  if (body.ssoRequired === true) {
    const planGuard = await requirePlanFeature(guard.session, "ssoSaml");
    if (!planGuard.ok) return planGuard.response;
  }

  const org = await db.organisation.findUnique({
    where: { id: guard.orgId },
    select: { workosOrgId: true, ssoRequired: true },
  });
  if (!org?.workosOrgId && body.ssoRequired) {
    return NextResponse.json(
      { error: "Configure an SSO connection first before requiring it." },
      { status: 400 },
    );
  }
  if (org?.ssoRequired === body.ssoRequired) {
    return NextResponse.json({ data: { ssoRequired: body.ssoRequired, changed: false } });
  }

  await db.organisation.update({
    where: { id: guard.orgId },
    data: { ssoRequired: body.ssoRequired },
  });

  await db.auditLog.create({
    data: {
      orgId: guard.orgId,
      userId: guard.userId,
      action: body.ssoRequired ? "Enabled require-SSO policy" : "Disabled require-SSO policy",
      target: body.ssoRequired
        ? "Password + OAuth login blocked; SAML only"
        : "Password + OAuth login re-enabled",
    },
  });

  return NextResponse.json({ data: { ssoRequired: body.ssoRequired, changed: true } });
}
