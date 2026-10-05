-- When a capital call was actually funded, or null while it is outstanding.
-- Without it the portal split calls by due date, so an unpaid drawdown notice
-- became a payment in the LP's history the moment its due date passed.
ALTER TABLE "Cashflow" ADD COLUMN "fundedAt" TIMESTAMP(3);
