-- One human label per (record, taxonomy, level): saving replaces the label set.
--
-- Duplicates can only come from concurrent saves before this constraint
-- existed. Before deleting them, every duplicate row is copied to
-- classiflow_backup."SentenceAnnotationDuplicate20261021" (a separate schema,
-- so Prisma never sees or drops it) for review and, if needed, reversal. The
-- newest row (createdAt, then id) per key is kept.

CREATE SCHEMA IF NOT EXISTS "classiflow_backup";

CREATE TABLE "classiflow_backup"."SentenceAnnotationDuplicate20261021" AS
SELECT a.*
FROM "SentenceAnnotation" a
JOIN (
  SELECT "sentenceId", "taxonomyId", "level"
  FROM "SentenceAnnotation"
  GROUP BY 1, 2, 3
  HAVING COUNT(*) > 1
) d USING ("sentenceId", "taxonomyId", "level");

DELETE FROM "SentenceAnnotation" a
USING "SentenceAnnotation" newer
WHERE a."sentenceId" = newer."sentenceId"
  AND a."taxonomyId" = newer."taxonomyId"
  AND a."level" = newer."level"
  AND (a."createdAt", a."id") < (newer."createdAt", newer."id");

-- DropIndex
DROP INDEX "SentenceAnnotation_sentenceId_taxonomyId_level_idx";

-- CreateIndex
CREATE UNIQUE INDEX "SentenceAnnotation_sentenceId_taxonomyId_level_key" ON "SentenceAnnotation"("sentenceId", "taxonomyId", "level");
