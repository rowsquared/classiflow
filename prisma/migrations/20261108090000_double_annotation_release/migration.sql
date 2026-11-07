-- Double annotation v2: "give back as ordinary work" (docs/plans/double-annotation-v2.md).
-- A released part no longer makes its person a participant of the record.

-- AlterTable
ALTER TABLE "DoubleTask" ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedById" TEXT;
