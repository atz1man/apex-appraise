-- A trial that ends.
--
-- Until now TRIAL carried Starter's volumes and no clock, which is a free tier
-- nobody decided to offer: three deals and two seats, forever, for nothing.
ALTER TABLE "Organisation" ADD COLUMN "trialEndsAt" TIMESTAMP(3);

-- Workspaces that already exist signed up under no time limit, so they are not
-- retro-expired: everyone on TRIAL today gets a full fresh 14 days from the
-- moment this deploys, and paid workspaces get no clock at all. Shortening a
-- deal after the fact is the kind of thing that loses the first ten customers.
UPDATE "Organisation"
   SET "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '14 days'
 WHERE "plan" = 'TRIAL';
