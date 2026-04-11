import "dotenv/config";
import { defineConfig } from "prisma/config";

// Use Transaction mode pooler (port 6543) for runtime queries — much higher connection limit.
// Use direct connection (port 5432) for migrations only.
const runtimeUrl = (process.env["DATABASE_URL"] || "").replace(":5432/", ":6543/").replace("5432/postgres", "6543/postgres") + (process.env["DATABASE_URL"]?.includes("pgbouncer") ? "" : "?pgbouncer=true");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: runtimeUrl,
  },
});
