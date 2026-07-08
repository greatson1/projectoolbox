import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { MODELS } from "@/lib/ai-models";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/health/ai — verify every model in the registry is reachable.
 *
 * Exists because the 2026-06-15 retirement of claude-sonnet-4-20250514 broke
 * chat + artefact generation silently for three weeks (every call 404'd and
 * the failures were swallowed). This endpoint makes that class of outage a
 * one-request diagnosis: each registry model gets a 1-token ping and the
 * response says exactly which tier is healthy.
 *
 * A model retirement shows up here as: { ok: false, status: 404,
 * error: "not_found_error ..." } on the affected tier.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const results: Record<string, { model: string; ok: boolean; status?: number; latencyMs?: number; error?: string }> = {};

  await Promise.all(
    Object.entries(MODELS).map(async ([tier, model]) => {
      const t0 = Date.now();
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          results[tier] = { model, ok: true, status: res.status, latencyMs: Date.now() - t0 };
        } else {
          const body = await res.text().catch(() => "");
          results[tier] = { model, ok: false, status: res.status, latencyMs: Date.now() - t0, error: body.slice(0, 300) };
          console.error(`[health/ai] model "${model}" (${tier}) unhealthy: ${res.status} ${body.slice(0, 200)}`);
        }
      } catch (e: any) {
        results[tier] = { model, ok: false, error: String(e?.message ?? e).slice(0, 300) };
        console.error(`[health/ai] model "${model}" (${tier}) ping failed:`, e);
      }
    }),
  );

  const allOk = Object.values(results).every((r) => r.ok);
  return NextResponse.json({ ok: allOk, models: results }, { status: allOk ? 200 : 503 });
}
