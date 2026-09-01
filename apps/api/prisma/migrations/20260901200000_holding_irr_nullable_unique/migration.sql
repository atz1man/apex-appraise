-- Holding: one position per investor per deal, and an IRR that can be absent.
--
-- Until now nothing outside the demo seed could create a Holding at all, so no
-- deployment can hold a duplicate — but the register that now writes them must
-- not be able to, because `investorPosition` sums an investor's holdings and a
-- second row for the same deal doubles the committed figure the LP reads. The
-- delete is defensive and keeps the earliest id.
DELETE FROM "Holding" a
USING "Holding" b
WHERE a."investorId" = b."investorId"
  AND a."dealId" = b."dealId"
  AND a."id" > b."id";

CREATE UNIQUE INDEX "Holding_investorId_dealId_key" ON "Holding"("investorId", "dealId");

-- `irr` was `NOT NULL DEFAULT 0`, with zero standing in for "not recorded". That
-- made a deal that genuinely returned 0.0% indistinguishable from one nobody had
-- entered, and `weightedIrr` had to leave both out. Now that a firm can record
-- a figure, absence is a null and a zero is a zero. Existing zeros were all
-- sentinels under the old rule — nothing could have recorded a real one — so
-- they become nulls, which is what they always meant.
ALTER TABLE "Holding" ALTER COLUMN "irr" DROP DEFAULT;
ALTER TABLE "Holding" ALTER COLUMN "irr" DROP NOT NULL;
UPDATE "Holding" SET "irr" = NULL WHERE "irr" = 0;
