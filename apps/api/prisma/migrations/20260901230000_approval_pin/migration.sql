-- What an approval is worth, recorded on the row it applies to.
--
-- An approved version stored its inputs and a resultCache from the day of the
-- SAVE, and the reports recomputed from the inputs with whatever engine shipped
-- today. Nothing recorded which engine produced the figures somebody signed,
-- and no procedure could say whether a signed figure still held. Both columns
-- are written at approval, in the same statement that sets the status, and
-- nothing edits an approved row afterwards (approved-immutable).
--
-- Nullable: every version approved before this landed carries no pin, and the
-- reports say so rather than inventing one.
ALTER TABLE "Appraisal" ADD COLUMN "engineVersion" TEXT;
ALTER TABLE "Appraisal" ADD COLUMN "approvalPin" TEXT;
