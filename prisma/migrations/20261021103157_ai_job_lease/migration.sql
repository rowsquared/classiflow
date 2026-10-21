-- AlterTable
ALTER TABLE "AILabelingJob" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseOwner" TEXT;

-- AlterTable
ALTER TABLE "AILearningJob" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseOwner" TEXT;
