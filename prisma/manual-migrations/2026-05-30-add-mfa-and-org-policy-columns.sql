-- ─────────────────────────────────────────────────────────────────────────────
-- Manual DB migration — MFA + org-wide require-MFA policy columns
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Schema columns added across three commits (d47a3b4 TOTP MFA → 426e876
-- require-MFA policy). The Vercel build picked up the new Prisma client
-- but the underlying DB columns were never created, so the dashboard
-- layout's MFA-policy SELECT throws "column does not exist" and every
-- dashboard route shows "A server error occurred" on production.
--
-- This file adds the missing columns in a way that's safe to re-run.
-- Apply by pasting into the Supabase SQL editor for project
-- fufdmofunzyxohzflyox (the ProjectToolbox Supabase instance).
--
-- The dashboard layout has been hardened in the same release to fail
-- OPEN when these columns are missing — so even before this migration
-- runs, the dashboard loads. After running it, MFA policy enforcement
-- actually works as designed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── User table ───────────────────────────────────────────────────────────────

-- TOTP secret (base32 string from otplib). Nullable because the user
-- only has one once they start the enrol flow.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaSecret" TEXT;

-- Gates the login challenge. Default OFF so existing users sign in normally.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Password hash (for credentials provider). Some envs may already have
-- this; add IF NOT EXISTS so this is a no-op when it does.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- ── Organisation table ───────────────────────────────────────────────────────

-- Org-wide policy toggle. Default OFF so existing orgs aren't suddenly
-- forced into MFA enrolment until an OWNER explicitly turns it on.
ALTER TABLE "Organisation" ADD COLUMN IF NOT EXISTS "requireMfa" BOOLEAN NOT NULL DEFAULT false;
