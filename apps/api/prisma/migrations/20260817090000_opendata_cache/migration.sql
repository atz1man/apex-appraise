-- Cache for public open-data lookups (Land Registry, EA floods, Overpass, EPC,
-- planning constraints). Not org-scoped: the rows are published public record,
-- identical for every workspace, so they are shared and carry nothing a firm owns.
CREATE TABLE "OpenDataCache" (
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenDataCache_pkey" PRIMARY KEY ("key")
);

-- the sweeper deletes by age
CREATE INDEX "OpenDataCache_fetchedAt_idx" ON "OpenDataCache"("fetchedAt");
