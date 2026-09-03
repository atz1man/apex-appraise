/**
 * Which deal the firm is ON — the one the home screen puts every tool on, the
 * one the benchmarking contribution and the integrations sync offer first.
 *
 * Three screens answered this with the demo scheme's name: `find(d =>
 * d.name.startsWith('Northgate')) ?? deals[0]`, spelled out in each. Outside
 * the demo workspace the pin finds nothing and the fallback decides — and
 * `deals.list` orders by probability, where every COMPLETED deal sits at 100.
 * Measured on the demo workspace with the pin removed: the home screen read
 * "Everything on Parkstone Mews", a scheme closed in April, and Auto-Appraisal,
 * the development appraisal and the cost monitor all opened on it. A firm's
 * own workspace, which has no Northgate, has always been shown that.
 *
 * The rule: the LIVE deal worked most recently. `lastWorkedAt` comes from the
 * API (the latest audit event on the deal, floored at the row's own stamp), so
 * a deal somebody filed a document on this morning is the deal, whatever its
 * probability. A finished scheme is never chosen while an unfinished one
 * exists, however recently somebody looked at it; where the firm has only
 * finished schemes, the latest of those is still an answer. Ties — the seed
 * writes eleven deals in twenty milliseconds — go to the higher probability,
 * then to the id, so the answer does not depend on the order the rows came in.
 * A name is never consulted.
 */
export type WorkedDeal = { id: string; stage: string; probability: number; lastWorkedAt: Date | string };

const when = (d: WorkedDeal) => new Date(d.lastWorkedAt).getTime();

function later(a: WorkedDeal, b: WorkedDeal): boolean {
  const ta = when(a);
  const tb = when(b);
  if (ta !== tb) return ta > tb;
  if (a.probability !== b.probability) return a.probability > b.probability;
  return a.id < b.id;
}

export function workingDeal<D extends WorkedDeal>(deals: readonly D[] | undefined): D | undefined {
  if (!deals?.length) return undefined;
  const live = deals.filter((d) => d.stage !== 'COMPLETED');
  const pool = live.length ? live : deals;
  return pool.reduce((best, d) => (later(d, best) ? d : best));
}
