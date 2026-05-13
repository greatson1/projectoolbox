import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { stripContextMarkerLeaks } from "@/lib/agents/sanitise-chat-response";

const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createClient> };

function createClient() {
  // Use Transaction mode pooler (port 6543 + pgbouncer=true) to avoid
  // "max clients reached" errors in Session mode.
  const rawUrl = process.env.DATABASE_URL!;

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
  return client.$extends({
    name: "chatMessageLeakSanitiser",
    query: {
      chatMessage: {
        async create({ args, query }) {
          const d = args.data as { role?: string | null; content?: string | null } | undefined;
          if (d && d.role === "agent" && typeof d.content === "string" && d.content.length > 0) {
            const stripped = stripContextMarkerLeaks(d.content);
            if (stripped !== d.content) {
              args.data = { ...(args.data as object), content: stripped } as typeof args.data;
            }
          }
          return query(args);
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((row) => {
              const d = row as { role?: string | null; content?: string | null };
              if (d && d.role === "agent" && typeof d.content === "string" && d.content.length > 0) {
                const stripped = stripContextMarkerLeaks(d.content);
                if (stripped !== d.content) return { ...(row as object), content: stripped } as typeof row;
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
