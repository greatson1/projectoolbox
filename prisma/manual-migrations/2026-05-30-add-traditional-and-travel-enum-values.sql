-- 2026-05-30 — Add TRADITIONAL and TRAVEL to the Methodology enum.
--
-- Why this is a manual file:
--   The codebase doesn't use prisma migrate (no /prisma/migrations directory).
--   Schema changes are applied via `prisma db push`. Vercel runs
--   `prisma generate` on build but NOT `db push` — so this SQL has to be
--   applied to the Supabase database manually before the new enum values
--   can be written.
--
-- Why TRADITIONAL: legacy projects stored "Traditional" as PRINCE2. Going
--   forward new Traditional projects store TRADITIONAL directly. Old
--   PRINCE2 rows still resolve to Traditional via getMethodology() +
--   getMethodologyLabel(), so no row migration is required.
--
-- Why TRAVEL: the Travel & Trip methodology shipped at 442fbac couldn't
--   persist because the enum had no TRAVEL value. Users picking Travel
--   were silently bucketed as WATERFALL, losing the trip lifecycle.
--
-- How to apply: paste these statements into the Supabase SQL editor for
--   project fufdmofunzyxohzflyox. They are idempotent — re-running is safe.
--
-- After applying: redeploy the Next.js app so the Prisma client picks up
--   the regenerated types. The client side change has already shipped.

ALTER TYPE "Methodology" ADD VALUE IF NOT EXISTS 'TRADITIONAL';
ALTER TYPE "Methodology" ADD VALUE IF NOT EXISTS 'TRAVEL';
