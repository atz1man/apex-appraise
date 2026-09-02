-- An LP's share is one figure on the investor, applied to every pooled amount
-- they read. A holding carried a share of its own that no figure was ever
-- scaled by, while the API accepted and audited a change to it and it went
-- stale the moment the investor's share was edited.
ALTER TABLE "Holding" DROP COLUMN "sharePct";
