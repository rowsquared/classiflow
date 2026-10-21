-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "activityTrackedSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reportingTimezone" TEXT;

-- CreateTable
CREATE TABLE "LabelingActivity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "actorId" TEXT,
    "operationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelingActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabelingActivity_workspaceId_createdAt_idx" ON "LabelingActivity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LabelingActivity_workspaceId_actorId_createdAt_idx" ON "LabelingActivity"("workspaceId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "LabelingActivity_sentenceId_idx" ON "LabelingActivity"("sentenceId");

-- CreateIndex
CREATE UNIQUE INDEX "LabelingActivity_workspaceId_operationId_sentenceId_key" ON "LabelingActivity"("workspaceId", "operationId", "sentenceId");

-- AddForeignKey
ALTER TABLE "LabelingActivity" ADD CONSTRAINT "LabelingActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelingActivity" ADD CONSTRAINT "LabelingActivity_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelingActivity" ADD CONSTRAINT "LabelingActivity_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelingActivity" ADD CONSTRAINT "LabelingActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Workspace row security for the new table (same rule as the baseline).
ALTER TABLE "LabelingActivity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "LabelingActivity"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

-- Append-only: activity rows are inserted and read, never changed. The one
-- update allowed is the foreign key's own ON DELETE SET NULL when the actor's
-- account is deleted. Deletion happens only through the cascading foreign keys
-- (record or taxonomy deleted).
CREATE FUNCTION labeling_activity_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW."actorId" IS NULL
       AND (NEW.id, NEW."workspaceId", NEW."sentenceId", NEW."taxonomyId", NEW."operationId", NEW."createdAt")
         IS NOT DISTINCT FROM
           (OLD.id, OLD."workspaceId", OLD."sentenceId", OLD."taxonomyId", OLD."operationId", OLD."createdAt")
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'LabelingActivity is append-only';
  END
  $$;
CREATE TRIGGER labeling_activity_no_update BEFORE UPDATE ON "LabelingActivity"
  FOR EACH ROW EXECUTE FUNCTION labeling_activity_append_only();

-- Queue text search (lib/server/sentences.ts queueWhere): `q` is matched with
-- ILIKE '%q%' on field1..field5, which a B-tree cannot serve. Trigram GIN
-- indexes can (for terms of three or more characters). pg_trgm is a trusted
-- extension, so the database owner may install it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Sentence_field1_trgm_idx" ON "Sentence" USING GIN ("field1" gin_trgm_ops);
CREATE INDEX "Sentence_field2_trgm_idx" ON "Sentence" USING GIN ("field2" gin_trgm_ops);
CREATE INDEX "Sentence_field3_trgm_idx" ON "Sentence" USING GIN ("field3" gin_trgm_ops);
CREATE INDEX "Sentence_field4_trgm_idx" ON "Sentence" USING GIN ("field4" gin_trgm_ops);
CREATE INDEX "Sentence_field5_trgm_idx" ON "Sentence" USING GIN ("field5" gin_trgm_ops);

-- Row security keeps those indexes from the runtime role: ILIKE is not
-- leakproof, so under a policy PostgreSQL must not evaluate it before the
-- policy's own condition, and scans the table instead (measured: 41 ms vs
-- 0.2 ms for one search at 50,000 records). This function runs the search as
-- the schema owner, where the indexes apply, but only ever inside the current
-- transaction's workspace (app_current_workspace(); none outside a workspace
-- transaction) and returns record ids only, at most max_rows of them. The
-- caller then loads the records through row security as usual. Same matching
-- as Prisma's `contains` with mode insensitive: ILIKE '%' || term || '%'.
CREATE FUNCTION app_search_sentences(term text, max_rows integer)
  RETURNS TABLE (id text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT s.id FROM "Sentence" s
     WHERE s."workspaceId" = app_current_workspace()
       AND (s.field1 ILIKE '%' || term || '%'
         OR s.field2 ILIKE '%' || term || '%'
         OR s.field3 ILIKE '%' || term || '%'
         OR s.field4 ILIKE '%' || term || '%'
         OR s.field5 ILIKE '%' || term || '%')
     LIMIT max_rows
  $$;
REVOKE ALL ON FUNCTION app_search_sentences(text, integer) FROM PUBLIC;
