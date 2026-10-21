-- Baseline schema (fresh start, 21 October 2026): replaces the migration
-- history; includes workspaces and their row security. The tables come from
--   prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
-- and the row-security section below is hand-written.

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('admin', 'supervisor', 'labeller');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "SentenceStatus" AS ENUM ('pending', 'submitted', 'skipped', 'escalated');

-- CreateEnum
CREATE TYPE "AnnotationSource" AS ENUM ('user', 'ai');

-- CreateEnum
CREATE TYPE "AILabelingJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayUsername" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "role" "PlatformRole" NOT NULL DEFAULT 'user',
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "mustResetPassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "impersonatedBy" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'active',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "supervisorMembershipId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Taxonomy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "levelNames" JSONB,
    "maxDepth" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastAISyncAt" TIMESTAMP(3),
    "lastAISyncStatus" TEXT,
    "lastAISyncError" TEXT,
    "lastAISyncJobId" TEXT,
    "lastLearningAt" TIMESTAMP(3),
    "lastLearningJobId" TEXT,
    "lastLearningStatus" TEXT,
    "lastLearningError" TEXT,
    "newAnnotationsSinceLastLearning" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Taxonomy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomySetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "autoSelectThreshold" DOUBLE PRECISION,

    CONSTRAINT "TaxonomySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomyNode" (
    "code" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "definition" TEXT,
    "examples" TEXT,
    "parentCode" TEXT,
    "level" INTEGER NOT NULL,
    "path" TEXT,
    "isLeaf" BOOLEAN NOT NULL,

    CONSTRAINT "TaxonomyNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomySynonym" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "synonym" TEXT NOT NULL,

    CONSTRAINT "TaxonomySynonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentenceImport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,
    "totalRows" INTEGER NOT NULL,

    CONSTRAINT "SentenceImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentenceAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "SentenceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sentence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordKey" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "importOrder" INTEGER NOT NULL,
    "field1" TEXT NOT NULL,
    "field2" TEXT,
    "field3" TEXT,
    "field4" TEXT,
    "field5" TEXT,
    "support1" TEXT,
    "support2" TEXT,
    "support3" TEXT,
    "support4" TEXT,
    "support5" TEXT,
    "fieldMapping" JSONB NOT NULL,
    "supportMapping" JSONB,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "status" "SentenceStatus" NOT NULL DEFAULT 'pending',
    "lastEditorId" TEXT,
    "lastEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sentence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentenceAnnotation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "nodeCode" TEXT NOT NULL,
    "source" "AnnotationSource" NOT NULL,
    "createdById" TEXT,
    "labelingStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SentenceAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentenceAISuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "nodeCode" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "suggestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentenceAISuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AILabelingJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "status" "AILabelingJobStatus" NOT NULL DEFAULT 'pending',
    "totalSentences" INTEGER NOT NULL,
    "processedSentences" INTEGER NOT NULL DEFAULT 0,
    "failedSentences" INTEGER NOT NULL DEFAULT 0,
    "batchSize" INTEGER NOT NULL DEFAULT 1000,
    "filterCriteria" JSONB,
    "externalJobId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),

    CONSTRAINT "AILabelingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AILearningJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "status" "AILabelingJobStatus" NOT NULL DEFAULT 'pending',
    "totalSentences" INTEGER NOT NULL,
    "processedSentences" INTEGER NOT NULL DEFAULT 0,
    "failedSentences" INTEGER NOT NULL DEFAULT 0,
    "batchSize" INTEGER NOT NULL DEFAULT 100,
    "filterCriteria" JSONB,
    "externalJobId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),

    CONSTRAINT "AILearningJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_userId_idx" ON "WorkspaceMembership"("userId");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_workspaceId_supervisorMembershipId_idx" ON "WorkspaceMembership"("workspaceId", "supervisorMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_id_key" ON "WorkspaceMembership"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Taxonomy_workspaceId_key_key" ON "Taxonomy"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Taxonomy_workspaceId_id_key" ON "Taxonomy"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomySetting_taxonomyId_key" ON "TaxonomySetting"("taxonomyId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomySetting_workspaceId_taxonomyId_key" ON "TaxonomySetting"("workspaceId", "taxonomyId");

-- CreateIndex
CREATE INDEX "TaxonomyNode_taxonomyId_level_idx" ON "TaxonomyNode"("taxonomyId", "level");

-- CreateIndex
CREATE INDEX "TaxonomyNode_taxonomyId_parentCode_idx" ON "TaxonomyNode"("taxonomyId", "parentCode");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyNode_taxonomyId_code_key" ON "TaxonomyNode"("taxonomyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyNode_taxonomyId_id_key" ON "TaxonomyNode"("taxonomyId", "id");

-- CreateIndex
CREATE INDEX "TaxonomySynonym_taxonomyId_nodeId_idx" ON "TaxonomySynonym"("taxonomyId", "nodeId");

-- CreateIndex
CREATE INDEX "SentenceImport_workspaceId_uploadedAt_idx" ON "SentenceImport"("workspaceId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SentenceImport_workspaceId_id_key" ON "SentenceImport"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "SentenceAssignment_membershipId_idx" ON "SentenceAssignment"("membershipId");

-- CreateIndex
CREATE INDEX "SentenceAssignment_sentenceId_idx" ON "SentenceAssignment"("sentenceId");

-- CreateIndex
CREATE UNIQUE INDEX "SentenceAssignment_sentenceId_membershipId_key" ON "SentenceAssignment"("sentenceId", "membershipId");

-- CreateIndex
CREATE INDEX "Sentence_importId_idx" ON "Sentence"("importId");

-- CreateIndex
CREATE INDEX "Sentence_workspaceId_status_idx" ON "Sentence"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Sentence_workspaceId_field1_idx" ON "Sentence"("workspaceId", "field1");

-- CreateIndex
CREATE INDEX "Sentence_importId_importOrder_idx" ON "Sentence"("importId", "importOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Sentence_workspaceId_recordKey_key" ON "Sentence"("workspaceId", "recordKey");

-- CreateIndex
CREATE UNIQUE INDEX "Sentence_workspaceId_id_key" ON "Sentence"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "SentenceAnnotation_nodeCode_idx" ON "SentenceAnnotation"("nodeCode");

-- CreateIndex
CREATE INDEX "SentenceAnnotation_createdById_createdAt_idx" ON "SentenceAnnotation"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "SentenceAnnotation_workspaceId_createdAt_idx" ON "SentenceAnnotation"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SentenceAnnotation_sentenceId_taxonomyId_level_key" ON "SentenceAnnotation"("sentenceId", "taxonomyId", "level");

-- CreateIndex
CREATE INDEX "SentenceAISuggestion_sentenceId_idx" ON "SentenceAISuggestion"("sentenceId");

-- CreateIndex
CREATE INDEX "SentenceAISuggestion_taxonomyId_nodeCode_idx" ON "SentenceAISuggestion"("taxonomyId", "nodeCode");

-- CreateIndex
CREATE INDEX "SentenceAISuggestion_confidenceScore_idx" ON "SentenceAISuggestion"("confidenceScore");

-- CreateIndex
CREATE INDEX "SentenceAISuggestion_suggestedAt_idx" ON "SentenceAISuggestion"("suggestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SentenceAISuggestion_sentenceId_taxonomyId_level_key" ON "SentenceAISuggestion"("sentenceId", "taxonomyId", "level");

-- CreateIndex
CREATE INDEX "AILabelingJob_status_idx" ON "AILabelingJob"("status");

-- CreateIndex
CREATE INDEX "AILabelingJob_createdById_idx" ON "AILabelingJob"("createdById");

-- CreateIndex
CREATE INDEX "AILabelingJob_taxonomyId_idx" ON "AILabelingJob"("taxonomyId");

-- CreateIndex
CREATE INDEX "AILabelingJob_workspaceId_startedAt_idx" ON "AILabelingJob"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "AILearningJob_status_idx" ON "AILearningJob"("status");

-- CreateIndex
CREATE INDEX "AILearningJob_createdById_idx" ON "AILearningJob"("createdById");

-- CreateIndex
CREATE INDEX "AILearningJob_taxonomyId_idx" ON "AILearningJob"("taxonomyId");

-- CreateIndex
CREATE INDEX "AILearningJob_workspaceId_startedAt_idx" ON "AILearningJob"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "Comment_sentenceId_idx" ON "Comment"("sentenceId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_supervisorMembershipId_fkey" FOREIGN KEY ("workspaceId", "supervisorMembershipId") REFERENCES "WorkspaceMembership"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Taxonomy" ADD CONSTRAINT "Taxonomy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomySetting" ADD CONSTRAINT "TaxonomySetting_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyNode" ADD CONSTRAINT "TaxonomyNode_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomySynonym" ADD CONSTRAINT "TaxonomySynonym_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomySynonym" ADD CONSTRAINT "TaxonomySynonym_taxonomyId_nodeId_fkey" FOREIGN KEY ("taxonomyId", "nodeId") REFERENCES "TaxonomyNode"("taxonomyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceImport" ADD CONSTRAINT "SentenceImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceImport" ADD CONSTRAINT "SentenceImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAssignment" ADD CONSTRAINT "SentenceAssignment_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAssignment" ADD CONSTRAINT "SentenceAssignment_workspaceId_membershipId_fkey" FOREIGN KEY ("workspaceId", "membershipId") REFERENCES "WorkspaceMembership"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_workspaceId_importId_fkey" FOREIGN KEY ("workspaceId", "importId") REFERENCES "SentenceImport"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_lastEditorId_fkey" FOREIGN KEY ("lastEditorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAnnotation" ADD CONSTRAINT "SentenceAnnotation_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAnnotation" ADD CONSTRAINT "SentenceAnnotation_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAnnotation" ADD CONSTRAINT "SentenceAnnotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAISuggestion" ADD CONSTRAINT "SentenceAISuggestion_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAISuggestion" ADD CONSTRAINT "SentenceAISuggestion_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILabelingJob" ADD CONSTRAINT "AILabelingJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILabelingJob" ADD CONSTRAINT "AILabelingJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILabelingJob" ADD CONSTRAINT "AILabelingJob_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILearningJob" ADD CONSTRAINT "AILearningJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILearningJob" ADD CONSTRAINT "AILearningJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILearningJob" ADD CONSTRAINT "AILearningJob_workspaceId_taxonomyId_fkey" FOREIGN KEY ("workspaceId", "taxonomyId") REFERENCES "Taxonomy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_workspaceId_sentenceId_fkey" FOREIGN KEY ("workspaceId", "sentenceId") REFERENCES "Sentence"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Workspace row security (docs/plans/workspace-isolation.md)
--
-- lib/workspace/db.ts opens every workspace transaction with
--   SELECT set_config('app.workspace_id', <id>, true)
-- (transaction-local, safe with a connection pool). Without that setting
-- workspace data is invisible and cannot be written: access fails closed.
-- Policies apply to the least-privilege runtime role (scripts/db-runtime-role.ts);
-- the schema owner, which runs migrations and recovery, is not subject to them.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_current_workspace() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '') $$;

ALTER TABLE "Taxonomy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Taxonomy"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "TaxonomySetting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "TaxonomySetting"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "TaxonomyNode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "TaxonomyNode"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "TaxonomySynonym" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "TaxonomySynonym"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "SentenceImport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "SentenceImport"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "SentenceAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "SentenceAssignment"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "Sentence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Sentence"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "SentenceAnnotation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "SentenceAnnotation"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "SentenceAISuggestion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "SentenceAISuggestion"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "AILabelingJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "AILabelingJob"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "AILearningJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "AILearningJob"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "Comment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "Comment"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

-- Platform events (no workspace) are visible only outside a workspace
-- transaction; workspace events only inside their own workspace's.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "AuditLog"
  USING (("workspaceId" IS NULL AND app_current_workspace() IS NULL) OR "workspaceId" = app_current_workspace())
  WITH CHECK (("workspaceId" IS NULL AND app_current_workspace() IS NULL) OR "workspaceId" = app_current_workspace());

-- AI job recovery (lib/ai-job-monitor.ts) must find jobs in every workspace
-- before it can open the right workspace transaction. This function returns
-- only job ids and their workspace, runs as the schema owner, and is granted
-- to the runtime role alone (scripts/db-runtime-role.ts).
CREATE FUNCTION app_recoverable_ai_jobs(as_of timestamp)
  RETURNS TABLE (kind text, id text, "workspaceId" text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT 'labeling', j.id, j."workspaceId" FROM "AILabelingJob" j
     WHERE j.status IN ('pending', 'processing')
       AND (j."leaseOwner" IS NULL OR j."leaseExpiresAt" IS NULL OR j."leaseExpiresAt" < as_of)
    UNION ALL
    SELECT 'learning', j.id, j."workspaceId" FROM "AILearningJob" j
     WHERE j.status IN ('pending', 'processing')
       AND (j."leaseOwner" IS NULL OR j."leaseExpiresAt" IS NULL OR j."leaseExpiresAt" < as_of)
    LIMIT 500
  $$;
REVOKE ALL ON FUNCTION app_recoverable_ai_jobs(timestamp) FROM PUBLIC;
