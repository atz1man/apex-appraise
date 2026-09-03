-- WHICH buyer a document is shared with.
--
-- `Document.buyerVisible` has existed since the first migration and nothing in
-- the product could set it: every creator — the upload route, documents.expect,
-- the EPC link, the workspace importer — leaves it at the default of false, and
-- no procedure toggled it. Only the demo seed ever wrote true. So a firm paying
-- for "Buyer + investor portals" had a buyer whose "Documents to sign" panel
-- could only ever read "Nothing waiting for your signature".
--
-- Making it settable without this column would have opened a hole rather than
-- closed one. Documents are keyed on the deal, and the buyer portal selected
-- every buyerVisible document on it — so on a development with ten plots, plot
-- 2's buyer would have been shown plot 1's contract of sale, and could have
-- signed it. `signedAt` is a single column, so that signature would then have
-- appeared in plot 1's own portal as theirs.
--
-- A document offered to a buyer is offered to A buyer. NULL means shared with
-- nobody, which is what every existing row is and must stay: no workspace may
-- start disclosing a file to somebody because a column appeared.
ALTER TABLE "Document" ADD COLUMN "unitId" TEXT;

CREATE INDEX "Document_unitId_idx" ON "Document"("unitId");

ALTER TABLE "Document" ADD CONSTRAINT "Document_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
