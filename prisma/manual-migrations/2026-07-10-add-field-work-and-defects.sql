-- ─────────────────────────────────────────────────────────────────────────────
-- Manual DB migration — field-work loop + defect log (review P1, docs/REVIEW-2026-07-10.md)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds the real-world work-tracking layer ported from the Pilot reference
-- implementation:
--   * Task.executor       — 'AGENT' | 'HUMAN' | NULL (unclassified). HUMAN
--                           tasks are real-world work the agent cannot do;
--                           they get check-in chases when silent.
--   * Task.lastUpdateAt   — when a human last reported progress on the task
--                           (updatedAt moves on any system write, so silence
--                           needs its own column).
--   * Task.blockedReason  — why the task is blocked (pairs with the existing
--                           Task.blocked flag); feeds the auto-raised risk.
--   * CheckIn             — an agent chase on a silent/blocked human task.
--   * Defect              — real defect/snag log behind the qa-testing page
--                           (previously a re-skinned Issue list).
--
-- All additions are nullable/new — nothing existing is touched. Safe to
-- re-run. Apply by pasting into the Supabase SQL editor for project
-- fufdmofunzyxohzflyox, or via scripts with DIRECT_URL.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "executor" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "lastUpdateAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "blockedReason" TEXT;

CREATE TABLE IF NOT EXISTS "CheckIn" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "taskId"      TEXT,
  "agentId"     TEXT,
  "question"    TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'OPEN',
  "response"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CheckIn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CheckIn_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CheckIn_projectId_status_idx" ON "CheckIn"("projectId", "status");
CREATE INDEX IF NOT EXISTS "CheckIn_taskId_idx" ON "CheckIn"("taskId");

CREATE TABLE IF NOT EXISTS "Defect" (
  "id"             TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "taskId"         TEXT,
  "title"          TEXT NOT NULL,
  "description"    TEXT,
  "severity"       TEXT NOT NULL DEFAULT 'MEDIUM',
  "status"         TEXT NOT NULL DEFAULT 'OPEN',
  "raisedBy"       TEXT,
  "resolutionNote" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"     TIMESTAMP(3),
  CONSTRAINT "Defect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Defect_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Defect_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Defect_projectId_status_idx" ON "Defect"("projectId", "status");
