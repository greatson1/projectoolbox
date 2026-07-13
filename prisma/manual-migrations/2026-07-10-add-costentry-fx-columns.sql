-- ─────────────────────────────────────────────────────────────────────────────
-- Manual DB migration — CostEntry FX columns (review P1 leftover, shipped P3)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Multi-currency cost booking: a cost incurred in a foreign currency is
-- converted to the org's base currency AT WRITE TIME using a user-supplied
-- rate (rates are facts the user provides — never invented). The converted
-- value lands in `amount` (so every existing SUM/EVM/CPI path keeps working
-- unchanged); these columns preserve the original figure for audit:
--   originalAmount   — the amount as incurred (e.g. 1200)
--   originalCurrency — the currency it was incurred in (e.g. EUR)
--   fxRate           — the rate applied (base per unit of original, e.g. 0.85)
-- All nullable — NULL means the entry was booked directly in base currency.
--
-- Safe to re-run. Apply via the Supabase SQL editor for project
-- fufdmofunzyxohzflyox, or via scripts with DIRECT_URL.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "CostEntry" ADD COLUMN IF NOT EXISTS "originalAmount" DOUBLE PRECISION;
ALTER TABLE "CostEntry" ADD COLUMN IF NOT EXISTS "originalCurrency" TEXT;
ALTER TABLE "CostEntry" ADD COLUMN IF NOT EXISTS "fxRate" DOUBLE PRECISION;
