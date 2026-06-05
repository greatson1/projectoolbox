-- ─────────────────────────────────────────────────────────────────────────────
-- Manual DB migration — Definition of Done / Definition of Ready columns
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Commit 4d07e37 wired DoD/DoR/Initial Product Backlog ingestion end-to-end:
-- the artefact PATCH handler now persists parsed criteria onto Project, and
-- the Task PATCH handler reads dodChecks/dorChecks to gate status→DONE and
-- the backlog→sprint pull. The Prisma client picked up four new columns;
-- the underlying DB never got them, so every agent chat (and any handler
-- that includes the full Project row) throws:
--
--     The column Project.definitionOfDone does not exist in the current database.
--
-- This file adds the four columns. Safe to re-run.
--
-- Apply by pasting into the Supabase SQL editor for project
-- fufdmofunzyxohzflyox (the ProjectToolbox Supabase instance).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Project table ────────────────────────────────────────────────────────────

-- Parsed Definition of Done — shape: { criteria: string[], sourceArtefactId,
-- approvedAt, emptyListsDetected? }. Populated by ingestCriteriaArtefact when
-- the corresponding artefact transitions to APPROVED. Nullable: a project
-- with no approved DoD just has the gate switched off (vacuously complete).
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "definitionOfDone" JSONB;

-- Parsed Definition of Ready — same shape as DoD. Gates the backlog→sprint
-- pull. Nullable for the same reason.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "definitionOfReady" JSONB;

-- ── Task table ───────────────────────────────────────────────────────────────

-- Per-task ticks for the project DoD criteria, indexed by criterion position.
-- Nullable = "none ticked yet" (treated as all-false by the gate).
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "dodChecks" JSONB;

-- Per-task ticks for the project DoR criteria. Enforced when transitioning
-- a task from backlog (sprintId null) into a sprint.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "dorChecks" JSONB;
