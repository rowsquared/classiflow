-- CreateTable
CREATE TABLE "AppRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "AppRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AppRateLimit_lastRequest_idx" ON "AppRateLimit"("lastRequest");

-- Preserve the current fixed windows when classiflow moves off Better Auth's table.
INSERT INTO "AppRateLimit" ("key", "count", "lastRequest")
SELECT "key", "count", "lastRequest" FROM "RateLimit"
WHERE "key" LIKE 'classiflow:%';
