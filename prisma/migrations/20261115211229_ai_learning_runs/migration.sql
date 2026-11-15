-- AlterTable
ALTER TABLE "AILearningJob" ADD COLUMN     "learningRunId" TEXT,
ADD COLUMN     "queuedAnnotationCount" INTEGER,
ADD COLUMN     "selectionCutoff" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AILearningJobInput" ADD COLUMN     "annotationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "annotations" JSONB;

-- AlterTable
ALTER TABLE "Taxonomy" ADD COLUMN     "legacyLearningCutoff" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AILearningJob_workspaceId_taxonomyId_learningRunId_idx" ON "AILearningJob"("workspaceId", "taxonomyId", "learningRunId");

-- Existing installations have a timestamp watermark but no stored label revisions.
UPDATE "Taxonomy" SET "legacyLearningCutoff" = "lastLearningAt" WHERE "lastLearningAt" IS NOT NULL;

UPDATE "Taxonomy" t
SET "lastLearningStatus" = 'failed',
    "lastLearningError" = 'The previous learning run is no longer active. Retry to check for unsent labels.'
WHERE t."lastLearningStatus" = 'processing'
  AND NOT EXISTS (
    SELECT 1 FROM "AILearningJob" j
    WHERE j."workspaceId" = t."workspaceId" AND j."taxonomyId" = t.id
      AND j.status IN ('pending', 'processing')
  );
