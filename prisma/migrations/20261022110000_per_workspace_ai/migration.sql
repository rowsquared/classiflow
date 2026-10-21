-- Per-workspace AI (docs/plans/workspace-isolation.md, P6/P7): approved
-- endpoints, versioned workspace connections with encrypted credentials,
-- typed job inputs, a persisted taxonomy-sync job, and admission under
-- per-workspace and deployment-wide ceilings.

-- Jobs now name the connection version they run with. Jobs from before this
-- migration have none and cannot be resumed against a workspace connection;
-- they are job history only (no deployment holds real data yet), so they go.
DELETE FROM "AILabelingJob";
DELETE FROM "AILearningJob";

-- AlterTable
ALTER TABLE "AILabelingJob" ADD COLUMN     "connectionVersionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "AILearningJob" ADD COLUMN     "connectionVersionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Taxonomy" DROP COLUMN "lastAISyncAt",
DROP COLUMN "lastAISyncError",
DROP COLUMN "lastAISyncJobId",
DROP COLUMN "lastAISyncStatus";

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AILabelingJobInput" (
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AILabelingJobInput_pkey" PRIMARY KEY ("jobId","sentenceId")
);

-- CreateTable
CREATE TABLE "AILearningJobInput" (
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AILearningJobInput_pkey" PRIMARY KEY ("jobId","sentenceId")
);

-- CreateTable
CREATE TABLE "AITaxonomySyncJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "connectionVersionId" TEXT NOT NULL,
    "createdById" TEXT,
    "status" "AILabelingJobStatus" NOT NULL DEFAULT 'pending',
    "externalJobId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),

    CONSTRAINT "AITaxonomySyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIEndpoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "AIEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConnectionVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "endpointId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "credential" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "AIConnectionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AILabelingJobInput_sentenceId_idx" ON "AILabelingJobInput"("sentenceId");

-- CreateIndex
CREATE INDEX "AILearningJobInput_sentenceId_idx" ON "AILearningJobInput"("sentenceId");

-- CreateIndex
CREATE INDEX "AITaxonomySyncJob_status_idx" ON "AITaxonomySyncJob"("status");

-- CreateIndex
CREATE INDEX "AITaxonomySyncJob_taxonomyId_startedAt_idx" ON "AITaxonomySyncJob"("taxonomyId", "startedAt");

-- CreateIndex
CREATE INDEX "AITaxonomySyncJob_workspaceId_startedAt_idx" ON "AITaxonomySyncJob"("workspaceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AITaxonomySyncJob_workspaceId_id_key" ON "AITaxonomySyncJob"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AIEndpoint_baseUrl_key" ON "AIEndpoint"("baseUrl");

-- CreateIndex
CREATE UNIQUE INDEX "AIConnectionVersion_workspaceId_version_key" ON "AIConnectionVersion"("workspaceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AIConnectionVersion_workspaceId_id_key" ON "AIConnectionVersion"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AILabelingJob_workspaceId_id_key" ON "AILabelingJob"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AILearningJob_workspaceId_id_key" ON "AILearningJob"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "AILabelingJob" ADD CONSTRAINT "AILabelingJob_workspaceId_connectionVersionId_fkey" FOREIGN KEY ("workspaceId", "connectionVersionId") REFERENCES "AIConnectionVersion"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILearningJob" ADD CONSTRAINT "AILearningJob_workspaceId_connectionVersionId_fkey" FOREIGN KEY ("workspaceId", "connectionVersionId") REFERENCES "AIConnectionVersion"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILabelingJobInput" ADD CONSTRAINT "AILabelingJobInput_workspaceId_jobId_fkey" FOREIGN KEY ("workspaceId", "jobId") REFERENCES "AILabelingJob"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILabelingJobInput" ADD CONSTRAINT "AILabelingJobInput_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILearningJobInput" ADD CONSTRAINT "AILearningJobInput_workspaceId_jobId_fkey" FOREIGN KEY ("workspaceId", "jobId") REFERENCES "AILearningJob"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILearningJobInput" ADD CONSTRAINT "AILearningJobInput_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITaxonomySyncJob" ADD CONSTRAINT "AITaxonomySyncJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITaxonomySyncJob" ADD CONSTRAINT "AITaxonomySyncJob_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITaxonomySyncJob" ADD CONSTRAINT "AITaxonomySyncJob_workspaceId_connectionVersionId_fkey" FOREIGN KEY ("workspaceId", "connectionVersionId") REFERENCES "AIConnectionVersion"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITaxonomySyncJob" ADD CONSTRAINT "AITaxonomySyncJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConnectionVersion" ADD CONSTRAINT "AIConnectionVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConnectionVersion" ADD CONSTRAINT "AIConnectionVersion_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "AIEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row security for the new workspace tables (same policy as the baseline).
-- AIEndpoint is control plane: platform admins approve endpoints for every
-- workspace, and it holds no secret.
-- ---------------------------------------------------------------------------

ALTER TABLE "AILabelingJobInput" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "AILabelingJobInput"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "AILearningJobInput" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "AILearningJobInput"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "AITaxonomySyncJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "AITaxonomySyncJob"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "AIConnectionVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "AIConnectionVersion"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

-- ---------------------------------------------------------------------------
-- Cross-workspace job functions (lib/ai-job-monitor.ts). Like
-- app_recoverable_ai_jobs, they run as the schema owner, see job rows of
-- every workspace, return only ids and touch only status and lease columns.
-- Each is granted to the runtime role alone (scripts/db-runtime-role.ts).
-- ---------------------------------------------------------------------------

-- Jobs to take over: admitted (processing) jobs whose lease expired. Queued
-- (pending) jobs wait for app_admit_ai_jobs instead.
CREATE OR REPLACE FUNCTION app_recoverable_ai_jobs(as_of timestamp)
  RETURNS TABLE (kind text, id text, "workspaceId" text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT 'labeling', j.id, j."workspaceId" FROM "AILabelingJob" j
     WHERE j.status = 'processing'
       AND (j."leaseOwner" IS NULL OR j."leaseExpiresAt" IS NULL OR j."leaseExpiresAt" < as_of)
    UNION ALL
    SELECT 'learning', j.id, j."workspaceId" FROM "AILearningJob" j
     WHERE j.status = 'processing'
       AND (j."leaseOwner" IS NULL OR j."leaseExpiresAt" IS NULL OR j."leaseExpiresAt" < as_of)
    UNION ALL
    SELECT 'sync', j.id, j."workspaceId" FROM "AITaxonomySyncJob" j
     WHERE j.status = 'processing'
       AND (j."leaseOwner" IS NULL OR j."leaseExpiresAt" IS NULL OR j."leaseExpiresAt" < as_of)
    LIMIT 500
  $$;

-- Admission: moves queued (pending) jobs to processing while fewer than
-- `per_workspace` jobs of their workspace and `deployment` jobs overall are
-- processing, and leases them to `owner`. A transaction-scoped advisory lock
-- serialises admission across instances, so the ceilings hold. Fair across
-- workspaces: every workspace's next queued job comes before any workspace's
-- second, oldest first.
CREATE FUNCTION app_admit_ai_jobs(per_workspace integer, deployment integer, owner text, lease_until timestamp)
  RETURNS TABLE (kind text, id text, "workspaceId" text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
#variable_conflict use_column
DECLARE
  chosen record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('classiflow:ai-job-admission'));
  FOR chosen IN
    WITH jobs AS (
      SELECT 'labeling'::text AS kind, j.id, j."workspaceId", j.status::text AS status, j."startedAt"
        FROM "AILabelingJob" j WHERE j.status IN ('pending', 'processing')
      UNION ALL
      SELECT 'learning', j.id, j."workspaceId", j.status::text, j."startedAt"
        FROM "AILearningJob" j WHERE j.status IN ('pending', 'processing')
      UNION ALL
      SELECT 'sync', j.id, j."workspaceId", j.status::text, j."startedAt"
        FROM "AITaxonomySyncJob" j WHERE j.status IN ('pending', 'processing')
    ),
    running AS (
      SELECT jobs."workspaceId", count(*) AS n FROM jobs WHERE jobs.status = 'processing' GROUP BY jobs."workspaceId"
    ),
    queued AS (
      SELECT q.kind, q.id, q."workspaceId", q."startedAt",
             COALESCE(r.n, 0) + row_number() OVER (PARTITION BY q."workspaceId" ORDER BY q."startedAt", q.id) AS slot
        FROM jobs q LEFT JOIN running r ON r."workspaceId" = q."workspaceId"
       WHERE q.status = 'pending'
    )
    SELECT queued.kind, queued.id, queued."workspaceId" FROM queued
     WHERE queued.slot <= per_workspace
     ORDER BY queued.slot, queued."startedAt", queued.id
     LIMIT GREATEST(deployment - (SELECT count(*) FROM jobs WHERE jobs.status = 'processing'), 0)
  LOOP
    IF chosen.kind = 'labeling' THEN
      UPDATE "AILabelingJob" SET status = 'processing', "leaseOwner" = owner, "leaseExpiresAt" = lease_until
       WHERE "AILabelingJob".id = chosen.id AND "AILabelingJob".status = 'pending';
    ELSIF chosen.kind = 'learning' THEN
      UPDATE "AILearningJob" SET status = 'processing', "leaseOwner" = owner, "leaseExpiresAt" = lease_until
       WHERE "AILearningJob".id = chosen.id AND "AILearningJob".status = 'pending';
    ELSE
      UPDATE "AITaxonomySyncJob" SET status = 'processing', "leaseOwner" = owner, "leaseExpiresAt" = lease_until
       WHERE "AITaxonomySyncJob".id = chosen.id AND "AITaxonomySyncJob".status = 'pending';
    END IF;
    kind := chosen.kind;
    id := chosen.id;
    "workspaceId" := chosen."workspaceId";
    RETURN NEXT;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION app_admit_ai_jobs(integer, integer, text, timestamp) FROM PUBLIC;

-- Shutdown: gives back every lease `owner` holds, so another instance takes
-- the jobs over at once instead of after the lease expires.
CREATE FUNCTION app_release_ai_leases(owner text)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  released integer := 0;
  n integer;
BEGIN
  UPDATE "AILabelingJob" SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL WHERE "leaseOwner" = owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  released := released + n;
  UPDATE "AILearningJob" SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL WHERE "leaseOwner" = owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  released := released + n;
  UPDATE "AITaxonomySyncJob" SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL WHERE "leaseOwner" = owner;
  GET DIAGNOSTICS n = ROW_COUNT;
  released := released + n;
  RETURN released;
END
$$;
REVOKE ALL ON FUNCTION app_release_ai_leases(text) FROM PUBLIC;
