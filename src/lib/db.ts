import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

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
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  } as any);
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
