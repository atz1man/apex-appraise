/**
 * The public API's own vocabulary — shared, because it is documented in one
 * place and implemented in another.
 *
 * The events lived in apps/api/src/webhook-delivery.ts, which the browser cannot
 * import, so the docs page would have had to keep its own copy of the list. That
 * is precisely how the pricing page and the server came apart earlier on this
 * branch, and how five of these events came to be documented while one was sent.
 */
export const WEBHOOK_EVENTS = [
  'appraisal.approved',
  'appraisal.submitted',
  'covenant.breached',
  'deal.created',
  'report.shared',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const isWebhookEvent = (s: string): s is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(s);

/** What a receiver is told each event means. One sentence, no jargon. */
export const WEBHOOK_EVENT_MEANING: Record<WebhookEvent, string> = {
  'deal.created': 'A scheme was added to the pipeline.',
  'appraisal.submitted': 'A saved appraisal version was sent for review.',
  'appraisal.approved': 'A reviewer approved an appraisal. Its figures are the firm’s committed position.',
  'covenant.breached': 'Approved figures broke a facility limit the firm set. Carries the limits and what breached them.',
  'report.shared': 'A share link was minted for a report. Never carries the link itself — the link is the credential.',
};

/** How long a delivery is retried for, in seconds from the first attempt. */
export const WEBHOOK_RETRY_SCHEDULE_SECONDS = [0, 30, 300, 1800] as const;
