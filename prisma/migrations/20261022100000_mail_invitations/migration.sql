-- CreateEnum
CREATE TYPE "MailPurpose" AS ENUM ('invitation', 'workspace_invitation', 'password_link', 'password_changed', 'email_changed', 'credentials');

-- CreateEnum
CREATE TYPE "MailStatus" AS ENUM ('pending', 'sending', 'sent', 'failed', 'unknown');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "invitationAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "invitedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkspaceMembership" ADD COLUMN     "addedById" TEXT;

-- CreateTable
CREATE TABLE "OutgoingMail" (
    "id" TEXT NOT NULL,
    "purpose" "MailPurpose" NOT NULL,
    "status" "MailStatus" NOT NULL DEFAULT 'pending',
    "userId" TEXT,
    "workspaceId" TEXT,
    "invitationId" TEXT,
    "recipient" TEXT,
    "requestedById" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutgoingMail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "supervisorMembershipId" TEXT,
    "invitedById" TEXT,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberImport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "importKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdById" TEXT,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberImportRow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "userId" TEXT,
    "access" TEXT NOT NULL,
    "mailId" TEXT,

    CONSTRAINT "MemberImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutgoingMail_status_createdAt_idx" ON "OutgoingMail"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutgoingMail_userId_createdAt_idx" ON "OutgoingMail"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OutgoingMail_invitationId_idx" ON "OutgoingMail"("invitationId");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_workspaceId_email_idx" ON "WorkspaceInvitation"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvitation_workspaceId_id_key" ON "WorkspaceInvitation"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MemberImport_workspaceId_importKey_key" ON "MemberImport"("workspaceId", "importKey");

-- CreateIndex
CREATE UNIQUE INDEX "MemberImport_workspaceId_id_key" ON "MemberImport"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "MemberImportRow_importId_idx" ON "MemberImportRow"("importId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingMail" ADD CONSTRAINT "OutgoingMail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingMail" ADD CONSTRAINT "OutgoingMail_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingMail" ADD CONSTRAINT "OutgoingMail_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutgoingMail" ADD CONSTRAINT "OutgoingMail_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "WorkspaceInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImport" ADD CONSTRAINT "MemberImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImportRow" ADD CONSTRAINT "MemberImportRow_workspaceId_importId_fkey" FOREIGN KEY ("workspaceId", "importId") REFERENCES "MemberImport"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Member imports belong to their workspace like every other workspace table
-- (see the baseline migration). Invitations and outgoing mail are control
-- plane: an invitee has no workspace context until they accept, and mail is
-- about accounts.
ALTER TABLE "MemberImport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "MemberImport"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());

ALTER TABLE "MemberImportRow" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON "MemberImportRow"
  USING ("workspaceId" = app_current_workspace())
  WITH CHECK ("workspaceId" = app_current_workspace());
