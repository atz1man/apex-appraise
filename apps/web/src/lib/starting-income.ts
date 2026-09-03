import { assetClass } from '@apex/types/asset-classes';
import type { IncomeInput } from '@apex/appraisal-engine';

/**
 * Where a held-and-let element starts, before anybody types anything.
 *
 * The appraisal screen held one starting rent roll for every scheme —
 * "Let space, 5,000 ft², £15/ft², 7%" — which is a fair first line for the
 * industrial and commercial schemes it was written against and nonsense for an
 * operated asset. A build-to-rent block does not let "space" and does not
 * capitalise at 7%: the starting yield IS the assumption a valuer would
 * otherwise have to know to change, and one left at 7% on a prime BTR scheme
 * understates the investment value by about forty per cent. A wrong default
 * that looks like a considered one is worse than an empty field.
 *
 * So the line's name and the yield come from the asset class, and nothing else
 * does. Count, area and rent stay generic on purpose — those are facts about a
 * particular scheme, and this module has no business guessing them. It is the
 * same standing as `HOUSE_ASSUMPTIONS` in `auto-defaults.ts`: the things an
 * appraiser types first, not claims about the site.
 *
 * The four development classes keep the exact figures the screen hard-coded, so
 * no existing scheme's rent roll changes.
 */

/** The rent roll a scheme takes on when it first gains a held element. */
export function startingIncome(assetType?: string | null): IncomeInput {
  const cls = assetClass(assetType);
  return {
    lines: [{ label: cls?.startingIncome.lineLabel ?? 'Let space', count: 1, area: 5000, rentPsf: 15, voidPct: 5 }],
    nonRecoverablePct: 5,
    annualDeductions: 0,
    yieldPct: cls?.startingIncome.yieldPct ?? 7,
    purchaserCostsPct: 6.8,
    letUpMonths: 6,
  };
}

/**
 * The line "+ Add line" adds to a rent roll that already exists.
 *
 * Deliberately not `startingIncome().lines[0]`: a second line is a smaller one
 * (2,000 ft², as the screen always added) and carries no yield of its own —
 * the scheme's yield already applies. Only the name is shared, which is the
 * part the asset class actually decides.
 */
export function startingIncomeLine(assetType?: string | null): IncomeInput['lines'][number] {
  return { label: assetClass(assetType)?.startingIncome.lineLabel ?? 'Let space', count: 1, area: 2000, rentPsf: 15, voidPct: 5 };
}
