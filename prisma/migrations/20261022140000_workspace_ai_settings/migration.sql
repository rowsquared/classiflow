-- AlterTable
ALTER TABLE "AIEndpoint" ADD COLUMN     "allWorkspaces" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "AILabelingJob" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "AILearningJob" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "AITaxonomySyncJob" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "aiLabelingBatchSize" INTEGER,
ADD COLUMN     "aiLearningBatchSize" INTEGER,
ADD COLUMN     "aiLearningMinNewAnnotations" INTEGER;

-- CreateTable
CREATE TABLE "AIEndpointGrant" (
    "endpointId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIEndpointGrant_pkey" PRIMARY KEY ("endpointId","workspaceId")
);

-- CreateIndex
CREATE INDEX "AIEndpointGrant_workspaceId_idx" ON "AIEndpointGrant"("workspaceId");

-- AddForeignKey
ALTER TABLE "AIEndpointGrant" ADD CONSTRAINT "AIEndpointGrant_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "AIEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEndpointGrant" ADD CONSTRAINT "AIEndpointGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Workspace AI settings are positive when set (null: the deployment setting).
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_aiSettings_positive" CHECK (
  ("aiLabelingBatchSize" IS NULL OR "aiLabelingBatchSize" BETWEEN 1 AND 100000) AND
  ("aiLearningBatchSize" IS NULL OR "aiLearningBatchSize" BETWEEN 1 AND 100000) AND
  ("aiLearningMinNewAnnotations" IS NULL OR "aiLearningMinNewAnnotations" BETWEEN 0 AND 1000000)
);

-- AIEndpointGrant is control plane, like AIEndpoint: platform admins decide
-- which workspaces may use an endpoint; it holds no workspace data or secret,
-- so it has no row security (scripts/restore-check.ts lists it).
