-- ─────────────────────────────────────────────────────────────────────────────
-- Manual DB migration — AGILEPM methodology enum value (review P3b)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- AgilePM (DSDM) becomes a first-class methodology (Feasibility →
-- Foundations → Evolutionary Development → Deployment → Post-Project).
-- Purely additive; existing rows untouched. PRINCE2 already exists as an
-- enum value (it was the legacy alias for Traditional and now resolves to
-- its own first-class definition — no DB change needed for it).
--
-- Safe to re-run. Apply via the Supabase SQL editor for project
-- fufdmofunzyxohzflyox, or via scripts with DIRECT_URL.
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE "Methodology" ADD VALUE IF NOT EXISTS 'AGILEPM';
