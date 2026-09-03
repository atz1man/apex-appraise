-- Which jurisdiction's vocabulary and floor-area unit a firm reads. Words and
-- units only — money stays in pounds and no figure is computed differently.
-- GB is the default because it is what every existing workspace already saw.
ALTER TABLE "OrgPolicy" ADD COLUMN "region" TEXT NOT NULL DEFAULT 'GB';
