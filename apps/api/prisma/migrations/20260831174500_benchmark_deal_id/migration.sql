-- WHICH deal a benchmark point came from.
--
-- `benchmarks.contribute` replaces a deal's previous contribution for the
-- period, and it matched on `dealName`. A name is not an identity, and both
-- failures land in a median other firms read as market evidence:
--
--   * two schemes named the same thing ("Phase 1" is not a rare name) erased
--     each other, so a firm contributing both was represented by one;
--   * renaming a deal between contributions matched nothing, so the old point
--     stood beside the new one and ONE scheme was counted twice — doubling its
--     weight in everybody else's benchmark.
--
-- Nullable: points contributed before this column existed carry no id, and
-- illustrative points have no deal at all. The replacement query keeps a
-- `dealId IS NULL AND dealName = ?` arm so those legacy rows are still swept
-- rather than becoming un-replaceable and duplicating on the next contribution.
ALTER TABLE "BenchmarkPoint" ADD COLUMN "dealId" TEXT;

CREATE INDEX "BenchmarkPoint_dealId_idx" ON "BenchmarkPoint"("dealId");
