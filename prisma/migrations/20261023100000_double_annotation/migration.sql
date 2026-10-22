-- CreateEnum
CREATE TYPE "LabelingActivityKind" AS ENUM ('label', 'review');

-- CreateEnum
CREATE TYPE "DoubleRoundStatus" AS ENUM ('active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "DoubleTaskStatus" AS ENUM ('pending', 'submitted', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "DoubleOutcomeState" AS ENUM ('waiting', 'agreed', 'disagreed', 'reviewed', 'accepted_single');

-- AlterTable
ALTER TABLE "LabelingActivity" ADD COLUMN     "kind" "LabelingActivityKind" NOT NULL DEFAULT 'label';

-- CreateTable
CREATE TABLE "DoubleRound" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "status" "DoubleRoundStatus" NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "DoubleRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoubleTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "assigneeId" TEXT,
    "status" "DoubleTaskStatus" NOT NULL DEFAULT 'pending',
    "fromBaseline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "DoubleTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoubleTaskLabel" (
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "nodeCode" TEXT NOT NULL,
    "labelingStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoubleTaskLabel_pkey" PRIMARY KEY ("taskId","taxonomyId","level")
);

-- CreateTable
CREATE TABLE "DoubleOutcome" (
    "workspaceId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "state" "DoubleOutcomeState" NOT NULL DEFAULT 'waiting',
    "sourceTaskId" TEXT,
    "matched" BOOLEAN,
    "comparedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "DoubleOutcome_pkey" PRIMARY KEY ("roundId","taxonomyId")
);

-- CreateIndex
CREATE INDEX "DoubleRound_sentenceId_idx" ON "DoubleRound"("sentenceId");

-- CreateIndex
CREATE INDEX "DoubleRound_workspaceId_status_idx" ON "DoubleRound"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DoubleRound_workspaceId_id_key" ON "DoubleRound"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "DoubleTask_roundId_idx" ON "DoubleTask"("roundId");

-- CreateIndex
CREATE INDEX "DoubleTask_sentenceId_idx" ON "DoubleTask"("sentenceId");

-- CreateIndex
CREATE INDEX "DoubleTask_assigneeId_status_idx" ON "DoubleTask"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DoubleTask_workspaceId_id_key" ON "DoubleTask"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "DoubleTaskLabel_taxonomyId_idx" ON "DoubleTaskLabel"("taxonomyId");

-- CreateIndex
CREATE INDEX "DoubleOutcome_sentenceId_idx" ON "DoubleOutcome"("sentenceId");

-- CreateIndex
CREATE INDEX "DoubleOutcome_workspaceId_state_idx" ON "DoubleOutcome"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "DoubleOutcome_taxonomyId_state_idx" ON "DoubleOutcome"("taxonomyId", "state");

-- AddForeignKey
ALTER TABLE "DoubleRound" ADD CONSTRAINT "DoubleRound_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleRound" ADD CONSTRAINT "DoubleRound_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleTask" ADD CONSTRAINT "DoubleTask_workspaceId_roundId_fkey" FOREIGN KEY ("workspaceId", "roundId") REFERENCES "DoubleRound"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleTask" ADD CONSTRAINT "DoubleTask_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleTask" ADD CONSTRAINT "DoubleTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleTaskLabel" ADD CONSTRAINT "DoubleTaskLabel_workspaceId_taskId_fkey" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "DoubleTask"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleTaskLabel" ADD CONSTRAINT "DoubleTaskLabel_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleOutcome" ADD CONSTRAINT "DoubleOutcome_workspaceId_roundId_fkey" FOREIGN KEY ("workspaceId", "roundId") REFERENCES "DoubleRound"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleOutcome" ADD CONSTRAINT "DoubleOutcome_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleOutcome" ADD CONSTRAINT "DoubleOutcome_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleOutcome" ADD CONSTRAINT "DoubleOutcome_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants Prisma cannot express (lib/double-annotation.ts relies on them).
-- At most one active round per record.
CREATE UNIQUE INDEX "DoubleRound_one_active_per_sentence" ON "DoubleRound"("sentenceId") WHERE "status" = 'active';
-- Two positions per round, each held by one live task, never the same person twice.
ALTER TABLE "DoubleTask" ADD CONSTRAINT "DoubleTask_position_check" CHECK ("position" IN (1, 2));
CREATE UNIQUE INDEX "DoubleTask_live_position" ON "DoubleTask"("roundId", "position") WHERE "status" <> 'cancelled';
CREATE UNIQUE INDEX "DoubleTask_live_assignee" ON "DoubleTask"("roundId", "assigneeId") WHERE "status" <> 'cancelled' AND "assigneeId" IS NOT NULL;
-- Paths keep string codes at levels 1..5.
ALTER TABLE "DoubleTaskLabel" ADD CONSTRAINT "DoubleTaskLabel_level_check" CHECK ("level" BETWEEN 1 AND 5);

-- A submitted answer is never changed: inserted and read only. Deletion only
-- through the cascading foreign keys (record, round or taxonomy deleted).
CREATE FUNCTION double_task_label_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'DoubleTaskLabel is immutable';
  END
  $$;
CREATE TRIGGER double_task_label_no_update BEFORE UPDATE ON "DoubleTaskLabel"
  FOR EACH ROW EXECUTE FUNCTION double_task_label_immutable();

-- Workspace row security for the new tables (same rule as the baseline).
ALTER TABLE "DoubleRound" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "DoubleRound"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());
ALTER TABLE "DoubleTask" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "DoubleTask"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());
ALTER TABLE "DoubleTaskLabel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "DoubleTaskLabel"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());
ALTER TABLE "DoubleOutcome" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "DoubleOutcome"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());
