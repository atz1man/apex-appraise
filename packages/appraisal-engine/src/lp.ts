/**
 * What an LP's own position page is allowed to say.
 *
 * Both headline figures on the investor portal were constants in the router:
 *
 *   position: { committed, called, distributed, netIrr: 0.214, netMoic: 1.42 }
 *
 * Every investor of every firm was told their net IRR was 21.4% and their money
 * had returned 1.42×. Measured on the demo workspace, for an LP whose real
 * numbers were sitting two lines above in the same function: called £3,788,400,
 * distributed £2,640,000 — 0.70× returned so far, not 1.42×. That is the
 * difference between a fund that has doubled and one that is behind on cash.
 *
 * So the figures are computed here, from the same data the page already shows,
 * and each is named for what it actually is. A "net IRR" is after fees and carry
 * over an LP's full dated cashflow ledger; this product holds no such ledger per
 * investor, so it does not claim one.
 */

/**
 * Distributions to Paid In — cash back per pound drawn.
 *
 * Null rather than zero when nothing has been called: a fund that has drawn
 * nothing has no ratio, and 0.00× reads as "you have lost it".
 */
export function dpi(distributed: number, called: number): number | null {
  if (called <= 0) return null;
  return distributed / called;
}

export interface IrrHoldingLike {
  /** £ committed to this deal */
  committed: number;
  /** the IRR recorded against this deal, as a fraction (0.231 = 23.1%), or null while nobody has recorded one */
  irr: number | null;
}

/**
 * Capital-weighted IRR across the deals that have one recorded.
 *
 * Holdings with no recorded IRR are LEFT OUT rather than counted as zero. A
 * scheme still in construction has not returned 0% — it has not returned yet,
 * and averaging a zero into the portfolio understates every realised deal
 * beside it. Null when nothing has an IRR yet, so the page can say so.
 *
 * That is what the comment above has always said. What the code did was filter
 * on `h.irr > 0`, which is not the same test: it dropped every RECORDED loss as
 * well as every unrecorded holding, so the portfolio figure was an average over
 * the winners. An LP with a scheme at +23% and one at -40% was shown +23% —
 * their portfolio return with the losing half deleted. `dpi` above already
 * draws exactly this distinction, and draws it correctly: absence is not zero,
 * and a bad number is not an absent one.
 *
 * That was latent when it was written: `Holding.irr` was `Float @default(0)`,
 * the only writer was the demo seed, and zero stood in for "not recorded" — so
 * a deal that genuinely returned 0.0% and one nobody had entered were the same
 * value, and both had to be left out. The register that now lets a firm record
 * the figure is what made it live, and the column went nullable with it:
 * absence is null, a zero is a return of nothing and COUNTS, and a loss is a
 * negative number that counts too.
 */
export function weightedIrr(holdings: IrrHoldingLike[]): number | null {
  const scored = holdings.filter((h): h is IrrHoldingLike & { irr: number } => h.irr != null && h.committed > 0);
  if (!scored.length) return null;
  const capital = scored.reduce((a, h) => a + h.committed, 0);
  if (capital <= 0) return null;
  return scored.reduce((a, h) => a + h.irr * h.committed, 0) / capital;
}
