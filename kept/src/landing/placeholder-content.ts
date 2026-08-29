/**
 * PRE-LAUNCH PLACEHOLDER CONTENT.
 *
 * These figures and reviews came from the design handoff, which marks them
 * "illustrative, replace with real numbers before shipping". Nothing here is
 * measured and nobody named below is a real customer.
 *
 * They live in their own module behind a flag rather than inline in the page
 * so that shipping them by accident takes a deliberate edit. While
 * `SOCIAL_PROOF_IS_PLACEHOLDER` is true the section renders a visible notice;
 * set it to false only once every figure below has been replaced with one you
 * can substantiate. Published testimonials that were never given, and
 * recovery totals that were never measured, are misrepresentations to
 * customers whatever the intention behind them.
 */
export const SOCIAL_PROOF_IS_PLACEHOLDER = true;

export const STATS = [
  { value: '£1.4M+', label: 'recovered by kept users' },
  { value: '4.8 ★', label: '2,300 ratings' },
  { value: '£61', label: 'average return saved' },
] as const;

export const REVIEWS = [
  {
    quote: 'Got £89 back on headphones I’d completely forgotten about. The app literally paid for itself 5× in week one.',
    who: 'Maya, 24 · Manchester',
  },
  {
    quote: 'The Zara dispatch-date thing would have cost me a coat. Kept flagged it the day the policy changed. Obsessed.',
    who: 'Jade, 21 · London',
  },
  {
    quote: 'No account, nothing uploaded, and it still knows every store’s policy better than the store staff do.',
    who: 'Sam, 27 · Bristol',
  },
] as const;

/*
 * The scrolling headline bar used to live here, exempted from the warning
 * above on the grounds that it "restates published retailer policies". That
 * was the reason to move it out, not to keep it: a restatement is true only
 * while it matches what it restates, and nothing held these five strings to
 * `stores.ts` or to the feed. See `ticker.ts`, where they are computed.
 */
