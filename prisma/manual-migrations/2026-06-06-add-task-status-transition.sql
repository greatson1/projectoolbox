-- ─────────────────────────────────────────────────────────────────────────────
-- Manual DB migration — TaskStatusTransition table for cycle-time analytics
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds the table that records every task status change so the Sprint Tracker's
-- "Avg Cycle Time by Status" chart has data to read. One row per transition
-- with the duration the task spent in the status it just left.
--
-- Applied to fufdmofunzyxohzflyox (wrong project — ProjectToolbox web app DB is
-- ayhdvzyxwcnyupvdxplm) on 2026-06-06 via VPS psql. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TaskStatusTransition" (
  "id"         TEXT PRIMARY KEY,
  "taskId"     TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "fromStatus" TEXT,                                   -- null for the very first transition
  "toStatus"   TEXT NOT NULL,
  "durationMs" DOUBLE PRECISION NOT NULL DEFAULT 0,    -- ms spent in fromStatus before this change
  "changedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedBy"  TEXT                                    -- user:<id> | agent:<id>
);

-- groupBy(fromStatus) for the cycle-time aggregation query
CREATE INDEX IF NOT EXISTS "TaskStatusTransition_projectId_fromStatus_idx"
  ON "TaskStatusTransition"("projectId", "fromStatus");

-- "last transition for this task" lookup in recordStatusTransition
CREATE INDEX IF NOT EXISTS "TaskStatusTransition_taskId_idx"
  ON "TaskStatusTransition"("taskId");
