-- When a cancellation already scheduled in Stripe takes effect, so the billing
-- panel can say so on a plain page load rather than calling Stripe per view.
ALTER TABLE "Organisation" ADD COLUMN "subscriptionCancelAt" TIMESTAMP(3);
