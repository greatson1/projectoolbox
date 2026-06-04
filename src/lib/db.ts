import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as Sentry from "@sentry/nextjs";
import { stripContextMarkerLeaks } from "@/lib/agents/sanitise-chat-response";

const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createClient> };

// Telemetry: every leak the extension scrubs means Layer 1 (route sanitiser)
// either missed it OR was bypassed. We log a structured one-liner so the
// signal is grep-able in Vercel logs + easy to forward to Sentry later. The
// 120-char before/after slice is enough to identify the pattern without
// flooding the log line. agentId is captured when present on the create args.
function logSanitiserCorrection(opts: {
  op: "create" | "createMany" | "update";
  agentId?: string | null;
  before: string;
  after: string;
}) {
  const droppedChars = opts.before.length - opts.after.length;
  const beforeSnip = opts.before.slice(0, 120).replace(/\n/g, " ");
  const afterSnip = opts.after.slice(0, 120).replace(/\n/g, " ");
  console.warn(
    `[chat-sanitiser] op=${opts.op} agent=${opts.agentId ?? "?"} dropped=${droppedChars}ch ` +
    `before="${beforeSnip}" after="${afterSnip}"`,
  );
  // Sentry breadcrumb — if a subsequent error fires in the same request, the
  // sanitiser corrections show up in the trail so we can correlate a leak with
  // a downstream failure. No event sent on its own; trail-only.
  try {
    Sentry.addBreadcrumb({
      category: "chat-sanitiser",
      message: `${opts.op} dropped ${droppedChars} chars`,
      level: "warning",
      data: { agentId: opts.agentId ?? null, op: opts.op, before: beforeSnip, after: afterSnip },
    });
  } catch {}
}

function createClient() {
  // Use Transaction mode pooler (port 6543 + pgbouncer=true) to avoid
  // "max clients reached" errors in Session mode.
  const rawUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || "";

  if (!rawUrl) {
    throw new Error("DATABASE_URL (or TEST_DATABASE_URL for integration tests) is not configured");
  }

  let connectionString = rawUrl;
  if (!rawUrl.includes("pgbouncer=true")) {
    // Switch to pgbouncer port if still on direct port 5432
    const withPort = rawUrl.includes(":5432/")
      ? rawUrl.replace(/:5432\//, ":6543/")
      : rawUrl;
    // Append pgbouncer param correctly regardless of existing query string
    const separator = withPort.includes("?") ? "&" : "?";
    connectionString = `${withPort}${separator}pgbouncer=true`;
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  } as any);

  // ── Auto-sanitise every agent-role ChatMessage write ─────────────────────
  // Defence-in-depth wrapper. The chat-stream + non-streaming chat routes
  // already run the full sanitiser (verified-tag stripping, fabricated-value
  // replacement, phase-complete rewrites). This extension catches any
  // remaining write paths — clarification-session, lifecycle-init, webhooks,
  // meeting-processor, phase-advance, change-proposals, etc. — and strips
  // context-marker leaks (`[I asked the user]`, `<prior_question>`,
  // `<effect>`, broadened past-tense forms) before the row hits Postgres.
  //
  // Pure regex, no DB roundtrip, no LLM call. Only touches `role === "agent"`
  // rows so user messages and system markers pass through unchanged. If
  // `stripContextMarkerLeaks` returns the input unchanged, we return the
  // original args object (no allocation churn for clean writes).
  // Retry-on-pgbouncer-drop wrapper.
  // Supabase's transaction-mode pooler recycles connections aggressively; under
  // bursty load we see "Connection terminated unexpectedly" / "Server has
  // closed the connection" intermittently on what would otherwise be a healthy
  // query. Retry once with a small back-off so the next acquired pool slot
  // succeeds. We only retry on connection-loss markers — query errors (bad
  // SQL, validation, FK violations) pass through unchanged.
  const isTransientConnError = (e: unknown): boolean => {
    const msg = (e as any)?.message || String(e);
    return /Connection terminated unexpectedly|Server has closed the connection|Connection ended|ECONNRESET/i.test(msg);
  };

  return client.$extends({
    name: "transientConnRetry",
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (e) {
          if (!isTransientConnError(e)) throw e;
          await new Promise((r) => setTimeout(r, 100));
          return await query(args);
        }
      },
    },
  }).$extends({
    name: "chatMessageLeakSanitiser",
    query: {
      chatMessage: {
        async create({ args, query }) {
          const d = args.data as { role?: string | null; content?: string | null; agentId?: string | null } | undefined;
          if (d && d.role === "agent" && typeof d.content === "string" && d.content.length > 0) {
            const stripped = stripContextMarkerLeaks(d.content);
            if (stripped !== d.content) {
              logSanitiserCorrection({ op: "create", agentId: d.agentId, before: d.content, after: stripped });
              args.data = { ...(args.data as object), content: stripped } as typeof args.data;
            }
          }
          return query(args);
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((row) => {
              const d = row as { role?: string | null; content?: string | null; agentId?: string | null };
              if (d && d.role === "agent" && typeof d.content === "string" && d.content.length > 0) {
                const stripped = stripContextMarkerLeaks(d.content);
                if (stripped !== d.content) {
                  logSanitiserCorrection({ op: "createMany", agentId: d.agentId, before: d.content, after: stripped });
                  return { ...(row as object), content: stripped } as typeof row;
                }
              }
              return row;
            });
          }
          return query(args);
        },
        async update({ args, query }) {
          const d = args.data as { content?: unknown } | undefined;
          // For update, content may be `{ set: "..." }` (Prisma scalar set
          // wrapper) or a bare string. Only sanitise the bare-string case —
          // selectively rewriting a `{ set: ... }` wrapper is brittle and
          // agent-role isn't always available on update args. Updates of
          // chat content are rare anyway; the read-path Layer 2 covers them.
          if (d && typeof d.content === "string" && d.content.length > 0) {
            const stripped = stripContextMarkerLeaks(d.content);
            if (stripped !== d.content) {
              logSanitiserCorrection({ op: "update", agentId: null, before: d.content, after: stripped });
              args.data = { ...(args.data as object), content: stripped } as typeof args.data;
            }
          }
          return query(args);
        },
      },
    },
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

