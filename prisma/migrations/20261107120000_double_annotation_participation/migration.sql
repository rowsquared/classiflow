-- Double annotation v2, phase A (docs/plans/double-annotation-v2.md):
-- answer revisions, the participant's own flag, the confirmed path per outcome.

-- AlterTable
ALTER TABLE "DoubleOutcome" ADD COLUMN     "resultCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revisedAfterCompare" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DoubleTask" ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DoubleTaskLabel" DROP CONSTRAINT "DoubleTaskLabel_pkey",
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD CONSTRAINT "DoubleTaskLabel_pkey" PRIMARY KEY ("taskId", "taxonomyId", "revision", "level");

-- Answers stay immutable; the only allowed change marks a revision as
-- superseded (once). Deletion only through the cascading foreign keys.
CREATE OR REPLACE FUNCTION double_task_label_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD."supersededAt" IS NULL AND NEW."supersededAt" IS NOT NULL
       AND (NEW."workspaceId", NEW."taskId", NEW."taxonomyId", NEW."level", NEW."nodeCode", NEW."revision",
            NEW."labelingStartedAt", NEW."createdAt")
           IS NOT DISTINCT FROM
           (OLD."workspaceId", OLD."taskId", OLD."taxonomyId", OLD."level", OLD."nodeCode", OLD."revision",
            OLD."labelingStartedAt", OLD."createdAt") THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'DoubleTaskLabel is immutable';
  END
  $$;

-- Current answers of a task, by taxonomy.
CREATE INDEX "DoubleTaskLabel_current_idx" ON "DoubleTaskLabel"("taskId", "taxonomyId") WHERE "supersededAt" IS NULL;

-- Backfill the confirmed path: agreed and accepted single from the answer
-- that became the result, reviewed from the record's current labels.
UPDATE "DoubleOutcome" o SET "resultCodes" = a.codes
FROM (
  SELECT "taskId", "taxonomyId", array_agg("nodeCode" ORDER BY "level") AS codes
  FROM "DoubleTaskLabel" GROUP BY "taskId", "taxonomyId"
) a
WHERE o."state" IN ('agreed', 'accepted_single') AND a."taskId" = o."sourceTaskId" AND a."taxonomyId" = o."taxonomyId";

UPDATE "DoubleOutcome" o SET "resultCodes" = a.codes
FROM (
  SELECT "sentenceId", "taxonomyId", array_agg("nodeCode" ORDER BY "level") AS codes
  FROM "SentenceAnnotation" WHERE "source" = 'user' GROUP BY "sentenceId", "taxonomyId"
) a
WHERE o."state" = 'reviewed' AND a."sentenceId" = o."sentenceId" AND a."taxonomyId" = o."taxonomyId";
