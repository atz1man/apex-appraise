-- When a webhook delivery is next due.
--
-- RETRY_DELAYS ([0, 30, 300, 1800] seconds) was declared and documented but used
-- for nothing except its own length: there was no column to record a due time,
-- so the drain — which runs every 15 seconds — re-tried every pending row on
-- every pass. All four attempts were spent in about 45 seconds instead of the
-- ~36 minutes the schedule describes, and a receiver down for one minute lost
-- the event permanently.
--
-- Existing rows default to now(), i.e. due immediately, which is the behaviour
-- they already had.
ALTER TABLE "WebhookDelivery" ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- the drain's own query: pending work that is actually due
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
