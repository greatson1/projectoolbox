/**
 * POST /api/agents/[id]/ingest
 *
 * Universal knowledge ingestion endpoint. Accepts:
 *   - transcript  : plain-text meeting/call transcript → Claude extracts decisions, risks, actions
 *   - document    : plain text or pasted document content → chunked into KB items
 *   - url         : web URL → fetched and summarised into KB
 *   - file        : multipart upload (txt, md, csv) → text extracted and stored
 *   - audio/video : multipart upload (mp3, mp4, m4a, wav, webm) → Whisper transcribes
 *                   → transcript piped through same Claude extraction pipeline
 *
 * Audio transcription uses OpenAI Whisper (whisper-1).
 * Cost: ~£0.003 per minute of audio (essentially free).
 * File size limit: 25 MB (compress long recordings to MP3 mono if needed).
 *
 * Auth: session cookie OR Authorization: Bearer ptx_live_<key>
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";

export const maxDuration = 300; // 5 min — Whisper on large files needs time

// Audio/video MIME types and extensions we'll route through Whisper
const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/wav", "audio/wave", "audio/x-wav", "audio/webm", "audio/ogg",
  "audio/flac", "audio/aac", "audio/x-aac",
  "video/mp4", "video/webm", "video/mpeg", "video/quicktime",
]);
const AUDIO_EXTENSIONS = new Set([
  "mp3", "mp4", "m4a", "wav", "webm", "ogg", "flac", "aac", "mov", "mpeg",
]);

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — Whisper's hard limit

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;

  // Verify agent belongs to caller's org
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true, name: true } });
  if (!agent || agent.orgId !== caller.orgId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });
  const projectId = deployment?.projectId ?? null;
  const orgId = caller.orgId;

  // ── Parse request — supports both JSON and multipart ──
  const contentType = req.headers.get("content-type") || "";
  let type: string, title: string, content: string, sourceUrl: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    type = (form.get("type") as string) || "document";
    title = (form.get("title") as string) || "Uploaded document";
    sourceUrl = (form.get("sourceUrl") as string) || undefined;

    const file = form.get("file") as File | null;
    if (file) {
      if (!title || title === "Uploaded document") title = file.name;

      // ── Audio / video → Whisper transcription ────────────────────────────
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isAudio = AUDIO_MIME_TYPES.has(file.type) || AUDIO_EXTENSIONS.has(ext);

      if (isAudio) {
        // Size check — Whisper won't accept > 25 MB
        if (file.size > MAX_AUDIO_BYTES) {
          return NextResponse.json({
            error: `Audio file too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB. Tip: export as MP3 mono at 32 kbps — a 1-hour meeting becomes ~14 MB.`,
          }, { status: 413 });
        }

        if (!process.env.OPENAI_API_KEY) {
          return NextResponse.json({
            error: "OPENAI_API_KEY not configured. Add it in Vercel environment variables to enable audio transcription.",
          }, { status: 503 });
        }

        // Transcribe with Whisper
        try {
          content = await transcribeWithWhisper(file);
          type = "transcript"; // pipe through Claude extraction pipeline
          if (!title || title === file.name) title = file.name.replace(/\.[^.]+$/, "");
        } catch (e: any) {
          return NextResponse.json({ error: `Whisper transcription failed: ${e.message}` }, { status: 502 });
        }
      } else {
        // Text-based file — decode as UTF-8
        const buf = await file.arrayBuffer();
        const rawText = new TextDecoder("utf-8").decode(buf);
        content = rawText.slice(0, 150_000);
      }
    } else {
      content = (form.get("content") as string) || "";
    }
  } else {
    const body = await req.json();
    type = body.type || "document";
    title = body.title || "Ingested content";
    content = body.content || "";
    sourceUrl = body.sourceUrl;

    // URL ingestion — fetch and extract text
    if (type === "url" && sourceUrl && !content) {
      try {
        const res = await fetch(sourceUrl, {
          headers: { "User-Agent": "Projectoolbox-Agent/1.0" },
          signal: AbortSignal.timeout(10_000),
        });
        const html = await res.text();
        // Strip HTML tags — basic but effective for most pages
        content = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim()
          .slice(0, 80_000);
      } catch (e: any) {
        return NextResponse.json({ error: `Could not fetch URL: ${e.message}` }, { status: 422 });
      }
    }
  }

  if (!content?.trim()) {
    return NextResponse.json({ error: "No content to ingest" }, { status: 400 });
  }

  // ── Route to appropriate processor ──
  const isTranscript = type === "transcript" || type === "meeting";
  const saved: { title: string; type: string }[] = [];

  if (isTranscript) {
    // Use Claude to extract structured knowledge from transcript
    const extracted = await processTranscript(content, title, agent.name);
    for (const item of extracted) {
      await db.knowledgeBaseItem.create({
        data: {
          orgId, agentId, projectId,
          layer: "PROJECT",
          type: item.type as any,
          title: item.title,
          content: item.content,
          trustLevel: "STANDARD",
          tags: item.tags,
          metadata: item.metadata,
        },
      });
      saved.push({ title: item.title, type: item.type });
    }

    // Also save the raw transcript for reference
    await db.knowledgeBaseItem.create({
      data: {
        orgId, agentId, projectId,
        layer: "PROJECT",
        type: "TRANSCRIPT",
        title: `Transcript: ${title}`,
        content: content.slice(0, 50_000),
        trustLevel: "REFERENCE_ONLY",
        tags: ["transcript", "raw"],
        sourceUrl: sourceUrl ?? null,
      },
    });
    saved.push({ title: `Transcript: ${title}`, type: "TRANSCRIPT" });

  } else if (type === "url") {
    // Summarise the fetched URL content with Claude
    const summary = await summariseContent(content, title, sourceUrl);
    await db.knowledgeBaseItem.create({
      data: {
        orgId, agentId, projectId,
        layer: "PROJECT",
        type: "URL",
        title,
        content: summary,
        sourceUrl: sourceUrl ?? null,
        trustLevel: "REFERENCE_ONLY",
        tags: ["web", "research"],
        cachedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
    saved.push({ title, type: "URL" });

  } else {
    // Document / plain text — chunk if large, save as-is if small
    const chunks = chunkText(content, 4_000);
    for (let i = 0; i < chunks.length; i++) {
      const chunkTitle = chunks.length > 1 ? `${title} (part ${i + 1}/${chunks.length})` : title;
      await db.knowledgeBaseItem.create({
        data: {
          orgId, agentId, projectId,
          layer: "PROJECT",
          type: type === "file" ? "FILE" : "TEXT",
          title: chunkTitle,
          content: chunks[i],
          sourceUrl: sourceUrl ?? null,
          trustLevel: "STANDARD",
          tags: [type, "ingested"],
        },
      });
      saved.push({ title: chunkTitle, type });
    }
  }

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Knowledge ingested: "${title}" (${saved.length} item${saved.length !== 1 ? "s" : ""} → ${type})`,
    },
  });

  return NextResponse.json({ data: { ingested: saved.length, items: saved } }, { status: 201 });
}

// ─── Whisper Audio Transcription ─────────────────────────────────────────────

/**
 * Sends an audio/video file to OpenAI Whisper and returns the raw transcript.
 * Whisper-1 supports: mp3, mp4, mpeg, mpga, m4a, wav, webm
 * Cost: $0.006 / minute  (~£0.003/min — negligible)
 */
async function transcribeWithWhisper(file: File): Promise<string> {
  const key = process.env.OPENAI_API_KEY!;

  // Whisper requires a proper filename with extension for format detection
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json"); // gives us segments + language
  form.append("language", "en"); // hint — speeds up and improves accuracy

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(240_000), // 4 min max
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "unknown error");
    throw new Error(`Whisper API ${res.status}: ${err}`);
  }

  const data = await res.json();

  // verbose_json includes segments with speaker-like timestamps
  // Format: "[0:00] text  [0:15] text ..." for readability
  if (data.segments?.length) {
    return data.segments
      .map((s: any) => {
        const mins = Math.floor(s.start / 60);
        const secs = Math.floor(s.start % 60).toString().padStart(2, "0");
        return `[${mins}:${secs}] ${s.text.trim()}`;
      })
      .join("\n");
  }

  return data.text || "";
}

// ─── Transcript Processor ─────────────────────────────────────────────────────

interface ExtractedItem {
  title: string;
  content: string;
  type: string;
  tags: string[];
  metadata?: any;
}

async function processTranscript(transcript: string, meetingTitle: string, agentName: string): Promise<ExtractedItem[]> {
  const prompt = `You are an AI Project Manager assistant. Analyse this meeting transcript and extract structured knowledge.

MEETING: ${meetingTitle}

TRANSCRIPT:
${transcript.slice(0, 60_000)}

Extract the following and return as JSON (no markdown, just the JSON object):
{
  "summary": "2-3 sentence executive summary of the meeting",
  "decisions": [{ "title": "short title", "content": "full decision with context and who made it" }],
  "action_items": [{ "title": "task title", "content": "full description with owner and deadline if mentioned" }],
  "risks": [{ "title": "risk title", "content": "risk description with probability and impact if mentioned" }],
  "key_facts": [{ "title": "fact title", "content": "important fact, preference, or constraint established in this meeting" }]
}

Rules:
- Only extract what is explicitly stated — no inference
- decisions: formal agreements, approvals, sign-offs
- action_items: specific tasks with an owner
- risks: anything flagged as a concern, blocker, or uncertainty
- key_facts: stakeholder preferences, constraints, budget confirmations, dates agreed`;

  if (!process.env.ANTHROPIC_API_KEY) {
    // Fallback — save entire transcript as single item
    return [{
      title: `Meeting notes: ${meetingTitle}`,
      content: transcript.slice(0, 8_000),
      type: "TEXT",
      tags: ["meeting", "notes"],
    }];
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}`);

    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();

    // Strip any markdown code fences Claude might add
    const jsonStr = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(jsonStr);

    const items: ExtractedItem[] = [];

    // Meeting summary
    if (parsed.summary) {
      items.push({
        title: `Meeting summary: ${meetingTitle}`,
        content: parsed.summary,
        type: "TEXT",
        tags: ["meeting", "summary"],
        metadata: { source: "transcript", meetingTitle },
      });
    }

    // Decisions
    for (const d of (parsed.decisions || [])) {
      items.push({ title: d.title, content: d.content, type: "DECISION", tags: ["meeting", "decision"], metadata: { meetingTitle } });
    }

    // Action items
    for (const a of (parsed.action_items || [])) {
      items.push({ title: a.title, content: a.content, type: "TEXT", tags: ["meeting", "action-item"], metadata: { meetingTitle } });
    }

    // Risks
    for (const r of (parsed.risks || [])) {
      items.push({ title: r.title, content: r.content, type: "TEXT", tags: ["meeting", "risk"], metadata: { meetingTitle } });
    }

    // Key facts
    for (const f of (parsed.key_facts || [])) {
      items.push({ title: f.title, content: f.content, type: "TEXT", tags: ["meeting", "key-fact"], metadata: { meetingTitle } });
    }

    return items.length > 0 ? items : [{
      title: `Meeting notes: ${meetingTitle}`,
      content: transcript.slice(0, 8_000),
      type: "TEXT",
      tags: ["meeting", "notes"],
    }];

  } catch {
    // If Claude fails, save transcript as plain text
    return [{
      title: `Meeting notes: ${meetingTitle}`,
      content: transcript.slice(0, 8_000),
      type: "TEXT",
      tags: ["meeting", "notes"],
    }];
  }
}

// ─── URL Summariser ───────────────────────────────────────────────────────────

async function summariseContent(content: string, title: string, url?: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return content.slice(0, 4_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `Summarise the following web page content for use as project management reference material. Focus on facts, figures, requirements, and actionable information. Be concise (200-400 words).

URL: ${url || "unknown"}
Title: ${title}

CONTENT:
${content.slice(0, 20_000)}`,
        }],
      }),
    });
    if (!res.ok) return content.slice(0, 4_000);
    const data = await res.json();
    return data.content?.[0]?.text || content.slice(0, 4_000);
  } catch {
    return content.slice(0, 4_000);
  }
}

// ─── Text Chunker ─────────────────────────────────────────────────────────────

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  // Split on paragraph boundaries where possible
  const paragraphs = text.split(/\n{2,}/);
  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars) {
      if (current) chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}
