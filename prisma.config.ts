import "dotenv/config";
import { defineConfig } from "prisma/config";

// Runtime queries use the Transaction mode pooler (port 6543, pgbouncer=true) for higher
// connection limits. Schema operations (db push / migrate) must use the direct connection
// (port 5432, no pgbouncer) because prepared statements are not supported by the pooler.
const rawUrl = (process.env["DATABASE_URL"] || "").replace(":5432/", ":6543/").replace("5432/postgres", "6543/postgres");
const separator = rawUrl.includes("?") ? "&" : "?";
const runtimeUrl = rawUrl.includes("pgbouncer") ? rawUrl : `${rawUrl}${separator}pgbouncer=true`;

// DIRECT_URL bypasses the pooler — required for db push / migrate deploy
const directUrl = process.env["DIRECT_URL"] || rawUrl.replace(":6543/", ":5432/").replace("6543/postgres", "5432/postgres").replace(/[?&]pgbouncer=true/, "");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: directUrl,
  },
});
