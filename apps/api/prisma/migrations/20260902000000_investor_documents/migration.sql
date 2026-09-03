-- A document is shared with a deal's investors by a flag on the document,
-- like the buyer flag beside it, rather than by a JSON list of names on the
-- investor that no procedure ever wrote and no file ever sat behind.
ALTER TABLE "Document" ADD COLUMN "investorVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Investor" DROP COLUMN "documents";
