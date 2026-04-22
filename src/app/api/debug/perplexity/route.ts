/**
 * GET /api/debug/perplexity — diagnostic endpoint
 *
 * Tests that PERPLEXITY_API_KEY is configured AND the key is valid
 * by making a real tiny query. Only reachable by authenticated users.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.PERPLEXITY_API_KEY;

  if (!key) {
    return NextResponse.json({
      configured: false,
      status: "missing",
      message: "PERPLEXITY_API_KEY is not set in the server environment. Add it in Vercel → Settings → Environment Variables.",
    });
  }

  // Test with a tiny query to verify the key actually works
  try {
    const startMs = Date.now();
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "Respond with exactly one word." },
          { role: "user", content: "Is water wet?" },
        ],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "no body");
      return NextResponse.json({
        configured: true,
        status: "invalid",
        keyPrefix: key.slice(0, 6) + "…",
        httpStatus: res.status,
        error: errBody.slice(0, 300),
        message: res.status === 401
          ? "Perplexity API rejected the key (401). It may have been rotated or revoked."
          : res.status === 429
            ? "Perplexity rate limit hit. Your key is valid but temporarily throttled."
            : `Perplexity returned HTTP ${res.status}. Check the error body above.`,
      }, { status: 200 });
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "";

    return NextResponse.json({
      configured: true,
      status: "working",
      keyPrefix: key.slice(0, 6) + "…",
      model: data.model || "sonar",
      latencyMs,
      testReply: reply.slice(0, 100),
      message: `✅ Perplexity is working. Test query returned in ${latencyMs}ms.`,
    });
  } catch (err: any) {
    return NextResponse.json({
      configured: true,
      status: "error",
      keyPrefix: key.slice(0, 6) + "…",
      error: err.message,
      message: `Network or timeout error calling Perplexity: ${err.message}`,
    }, { status: 200 });
  }
}
