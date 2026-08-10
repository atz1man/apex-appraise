-- Contribution is opt-in. Every existing workspace starts off, because nobody
-- has been asked yet and consent cannot be assumed retrospectively.
ALTER TABLE "Organisation" ADD COLUMN "contributesBenchmarks" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BenchmarkPoint" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'contributed';
ALTER TABLE "BenchmarkPoint" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The ownerless rows were seeded demonstration figures presented as a market
-- sample. They are marked for what they are before anything reads them again.
UPDATE "BenchmarkPoint" SET "source" = 'illustrative' WHERE "isOwn" = false;

-- isOwn conflated two different questions — "is this mine" and "is this market
-- data" — which is exactly how a firm's own cost base ended up in a query meant
-- for the shared pool. Ownership is now just orgId, and provenance is `source`.
ALTER TABLE "BenchmarkPoint" DROP COLUMN "isOwn";

CREATE INDEX "BenchmarkPoint_orgId_idx" ON "BenchmarkPoint"("orgId");
