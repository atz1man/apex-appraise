/**
 * What a buyer pays on a plot, and what the developer is therefore holding.
 *
 * This rule was written FIVE times, in five files, with five different answers:
 *
 *   sales.upsertUnit       reserved £5,000, then 10% of (agreed ?? appraised)
 *   sales.advanceMilestone reserved: keep what is there, else £5,000; then 10%
 *   org.ts (sample deal)   reserved £5,000, then 10% of agreed
 *   portal.ensurePayments  reservation fee £2,000, then 10% of agreed, else £0
 *   demo-seed              £5,000, plus 5% from the mortgage-offer stage, then 10%
 *
 * Measured on the demo workspace, on the buyer's own screen: "Deposit held
 * £39,200", and directly beneath it two receipts — a £2,000 reservation fee and
 * a £39,200 exchange deposit, both marked PAID. The buyer had paid £41,200 and
 * was being told the developer held £39,200. The reservation fee they had
 * actually paid was missing from the statement of their own money, because the
 * firm's figure was a formula that only knew about the 10%.
 *
 * So it lives here, once, with every other money rule (CLAUDE.md: "One shared
 * calculation engine for every surface"). The reservation fee is £2,000 because
 * that is the figure a buyer is actually charged — the only one of the five
 * with a payment row and a card path behind it. The £5,000 was a formula that
 * no buyer was ever asked for.
 *
 * Amounts are POUNDS at this layer, as everywhere in the engine.
 */

/** Milestone indices, from SALES_MILESTONES in @apex/types (not imported: the engine depends on nothing). */
const RESERVED_AT = 1; // 'Reserved' is complete once progress passes it
const EXCHANGED_AT = 5; // 'Exchanged'

export interface DepositTerms {
  /** taken to hold the plot, £ */
  reservationFee: number;
  /** of the agreed value, taken on exchange */
  exchangePct: number;
}

/** UK new-build convention, and what this product has always charged. */
export const DEFAULT_DEPOSIT_TERMS: DepositTerms = { reservationFee: 2_000, exchangePct: 10 };

export interface DepositRow {
  kind: string;
  /** £ */
  amount: number;
  /** the milestone index at which this falls due */
  dueAtProgress: number;
}

export interface DepositUnitLike {
  /** £, null until a price is agreed */
  agreedValue: number | null;
  /** £ */
  appraisedValue: number;
}

/**
 * The whole schedule for a plot, paid or not.
 *
 * The exchange deposit falls back to the appraised value while no price is
 * agreed, because a schedule that says £0 is not an estimate — it is a claim
 * that nothing is owed, printed next to a Pay button.
 */
export function depositSchedule(unit: DepositUnitLike, terms: DepositTerms = DEFAULT_DEPOSIT_TERMS): DepositRow[] {
  const basis = unit.agreedValue ?? unit.appraisedValue;
  return [
    { kind: 'Reservation fee', amount: terms.reservationFee, dueAtProgress: RESERVED_AT },
    {
      kind: `Exchange deposit (${terms.exchangePct}%)`,
      amount: Math.round(basis * (terms.exchangePct / 100)),
      dueAtProgress: EXCHANGED_AT,
    },
  ];
}

/** Which rows have fallen due by this point in the conveyance. */
export function depositsDueBy(progress: number, unit: DepositUnitLike, terms: DepositTerms = DEFAULT_DEPOSIT_TERMS): DepositRow[] {
  return depositSchedule(unit, terms).filter((r) => progress >= r.dueAtProgress);
}

/**
 * What the developer is holding, £.
 *
 * The sum of everything due by now — which is what makes this agree with the
 * buyer's receipts, where the previous formula could not: it counted the
 * exchange deposit and forgot the reservation fee the buyer had paid months
 * earlier.
 */
export function depositsHeldAt(progress: number, unit: DepositUnitLike, terms: DepositTerms = DEFAULT_DEPOSIT_TERMS): number {
  return depositsDueBy(progress, unit, terms).reduce((a, r) => a + r.amount, 0);
}
