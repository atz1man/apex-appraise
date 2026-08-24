-- A sign-in token is valid for twelve hours on its signature alone, so changing
-- a password did nothing to the sessions already out there. This column is the
-- floor: any token issued before it is refused.
--
-- Backfilled to now() for existing rows, which signs everybody out once on
-- deploy. That is the safe direction — the alternative is a default in the past,
-- which would leave every currently-outstanding token valid and make the
-- column's first job a no-op.
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
