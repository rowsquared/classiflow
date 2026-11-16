-- AlterTable
ALTER TABLE "OutgoingMail" ADD COLUMN     "invitationTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "invitationTokenHash" TEXT,
ADD COLUMN     "retryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Taxonomy" ADD COLUMN     "learningBacklog" BOOLEAN NOT NULL DEFAULT false;
