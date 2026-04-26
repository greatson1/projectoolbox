import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/integration-health
 *
 * Returns the configuration + reachability status for every external service
 * the platform depends on. Used by Settings → Health to give operators a
 * single-pane view of "is everything that's supposed to be connected
 * actually working".
 *
 * Each service has two signals:
 *   - configured: env vars are present (no network call needed)
 *   - reachable:  a lightweight live ping succeeded (or "untested" if we
 *                 don't ping that service to keep latency down)
 *
 * Optional ?ping=true triggers the network checks. Without ?ping the page
 * loads fast (env-only) and the user clicks "Run live checks" when they
 * want the deeper signal.
 */
type Service = {
  key: string;
  name: string;
  group: "ai" | "meetings" | "research" | "payments" | "comms" | "storage";
  required: boolean;
  configured: boolean;
  reachable: "ok" | "fail" | "untested";
  detail: string;
};

async function pingAnthropic(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
    });
    return { ok: r.ok, detail: r.ok ? `${r.status} OK` : `${r.status} ${r.statusText}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message?.slice(0, 120) || "network error" };
  }
}

async function pingOpenAI(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    return { ok: r.ok, detail: r.ok ? `${r.status} OK` : `${r.status} ${r.statusText}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message?.slice(0, 120) || "network error" };
  }
}

async function pingPerplexity(): Promise<{ ok: boolean; detail: string }> {
  try {
    // Perplexity has no public model list — issue a tiny chat completion.
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    });
    return { ok: r.ok, detail: r.ok ? `${r.status} OK` : `${r.status} ${r.statusText}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message?.slice(0, 120) || "network error" };
  }
}

async function pingRecall(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch("https://us-east-1.recall.ai/api/v1/bot/?limit=1", {
      headers: { Authorization: `Token ${process.env.RECALL_API_KEY}` },
    });
    return { ok: r.ok, detail: r.ok ? `${r.status} OK` : `${r.status} ${r.statusText}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message?.slice(0, 120) || "network error" };
  }
}

async function pingCustomBot(): Promise<{ ok: boolean; detail: string }> {
  try {
    const url = process.env.CUSTOM_BOT_SERVICE_URL!.replace(/\/+$/, "");
    const r = await fetch(`${url}/health`, {
      headers: { "x-bot-service-key": process.env.CUSTOM_BOT_SERVICE_KEY || "" },
    });
    return { ok: r.ok, detail: r.ok ? `${r.status} OK` : `${r.status} ${r.statusText}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message?.slice(0, 120) || "network error" };
  }
}

async function pingStripe(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    return { ok: r.ok, detail: r.ok ? `${r.status} OK` : `${r.status} ${r.statusText}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message?.slice(0, 120) || "network error" };
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ping = req.nextUrl.searchParams.get("ping") === "true";

  const env = process.env;
  const has = (k: string) => !!env[k]?.trim();

  const services: Service[] = [
    {
      key: "anthropic",
      name: "Anthropic (Claude)",
      group: "ai",
      required: true,
      configured: has("ANTHROPIC_API_KEY"),
      reachable: "untested",
      detail: has("ANTHROPIC_API_KEY") ? "Key set" : "ANTHROPIC_API_KEY missing",
    },
    {
      key: "openai",
      name: "OpenAI (embeddings + fallback)",
      group: "ai",
      required: false,
      configured: has("OPENAI_API_KEY"),
      reachable: "untested",
      detail: has("OPENAI_API_KEY") ? "Key set" : "OPENAI_API_KEY missing — falls back to keyword matching",
    },
    {
      key: "perplexity",
      name: "Perplexity (web research)",
      group: "research",
      required: false,
      configured: has("PERPLEXITY_API_KEY"),
      reachable: "untested",
      detail: has("PERPLEXITY_API_KEY") ? "Key set" : "PERPLEXITY_API_KEY missing — research unavailable",
    },
    {
      key: "gemini",
      name: "Google Gemini (image gen)",
      group: "ai",
      required: false,
      configured: has("GEMINI_API_KEY"),
      reachable: "untested",
      detail: has("GEMINI_API_KEY") ? "Key set" : "GEMINI_API_KEY missing — thumbnails fall back to OpenAI",
    },
    {
      key: "recall",
      name: "Recall.ai (meeting bot)",
      group: "meetings",
      required: false,
      configured: has("RECALL_API_KEY"),
      reachable: "untested",
      detail: has("RECALL_API_KEY") ? "Key set" : "RECALL_API_KEY missing — Recall.ai bot disabled",
    },
    {
      key: "custom_bot",
      name: "Custom recording bot",
      group: "meetings",
      required: false,
      configured: has("CUSTOM_BOT_SERVICE_URL") && has("CUSTOM_BOT_SERVICE_KEY"),
      reachable: "untested",
      detail: has("CUSTOM_BOT_SERVICE_URL") ? "URL + key set" : "CUSTOM_BOT_SERVICE_URL/KEY missing",
    },
    {
      key: "zoom",
      name: "Zoom (OAuth)",
      group: "meetings",
      required: false,
      configured: has("ZOOM_CLIENT_ID") && has("ZOOM_CLIENT_SECRET"),
      reachable: "untested",
      detail: has("ZOOM_CLIENT_ID") ? "OAuth app configured" : "ZOOM_CLIENT_ID/SECRET missing",
    },
    {
      key: "google_calendar",
      name: "Google Calendar (OAuth)",
      group: "meetings",
      required: false,
      configured: has("GOOGLE_CALENDAR_CLIENT_ID") && has("GOOGLE_CALENDAR_CLIENT_SECRET"),
      reachable: "untested",
      detail: has("GOOGLE_CALENDAR_CLIENT_ID") ? "OAuth app configured" : "GOOGLE_CALENDAR_CLIENT_ID/SECRET missing",
    },
    {
      key: "stripe",
      name: "Stripe (payments)",
      group: "payments",
      required: false,
      configured: has("STRIPE_SECRET_KEY"),
      reachable: "untested",
      detail: has("STRIPE_SECRET_KEY") ? "Secret key set" : "STRIPE_SECRET_KEY missing — checkout disabled",
    },
    {
      key: "resend",
      name: "Resend (transactional email)",
      group: "comms",
      required: false,
      configured: has("RESEND_API_KEY"),
      reachable: "untested",
      detail: has("RESEND_API_KEY") ? "Key set" : "RESEND_API_KEY missing — email notifications disabled",
    },
    {
      key: "database",
      name: "Postgres (Prisma)",
      group: "storage",
      required: true,
      configured: has("DATABASE_URL"),
      reachable: "untested",
      detail: has("DATABASE_URL") ? "URL set" : "DATABASE_URL missing — app cannot run",
    },
  ];

  if (ping) {
    const checks: Promise<void>[] = [];
    for (const s of services) {
      if (!s.configured) continue;
      if (s.key === "anthropic") checks.push(pingAnthropic().then(r => { s.reachable = r.ok ? "ok" : "fail"; s.detail = r.detail; }));
      else if (s.key === "openai") checks.push(pingOpenAI().then(r => { s.reachable = r.ok ? "ok" : "fail"; s.detail = r.detail; }));
      else if (s.key === "perplexity") checks.push(pingPerplexity().then(r => { s.reachable = r.ok ? "ok" : "fail"; s.detail = r.detail; }));
      else if (s.key === "recall") checks.push(pingRecall().then(r => { s.reachable = r.ok ? "ok" : "fail"; s.detail = r.detail; }));
      else if (s.key === "custom_bot") checks.push(pingCustomBot().then(r => { s.reachable = r.ok ? "ok" : "fail"; s.detail = r.detail; }));
      else if (s.key === "stripe") checks.push(pingStripe().then(r => { s.reachable = r.ok ? "ok" : "fail"; s.detail = r.detail; }));
      // Database is implicitly reachable if this request succeeded — auth() did a DB read.
      else if (s.key === "database") { s.reachable = "ok"; s.detail = "Reached (current request used the DB)"; }
    }
    await Promise.allSettled(checks);
  } else {
    // Even without ping, mark database as reachable since we got here.
    const db = services.find(s => s.key === "database");
    if (db && db.configured) { db.reachable = "ok"; db.detail = "Reached (this request used the DB)"; }
  }

  return NextResponse.json({ data: { services, pingedAt: ping ? new Date().toISOString() : null } });
}